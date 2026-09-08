/**
 * Rate-change blog-draft hook tests (task 5.1, change
 * trust-and-reach-roadmap) over the fake-D1 harness.
 *
 * Pins (spec content-publication, design D3):
 * - the hook creates FI + EN DRAFT rows linked to the confirmed version,
 *   with bodies built from the versioned rate delta;
 * - it is IDEMPOTENT per (slug, locale) — a re-run skips, never
 *   duplicates or overwrites;
 * - it is FAIL-OPEN at the wrapper boundary — a total failure resolves
 *   to null and logs; the confirmation is unaffected;
 * - a confirmation whose versions carry no rate change is a no-op;
 * - the aggregator fires both confirmation hooks (alerts + drafts) via
 *   waitUntil.
 *
 * @module BlogDraftsCronTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  enqueueRateChangeBlogDrafts,
  handleRateChangeBlogDrafts,
  resolveVersionDelta,
} from '../blog-drafts';
import { runRateConfirmationHooks } from '../rate-confirmation';
import { D1BlogPostRepository } from '../../../../../packages/data-platform/src/repositories/d1/blog-post.repository';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { permissiveEnv } from '../../routes/__tests__/harness';
import type { Env } from '../../env';
import type { Logger } from '../../logger';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/** Quiet test logger. */
function quietLog(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

/** Seed a confirmed-version rate step: beer excise 1000 → 1010 effective soon. */
function seedRateStep(db: ReturnType<typeof openMigratedD1>['db']): void {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const insert = db.prepare(
    `INSERT INTO tax_rules (
       id, tax_type, product_category, rate, effective_from, effective_to,
       exemption_conditions, calculation_formula_reference, official_source,
       verification_date, version_label, created_at
     ) VALUES (?, 'excise', 'beer', ?, ?, NULL, NULL,
       'PER_CENTILITRE_ETHANOL', 'vero.fi', ?, ?, ?)`,
  );
  insert.run(1, 1000, '2026-01-01T00:00:00.000Z', now, 'v2026-old', now);
  insert.run(2, 1010, future, null, 'v2026-09', now);
}

describe('resolveVersionDelta', () => {
  it('pairs each changed line with its predecessor rate', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);

    const delta = await resolveVersionDelta(d1, ['v2026-09']);
    expect(delta).not.toBeNull();
    expect(delta!.changes).toHaveLength(1);
    expect(delta!.changes[0]).toMatchObject({
      taxType: 'excise',
      productCategory: 'beer',
      formulaReference: 'PER_CENTILITRE_ETHANOL',
      fromRate: 1000,
      toRate: 1010,
    });
  });

  it('returns null for versions without a change or an empty scope', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);
    expect(await resolveVersionDelta(d1, [])).toBeNull();
    expect(await resolveVersionDelta(d1, ['v-never-confirmed'])).toBeNull();
  });
});

describe('handleRateChangeBlogDrafts', () => {
  function envOf(d1: D1DatabaseLike): Env {
    return permissiveEnv(d1);
  }

  it('creates the FI + EN DRAFT pair linked to the confirmed version', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);

    const result = await handleRateChangeBlogDrafts(envOf(d1), quietLog(), {
      confirmedVersions: ['v2026-09'],
    });
    expect(result.draftsCreated).toBe(2);
    expect(result.changedLines).toBe(1);

    const repo = new D1BlogPostRepository(d1);
    const fi = await repo.findBySlugAndLocale('veromuutos-v2026-09', 'fi');
    const en = await repo.findBySlugAndLocale('veromuutos-v2026-09', 'en');
    expect(fi!.status).toBe('DRAFT');
    expect(en!.status).toBe('DRAFT');
    expect(fi!.rateDatasetVersion).toBe('v2026-09');
    expect(fi!.bodyMarkdown).toContain('1000 → 1010');
    expect(fi!.bodyMarkdown).toContain(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  });

  it('is idempotent per (slug, locale) — a re-run skips, never overwrites', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);
    const log = quietLog();

    await handleRateChangeBlogDrafts(envOf(d1), log, { confirmedVersions: ['v2026-09'] });

    // A human edits the FI draft before re-publication.
    const repo = new D1BlogPostRepository(d1);
    const fi = await repo.findBySlugAndLocale('veromuutos-v2026-09', 'fi');
    await repo.updateDraft(fi!.id, { title: 'Human-edited title' });

    const second = await handleRateChangeBlogDrafts(envOf(d1), log, {
      confirmedVersions: ['v2026-09'],
    });
    expect(second.draftsCreated).toBe(0);
    expect(second.draftsSkipped).toBe(2);

    const after = await repo.findBySlugAndLocale('veromuutos-v2026-09', 'fi');
    expect(after!.title).toBe('Human-edited title');
  });

  it('a confirmation with no changed lines is a no-op', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);
    // The old version confirmed: no predecessor-paired change selects.
    const result = await handleRateChangeBlogDrafts(envOf(d1), quietLog(), {
      confirmedVersions: ['v2026-old'],
    });
    expect(result.draftsCreated).toBe(0);
    expect((await new D1BlogPostRepository(d1).listByLocale('fi')).length).toBe(0);
  });

  it('a draft-persist failure is isolated per draft (one locale survives)', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);
    const log = quietLog();

    const result = await handleRateChangeBlogDrafts(
      envOf(d1),
      log,
      {
        confirmedVersions: ['v2026-09'],
        createDraft: async (input) => {
          if (input.locale === 'en') throw new Error('EN store exploded');
          return new D1BlogPostRepository(d1).create(input);
        },
      },
    );
    expect(result.draftsCreated).toBe(1);
    expect(result.draftsSkipped).toBe(0);
    expect(log.error).toHaveBeenCalled();

    // The FI draft exists; the EN failure did not roll it back.
    const fi = await new D1BlogPostRepository(d1).findBySlugAndLocale('veromuutos-v2026-09', 'fi');
    expect(fi!.status).toBe('DRAFT');
  });
});

describe('enqueueRateChangeBlogDrafts — fail-open wrapper', () => {
  it('resolves to null and logs when the run throws (confirmation unaffected)', async () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);
    const env = permissiveEnv(d1, {
      // Force the default delta resolution to explode.
      DB: {
        prepare: () => {
          throw new Error('D1 is down');
        },
      } as unknown as Env['DB'],
    });
    void db;

    const log = quietLog();
    const outcome = await enqueueRateChangeBlogDrafts(env, log, ['v2026-09']);
    expect(outcome).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('fail-open'),
      }),
    );
  });
});

describe('runRateConfirmationHooks — the confirmation seam', () => {
  it('fires both hooks through waitUntil without throwing', () => {
    const { db, d1 } = openMigratedD1();
    seedRateStep(db);
    const env = permissiveEnv(d1);
    const log = quietLog();
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) };

    expect(() => runRateConfirmationHooks(env, log, ctx, ['v2026-09'])).not.toThrow();
    expect(waited).toHaveLength(2);

    return Promise.allSettled(waited).then(() => {
      // Both wrappers are fail-open — nothing propagated.
    });
  });

  it('tolerates a missing execution context (unit-test composition)', () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1);
    expect(() => runRateConfirmationHooks(env, quietLog(), null, [])).not.toThrow();
  });
});

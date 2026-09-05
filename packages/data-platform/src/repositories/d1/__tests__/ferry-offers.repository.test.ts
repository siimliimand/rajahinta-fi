/**
 * D1FerryOffersRepository — real-SQLite tests (task 5.3, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the curated-content lifecycle:
 * create-lands-DRAFT, the DRAFT→PUBLISHED publish transition (one-way,
 * terminal), DRAFT-only editability (published rows immutable), the
 * deterministic curation ordering of both list reads, and delete
 * semantics. The schema's non-empty CHECKs are exercised through the
 * harness (a blank url insert is unrepresentable at rest).
 *
 * @module D1FerryOffersRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1FerryOffersRepository,
  FerryOfferImmutableError,
  type FerryOfferInsert,
  type FerryOfferRecord,
} from '../ferry-offers.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1FerryOffersRepository(d1);

function offer(
  overrides: Partial<FerryOfferInsert> = {},
): FerryOfferInsert {
  return {
    operator: 'Viking Line',
    routeLabel: 'Helsinki–Tallinn',
    url: 'https://www.vikingline.example/minifarty',
    ...overrides,
  };
}

describe('D1FerryOffersRepository — create lands DRAFT', () => {
  it('appends a new offer as DRAFT with a created stamp and never auto-publishes', async () => {
    const created = await repo.create(offer());

    expect(created.id).toBeGreaterThan(0);
    expect(created.operator).toBe('Viking Line');
    expect(created.routeLabel).toBe('Helsinki–Tallinn');
    expect(created.url).toContain('https://');
    expect(created.status).toBe('DRAFT');
    expect(created.createdAt).toBeInstanceOf(Date);

    // The public read sees nothing until the publish action.
    expect(await repo.listPublished()).toEqual([]);
    expect(await repo.findById(created.id)).toEqual(created);
  });

  it('cannot persist a blank url/operator/route (schema CHECKs)', () => {
    for (const bad of [
      offer({ url: '' }),
      offer({ operator: '' }),
      offer({ routeLabel: '' }),
    ]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO ferry_offers (operator, route_label, url, status)
             VALUES (?, ?, ?, 'DRAFT')`,
          )
          .run(bad.operator, bad.routeLabel, bad.url),
      ).toThrow(/CHECK constraint failed/);
    }
  });
});

describe('D1FerryOffersRepository — publish transition', () => {
  it('flips DRAFT → PUBLISHED; republish is a terminal no-op null', async () => {
    const created = await repo.create(
      offer({ operator: 'Eckerö Line', routeLabel: 'Helsinki–Tallinn' }),
    );

    const published = await repo.publish(created.id);
    expect(published).not.toBeNull();
    expect(published!.status).toBe('PUBLISHED');

    // Terminal: the constrained UPDATE matches no DRAFT row.
    await expect(repo.publish(created.id)).resolves.toBeNull();

    // Now visible to the public read, invisible nowhere else.
    expect((await repo.listPublished()).map((o) => o.id)).toEqual([
      created.id,
    ]);
  });

  it('returns null for an unknown id (no fabricated publish)', async () => {
    await expect(repo.publish(999_999)).resolves.toBeNull();
  });
});

describe('D1FerryOffersRepository — editability', () => {
  it('edits a DRAFT offer and persists the change', async () => {
    const created = await repo.create(
      offer({ operator: 'Tallink Silja', routeLabel: 'Turku–Stockholm' }),
    );

    const updated = await repo.update(created.id, {
      url: 'https://www.tallink.example/silja-serenade',
    });
    expect(updated).not.toBeNull();
    expect(updated!.url).toBe('https://www.tallink.example/silja-serenade');
    expect(updated!.operator).toBe('Tallink Silja'); // untouched field
    expect((await repo.findById(created.id))!.url).toContain('silja-serenade');
  });

  it('refuses to edit a PUBLISHED offer (immutable; delete + re-create instead)', async () => {
    const created = await repo.create(
      offer({
        operator: 'Finnlines',
        routeLabel: 'Helsinki–Travemünde',
        url: 'https://www.finnlines.example/star',
      }),
    );
    await repo.publish(created.id);

    await expect(
      repo.update(created.id, { url: 'https://www.finnlines.example/v2' }),
    ).rejects.toBeInstanceOf(FerryOfferImmutableError);
    // The stored url is untouched by the refused edit.
    expect((await repo.findById(created.id))!.url).toBe(
      'https://www.finnlines.example/star',
    );
  });

  it('returns null when updating an unknown id', async () => {
    await expect(repo.update(999_999, { url: 'https://x.example' })).resolves.toBeNull();
  });
});

describe('D1FerryOffersRepository — list reads', () => {
  it('lists all rows for the console and published rows for the public block, both in curation order', async () => {
    // Insert deliberately out of alphabetical order — the reads must not
    // care (affiliate data must not influence its own ordering). The file
    // shares one database, so assertions scope to THESE rows by id.
    const c = await repo.create(offer({ operator: 'Viking Line', routeLabel: 'Helsinki–Tallinn' }));
    const a = await repo.create(offer({ operator: 'Eckerö Line', routeLabel: 'Helsinki–Tallinn' }));
    const b = await repo.create(offer({ operator: 'Viking Line', routeLabel: 'Åbo–Stockholm' }));

    // Publish in yet another order.
    await repo.publish(b.id);
    await repo.publish(a.id);

    const mine = new Map<number, FerryOfferRecord>(
      (await repo.listAll())
        .filter((row) => [a.id, b.id, c.id].includes(row.id))
        .map((row) => [row.id, row]),
    );
    expect([...mine.values()].map((o) => [o.status, o.operator, o.routeLabel])).toEqual([
      ['DRAFT', 'Viking Line', 'Helsinki–Tallinn'],
      ['PUBLISHED', 'Eckerö Line', 'Helsinki–Tallinn'],
      ['PUBLISHED', 'Viking Line', 'Åbo–Stockholm'],
    ]);

    const publishedIds = (await repo.listPublished()).map((o) => o.id);
    // Both published rows are present, in curation order, ahead of any
    // later insert id (insertion order must not win over the ordering key).
    expect(publishedIds.filter((id) => [a.id, b.id].includes(id))).toEqual([
      a.id,
      b.id,
    ]);
    expect((await repo.listPublished()).every((o) => o.status === 'PUBLISHED')).toBe(true);
  });
});

describe('D1FerryOffersRepository — delete', () => {
  it('removes any status and reports whether a row was removed', async () => {
    const draft = await repo.create(offer({ operator: 'Fityour', routeLabel: 'Helsinki–Tallinn' }));
    const published = await repo.create(
      offer({ operator: 'Fityour', routeLabel: 'Turku–Kapellskär' }),
    );
    await repo.publish(published.id);

    expect(await repo.remove(draft.id)).toBe(true);
    expect(await repo.remove(draft.id)).toBe(false); // already gone
    expect(await repo.remove(published.id)).toBe(true);
    expect(await repo.findById(draft.id)).toBeNull();
    expect(await repo.findById(published.id)).toBeNull();
  });
});

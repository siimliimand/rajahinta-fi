/**
 * D1ProducerLinksRepository — real-SQLite tests (task 6.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the curated-evidence lifecycle:
 * create-lands-DRAFT, the DRAFT→PUBLISHED publish transition (one-way,
 * terminal), DRAFT-only editability (published rows immutable), CRUD
 * and delete semantics — and, binding for this module, the EXACT
 * normalized-key lookup: normalization vectors pin the exported rule,
 * near-miss keys must NOT match (spec: no similarity scoring), and the
 * schema's non-empty evidence CHECKs make an unevidenced row (and a
 * self-link) unrepresentable at rest.
 *
 * @module D1ProducerLinksRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1ProducerLinksRepository,
  ProducerLinkImmutableError,
  normalizeProducerKey,
  type ProducerLinkInsert,
  type ProducerLinkRecord,
} from '../producer-links.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1ProducerLinksRepository(d1);

/** Seed the FK parents (products are never deleted — no cascade exists). */
function seedProductRow(id: number, name: string): void {
  db.prepare(
    `INSERT INTO product_master (
       id, name, manufacturer, brand, category, alcohol_by_volume,
       unit_volume, container_type, regulatory_classification,
       deposit_system_status
     ) VALUES (?, ?, ?, ?, 'beer', 0.047, 0.33, 'can', 'beer', 1)`,
  ).run(id, name, 'Hartwall', 'Hartwall');
}

seedProductRow(101, 'Karhu III');
seedProductRow(202, 'Karhu III (export)');
seedProductRow(303, 'Koff III');

function link(
  overrides: Partial<ProducerLinkInsert> = {},
): ProducerLinkInsert {
  return {
    alkoProductId: 101,
    siblingProductId: 202,
    producerKey: 'Hartwall',
    manufacturer: 'Hartwall Oyj',
    sourceUrl: 'https://systembolaget.example/produkt/karhu',
    reviewer: 'curator@example.invalid',
    reviewedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeProducerKey — the pinned normalization rule', () => {
  // The exact rule: trim + lowercase + collapse whitespace runs.
  it.each([
    ['Hartwall', 'hartwall'],
    ['  Hartwall  ', 'hartwall'],
    ['Henri  COQUARD', 'henri coquard'],
    ['  Bruwer\tLefebvre\nS.A.  ', 'bruwer lefebvre s.a.'],
    ['Anonym   ApS   ', 'anonym aps'],
    ['Öl-  ja Siideri', 'öl- ja siideri'],
  ])('normalizes %j → %j', (raw, expected) => {
    expect(normalizeProducerKey(raw)).toBe(expected);
  });

  it('is idempotent — normalized input is a fixed point', () => {
    const once = normalizeProducerKey('  Henri  COQUARD ');
    expect(normalizeProducerKey(once)).toBe(once);
  });
});

describe('D1ProducerLinksRepository — create lands DRAFT', () => {
  it('appends a new link as DRAFT with a normalized key and never auto-publishes', async () => {
    const created = await repo.create(
      link({ producerKey: '  Henri   COQUARD ' }),
    );

    expect(created.id).toBeGreaterThan(0);
    expect(created.alkoProductId).toBe(101);
    expect(created.siblingProductId).toBe(202);
    // The raw form is never persisted — the stored key is normalized.
    expect(created.producerKey).toBe('henri coquard');
    expect(created.manufacturer).toBe('Hartwall Oyj');
    expect(created.sourceUrl).toContain('https://');
    expect(created.reviewer).toBe('curator@example.invalid');
    expect(created.reviewedAt).toBeInstanceOf(Date);
    expect(created.status).toBe('DRAFT');
    expect(created.createdAt).toBeInstanceOf(Date);

    // The matching path sees nothing until the publish action.
    expect(await repo.findPublishedByProducerKey('henri coquard')).toEqual([]);
    expect(await repo.findById(created.id)).toEqual(created);
  });

  it('cannot persist a blank evidence/review field (schema CHECKs — R9)', () => {
    for (const bad of [
      link({ producerKey: '   ' }),
      link({ manufacturer: '' }),
      link({ sourceUrl: '' }),
      link({ reviewer: '' }),
      link({ reviewedAt: '' }),
    ]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO producer_links (
               alko_product_id, sibling_product_id, producer_key,
               manufacturer, source_url, reviewer, reviewed_at, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
          )
          .run(
            bad.alkoProductId,
            bad.siblingProductId,
            normalizeProducerKey(bad.producerKey),
            bad.manufacturer,
            bad.sourceUrl,
            bad.reviewer,
            bad.reviewedAt,
          ),
      ).toThrow(/CHECK constraint failed/);
    }
  });

  it('cannot persist a self-link (a product is its own trivial sibling)', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO producer_links (
             alko_product_id, sibling_product_id, producer_key,
             manufacturer, source_url, reviewer, reviewed_at, status
           ) VALUES (101, 101, 'hartwall', 'Hartwall Oyj',
                     'https://x.example', 'curator@example.invalid',
                     '2026-09-01T12:00:00.000Z', 'DRAFT')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('D1ProducerLinksRepository — exact normalized-key lookup', () => {
  it('matches despite case/whitespace differences (lookup normalizes the key)', async () => {
    const created = await repo.create(
      link({ producerKey: 'Bruwer Lefebvre', siblingProductId: 303 }),
    );
    await repo.publish(created.id);

    // Different case, padding, and internal spacing all normalize to
    // the stored key — exact equality AFTER normalization.
    for (const query of [
      'bruwer lefebvre',
      '  BRUWER  LEFEBVRE ',
      'Bruwer\tLefebvre',
    ]) {
      const rows = await repo.findPublishedByProducerKey(query);
      expect(rows.map((row) => row.id)).toContain(created.id);
      const scoped = await repo.findPublishedByAlkoProductAndKey(101, query);
      expect(scoped.map((row) => row.id)).toContain(created.id);
    }
  });

  it('returns NEAR-MISS keys as empty results — never a similarity substitute', async () => {
    const created = await repo.create(link({ producerKey: 'Olvi' }));
    await repo.publish(created.id);

    for (const nearMiss of [
      'olv',
      'olvi plc',
      'olvia',
      'o l v i',
      'hartwall',
      'olvi-oyj',
    ]) {
      expect(await repo.findPublishedByProducerKey(nearMiss)).toEqual([]);
      expect(
        await repo.findPublishedByAlkoProductAndKey(101, nearMiss),
      ).toEqual([]);
    }

    // The exact key still matches.
    expect((await repo.findPublishedByProducerKey('OLVI')).map((r) => r.id)).toEqual([
      created.id,
    ]);
  });

  it('scopes the product+key lookup to the requested product', async () => {
    const created = await repo.create(
      link({ producerKey: 'Koff', alkoProductId: 101, siblingProductId: 303 }),
    );
    await repo.publish(created.id);

    expect(
      (await repo.findPublishedByAlkoProductAndKey(101, 'KOFF')).map((r) => r.id),
    ).toEqual([created.id]);
    // The same key under a different product matches nothing.
    expect(
      await repo.findPublishedByAlkoProductAndKey(202, 'KOFF'),
    ).toEqual([]);
  });

  it('returns [] for a product with no curated links (no substitute)', async () => {
    expect(await repo.findPublishedByProducerKey('nonexistent producer')).toEqual([]);
    expect(await repo.findPublishedByAlkoProductAndKey(999_999, 'anything')).toEqual([]);
  });

  it('never returns DRAFT rows from the matching path', async () => {
    const created = await repo.create(link({ producerKey: 'Faltynga' }));
    expect(await repo.findPublishedByProducerKey('faltynga')).toEqual([]);

    await repo.publish(created.id);
    expect(
      (await repo.findPublishedByProducerKey('faltynga')).map((r) => r.id),
    ).toEqual([created.id]);
  });
});

describe('D1ProducerLinksRepository — publish transition', () => {
  it('flips DRAFT → PUBLISHED; republish is a terminal no-op null', async () => {
    const created = await repo.create(link({ producerKey: 'Laitilan' }));

    const published = await repo.publish(created.id);
    expect(published).not.toBeNull();
    expect(published!.status).toBe('PUBLISHED');

    // Terminal: the constrained UPDATE matches no DRAFT row.
    await expect(repo.publish(created.id)).resolves.toBeNull();
  });

  it('returns null for an unknown id (no fabricated publish)', async () => {
    await expect(repo.publish(999_999)).resolves.toBeNull();
  });
});

describe('D1ProducerLinksRepository — editability', () => {
  it('edits a DRAFT link, normalizing a replaced producer key', async () => {
    const created = await repo.create(link({ producerKey: 'Hartwall' }));

    const updated = await repo.update(created.id, {
      producerKey: '  Hartwall  Oyj  ',
      sourceUrl: 'https://systembolaget.example/produkt/karhu-v2',
    });
    expect(updated).not.toBeNull();
    expect(updated!.producerKey).toBe('hartwall oyj');
    expect(updated!.sourceUrl).toContain('karhu-v2');
    expect(updated!.manufacturer).toBe('Hartwall Oyj'); // untouched field
    expect((await repo.findById(created.id))!.producerKey).toBe('hartwall oyj');
  });

  it('refuses to edit a PUBLISHED link (immutable; delete + re-create instead)', async () => {
    const created = await repo.create(link({ producerKey: 'Malmgård' }));
    await repo.publish(created.id);

    await expect(
      repo.update(created.id, { sourceUrl: 'https://x.example/v2' }),
    ).rejects.toBeInstanceOf(ProducerLinkImmutableError);
    // The stored evidence is untouched by the refused edit.
    expect((await repo.findById(created.id))!.sourceUrl).toBe(
      'https://systembolaget.example/produkt/karhu',
    );
  });

  it('returns null when updating an unknown id', async () => {
    await expect(
      repo.update(999_999, { sourceUrl: 'https://x.example' }),
    ).resolves.toBeNull();
  });
});

describe('D1ProducerLinksRepository — list reads', () => {
  it('lists all rows for the console in deterministic curation order, drafts first', async () => {
    // Insert deliberately out of order — the read must not care. The
    // file shares one database, so assertions scope to THESE rows by id.
    const c = await repo.create(link({ producerKey: 'Vikingstad', siblingProductId: 202 }));
    const a = await repo.create(link({ producerKey: 'Åbro', siblingProductId: 303 }));
    const b = await repo.create(link({ producerKey: 'Celegorm', siblingProductId: 202 }));

    await repo.publish(b.id);
    await repo.publish(a.id);

    const mine = new Map<number, ProducerLinkRecord>(
      (await repo.listAll())
        .filter((row) => [a.id, b.id, c.id].includes(row.id))
        .map((row) => [row.id, row]),
    );
    expect(
      [...mine.values()].map((row) => [row.status, row.producerKey]),
    ).toEqual([
      ['DRAFT', 'vikingstad'],
      ['PUBLISHED', 'celegorm'],
      ['PUBLISHED', 'åbro'],
    ]);

    // Product-scoped console read: only product 101's rows.
    expect(
      (await repo.listByAlkoProductId(101)).every((row) => row.alkoProductId === 101),
    ).toBe(true);
  });
});

describe('D1ProducerLinksRepository — delete', () => {
  it('removes any status and reports whether a row was removed', async () => {
    const draft = await repo.create(link({ producerKey: 'Lapin Kulta', siblingProductId: 202 }));
    const published = await repo.create(
      link({ producerKey: 'Lapin Kulta', siblingProductId: 303 }),
    );
    await repo.publish(published.id);

    expect(await repo.remove(draft.id)).toBe(true);
    expect(await repo.remove(draft.id)).toBe(false); // already gone
    expect(await repo.remove(published.id)).toBe(true);
    expect(await repo.findById(draft.id)).toBeNull();
    expect(await repo.findById(published.id)).toBeNull();
    // Deletion takes the evidence down — the matching path forgets it.
    expect(await repo.findPublishedByProducerKey('lapin kulta')).toEqual([]);
  });
});

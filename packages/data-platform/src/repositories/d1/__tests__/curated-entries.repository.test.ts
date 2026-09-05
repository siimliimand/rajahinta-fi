/**
 * D1CuratedEntriesRepository — real-SQLite tests (task 7.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the curated-entry lifecycle
 * per the binding spec (curated-lists): create-lands-DRAFT, the
 * audited-console publish AND unpublish transitions (PUBLISHED is NOT
 * terminal — published content is editable, the no-deploy content
 * update requirement), the 7.2 public read path (ONLY published rows
 * of a slug), the evidence-links JSON structure validation, the
 * exactly-one-target invariant, and the schema CHECKs that make an
 * unevidenced or ambiguous entry unrepresentable at rest.
 *
 * @module D1CuratedEntriesRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1CuratedEntriesRepository,
  InvalidEvidenceLinksError,
  normalizeListSlug,
  type CuratedEntryInsert,
} from '../curated-entries.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1CuratedEntriesRepository(d1);

/** Seed the FK parent (products are never deleted — no cascade exists). */
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

const LINK = { label: 'Systembolaget listing', url: 'https://systembolaget.example/produkt/karhu' };

function entry(overrides: Partial<CuratedEntryInsert> = {}): CuratedEntryInsert {
  return {
    listSlug: 'alkon-hylkaamat',
    productId: 101,
    rationale: 'Discontinued at Alko; cheaper across the border.',
    evidenceLinks: [LINK],
    reviewer: 'curator@example.invalid',
    ...overrides,
  };
}

describe('normalizeListSlug — the pinned normalization rule', () => {
  // The exact rule: trim + lowercase. Idempotent by construction.
  it.each([
    ['  Alkon-Hylkaamat  ', 'alkon-hylkaamat'],
    ['ALKON-HYLKAAMAT', 'alkon-hylkaamat'],
    ['alkon-hylkaamat', 'alkon-hylkaamat'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeListSlug(raw)).toBe(expected);
    expect(normalizeListSlug(normalizeListSlug(raw))).toBe(normalizeListSlug(raw));
  });
});

describe('create — lands DRAFT with validated evidence', () => {
  it('creates a product-targeted DRAFT with a normalized slug and both timestamps', async () => {
    const created = await repo.create(entry({ listSlug: '  Alkon-Hylkaamat  ' }));
    expect(created.status).toBe('DRAFT');
    expect(created.listSlug).toBe('alkon-hylkaamat');
    expect(created.productId).toBe(101);
    expect(created.externalRef).toBeNull();
    expect(created.evidenceLinks).toEqual([LINK]);
    expect(created.createdAt.toISOString()).toBeTruthy();
    expect(created.updatedAt.toISOString()).toBeTruthy();

    const fetched = await repo.findById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.createdAt.getTime()).toBe(created.createdAt.getTime());
    expect(fetched!.updatedAt.getTime()).toBe(created.updatedAt.getTime());
  });

  it('creates an external-ref entry (exactly-one target, the other side null)', async () => {
    const created = await repo.create(
      entry({ productId: undefined, externalRef: 'https://systembolaget.example/produkt/karhu-export' }),
    );
    expect(created.productId).toBeNull();
    expect(created.externalRef).toBe('https://systembolaget.example/produkt/karhu-export');
  });

  it.each([
    ['neither target', { productId: undefined }],
    ['both targets', { externalRef: 'https://x.example/ref' }],
  ])('rejects an entry with %s', async (_label, overrides) => {
    await expect(repo.create(entry(overrides))).rejects.toThrow(
      /exactly one of productId or externalRef/,
    );
  });

  it.each([
    ['empty array', []],
    ['non-array', { label: 'x', url: 'https://x.example' }],
    ['missing label', [{ url: 'https://x.example' }]],
    ['blank label', [{ label: '', url: 'https://x.example' }]],
    ['non-http url', [{ label: 'x', url: 'ftp://x.example/file' }]],
    ['missing url', [{ label: 'x' }]],
  ])('rejects evidence links with %s', async (_label, evidenceLinks) => {
    await expect(repo.create(entry({ evidenceLinks: evidenceLinks as never }))).rejects.toThrow(
      InvalidEvidenceLinksError,
    );
  });
});

describe('schema CHECKs — unrepresentable at rest', () => {
  /** Direct-SQL insert bypassing the repository — the at-rest guard. */
  function rawInsert(columns: Record<string, string | number | null>): void {
    const keys = Object.keys(columns);
    db.prepare(
      `INSERT INTO curated_entries (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    ).run(...keys.map((k) => columns[k]));
  }

  const base = {
    list_slug: 'alkon-hylkaamat',
    product_id: 101,
    rationale: 'r',
    evidence_links: JSON.stringify([LINK]),
    reviewer: 'curator@example.invalid',
  };

  it('rejects a blank rationale / reviewer / slug', () => {
    expect(() => rawInsert({ ...base, rationale: '' })).toThrow(/rationale_check/);
    expect(() => rawInsert({ ...base, reviewer: '' })).toThrow(/reviewer_check/);
    expect(() => rawInsert({ ...base, list_slug: '' })).toThrow(/list_slug_check/);
  });

  it('rejects non-JSON and empty evidence_links', () => {
    expect(() => rawInsert({ ...base, evidence_links: 'not json' })).toThrow(/evidence_links_check/);
    expect(() => rawInsert({ ...base, evidence_links: '' })).toThrow(/evidence_links_check/);
    // Structurally-valid JSON that is not an evidence array passes the
    // json_valid backstop — the STRUCTURE is the repository's job
    // (parseEvidenceLinks rejects it on write and read). Inserted with
    // a throwaway slug and removed immediately so the read-validation
    // contract (a structurally-bad row fails loudly on read) cannot
    // poison other listing tests on the shared in-memory database.
    rawInsert({ ...base, list_slug: 'johina-json', evidence_links: '"just a string"' });
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM curated_entries WHERE list_slug = 'johina-json'`).get(),
    ).toMatchObject({ n: 1 });
    db.prepare(`DELETE FROM curated_entries WHERE list_slug = 'johina-json'`).run();
  });

  it('rejects a both-null and a both-present target', () => {
    expect(() => rawInsert({ ...base, product_id: null, external_ref: null })).toThrow(
      /target_check/,
    );
    expect(() => rawInsert({ ...base, external_ref: 'https://x.example' })).toThrow(
      /target_check/,
    );
  });

  it('rejects an unknown lifecycle state and an empty external_ref', () => {
    expect(() => rawInsert({ ...base, status: 'ARCHIVED' })).toThrow(/status_check/);
    // target_check passes (the empty string is NOT NULL); the
    // non-empty external_ref CHECK is the violated one.
    expect(() =>
      rawInsert({ ...base, product_id: null, external_ref: '' }),
    ).toThrow(/external_ref_check/);
  });
});

describe('lifecycle — publish AND unpublish (spec: not terminal)', () => {
  it('publishes a DRAFT, refuses to re-publish, unpublishes back to DRAFT', async () => {
    const created = await repo.create(entry());
    expect(created.status).toBe('DRAFT');

    const published = await repo.publish(created.id);
    expect(published?.status).toBe('PUBLISHED');

    // Not terminal ≠ re-publishable: only a DRAFT flips (ferry parity).
    expect(await repo.publish(created.id)).toBeNull();

    const unpublished = await repo.unpublish(created.id);
    expect(unpublished?.status).toBe('DRAFT');

    // And the reverse constraint: only a PUBLISHED row unpublishes.
    expect(await repo.unpublish(created.id)).toBeNull();
  });

  it('edits a PUBLISHED entry (no-deploy content update) and bumps updated_at', async () => {
    const created = await repo.create(entry());
    await repo.publish(created.id);
    // Rewind BOTH stamps so the bump — and the created<updated
    // monotonicity — is observable regardless of clock granularity:
    // create and update can land inside the same millisecond.
    db.prepare(
      `UPDATE curated_entries
          SET created_at = '2020-01-01T00:00:00.000Z',
              updated_at = '2020-01-01T00:00:00.000Z'
        WHERE id = ?`,
    ).run(created.id);

    const edited = await repo.update(created.id, {
      rationale: 'Re-verified: still discontinued, still cheaper abroad.',
      evidenceLinks: [LINK, { label: 'Alko archive', url: 'https://alko.example/archive/101' }],
    });
    expect(edited?.status).toBe('PUBLISHED');
    expect(edited?.rationale).toBe('Re-verified: still discontinued, still cheaper abroad.');
    expect(edited?.evidenceLinks).toHaveLength(2);
    expect(edited!.updatedAt.toISOString() > '2020-01-01T00:00:00.000Z').toBe(true);
    expect(edited!.createdAt.toISOString() < edited!.updatedAt.toISOString()).toBe(true);
  });

  it('unpublished entries disappear from the public read and return via publish', async () => {
    // Unique slug — the module-scoped database carries rows from the
    // other describes, and this read path must see exactly one.
    const created = await repo.create(entry({ listSlug: 'julkinen-testi' }));
    await repo.publish(created.id);
    expect((await repo.listPublishedBySlug('julkinen-testi')).map((e) => e.id)).toEqual([
      created.id,
    ]);

    await repo.unpublish(created.id);
    expect(await repo.listPublishedBySlug('julkinen-testi')).toEqual([]);

    const republished = await repo.publish(created.id);
    expect(republished?.status).toBe('PUBLISHED');
  });
});

describe('the 7.2 public read path — listPublishedBySlug', () => {
  it('serves ONLY published entries of the (normalized) slug, drafts and other slugs excluded', async () => {
    const publishedA = await repo.create(entry({ listSlug: 'publik-lista', productId: 101 }));
    const publishedB = await repo.create(
      entry({ listSlug: 'publik-lista', productId: undefined, externalRef: 'https://x.example/b' }),
    );
    const draft = await repo.create(entry({ listSlug: 'publik-lista', productId: 202 }));
    const otherSlug = await repo.create(entry({ listSlug: 'tank-dds' }));

    await repo.publish(publishedA.id);
    await repo.publish(publishedB.id);
    await repo.publish(otherSlug.id);
    // `draft` stays DRAFT — never publicly visible.

    // Mixed-case + padded lookup hits the stored normalized slug.
    const served = await repo.listPublishedBySlug('  PUBLIK-LISTA ');
    expect(served.map((e) => e.id)).toEqual([publishedA.id, publishedB.id]);
    for (const row of served) {
      expect(row.status).toBe('PUBLISHED');
      expect(row.listSlug).toBe('publik-lista');
    }
    expect(served.some((e) => e.id === draft.id)).toBe(false);
    expect(served.some((e) => e.id === otherSlug.id)).toBe(false);

    // An unknown slug serves nothing.
    expect(await repo.listPublishedBySlug('ei-olemissa')).toEqual([]);
  });
});

describe('console reads and edits', () => {
  it('listAll orders DRAFT-first regardless of insert order', async () => {
    const pub = await repo.create(entry({ listSlug: 'a-jarjestys', productId: 101 }));
    const draft = await repo.create(entry({ listSlug: 'b-jarjestys', productId: 202 }));
    await repo.publish(pub.id);

    // Relative order on the module-scoped database (earlier describes'
    // rows are present): every DRAFT precedes every PUBLISHED row.
    const ids = (await repo.listAll()).map((e) => e.id);
    expect(ids.indexOf(draft.id)).toBeLessThan(ids.indexOf(pub.id));
  });

  it('listBySlug returns any-status rows of one (normalized) slug only', async () => {
    const inSlug = await repo.create(entry({ listSlug: 'yksittais-lista', productId: 101 }));
    await repo.create(entry({ listSlug: 'toinen-lista', productId: 202 }));
    const rows = await repo.listBySlug(' Yksittais-Lista ');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(inSlug.id);
  });

  it('update patches individual fields and swaps the target wholesale', async () => {
    const created = await repo.create(entry({ productId: 101 }));

    const slugEdited = await repo.update(created.id, { listSlug: 'Uusi-Lista' });
    expect(slugEdited?.listSlug).toBe('uusi-lista');

    // Product → external target swap (one side IS the new target).
    const swapped = await repo.update(created.id, {
      externalRef: 'https://x.example/karhu',
    });
    expect(swapped?.productId).toBeNull();
    expect(swapped?.externalRef).toBe('https://x.example/karhu');

    // ...and back.
    const swappedBack = await repo.update(created.id, {
      productId: 202,
    });
    expect(swappedBack?.productId).toBe(202);
    expect(swappedBack?.externalRef).toBeNull();

    // Non-target patches leave the target untouched.
    const rationaleOnly = await repo.update(created.id, { rationale: 'Updated rationale.' });
    expect(rationaleOnly?.productId).toBe(202);
    expect(rationaleOnly?.rationale).toBe('Updated rationale.');

    expect(await repo.update(999999, { rationale: 'x' })).toBeNull();
  });

  it('remove deletes any status and reports whether a row was removed', async () => {
    const draft = await repo.create(entry({ productId: 101 }));
    expect(await repo.remove(draft.id)).toBe(true);
    expect(await repo.remove(draft.id)).toBe(false);

    const pub = await repo.create(entry({ productId: 202 }));
    await repo.publish(pub.id);
    expect(await repo.remove(pub.id)).toBe(true);
  });
});

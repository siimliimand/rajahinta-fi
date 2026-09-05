/**
 * Producer dupe finder integration suite (task 6.5, change
 * product-roadmap-phases-1-4) — the spec: producer-matching checklist
 * against the real stack: the FULL createApp() composition (index.ts
 * already wires registerProductDupesRoutes AND registerOpsRoutes, so
 * createApp() IS the production composition for both ports — no extra
 * registration) over a real migrated D1 and in-memory DO namespaces.
 *
 * Audit (task 6.5 text → existing coverage → what this file adds):
 *
 * - "unit: lookup normalization" — ALREADY COVERED by the task-6.1
 *   repository tests (normalization vectors, idempotence, exact-lookup
 *   near-miss pins, packages/data-platform/.../__tests__/
 *   producer-links.repository.test.ts); NOT re-tested here.
 * - "unit: evidence completeness" — ALREADY COVERED at the same two
 *   layers (6.1: blank-field CHECK unrepresentability + full record
 *   shape; 6.3 route tests: exact complete-evidence payload pin).
 * - "integration: flag-off 403" — route-level unit coverage exists
 *   (6.3, lockedEnv); ADDED here as the composed-app, data-present
 *   end-to-end version: flag on serves the sibling, flag off 403s on
 *   the SAME composition and data — the flag is the only variable.
 * - "unevidenced insert rejected at the repository boundary" — 6.1
 *   proves the CHECKs on RAW SQL (bypassing even the repository);
 *   ADDED here through the repository write path — create() and the
 *   DRAFT update() with blank evidence reject hard, nothing lands, and
 *   the public read path never sees a half-evidenced row. This is past
 *   every zod/console layer: the schema CHECK is the last gate.
 * - "source-level: no similarity/scoring mechanism exists in the dupe
 *   module" — MISSING entirely; ADDED here. Placement note: a
 *   second-opinion source scan could live in tests/compliance
 *   (trip-affiliate-neutrality precedent), but this task's scope is
 *   tests/integration/**, where the price-alerts d1 suite already
 *   established the readFileSync-scan pattern; implemented with
 *   compliance-grade rigor regardless: a non-vacuous matcher proof,
 *   a located-symbol proof (a renamed code unit cannot be silently
 *   skipped), brace/paren-matched extraction — NOT whole-file scans,
 *   because the modules' docblocks deliberately DISCUSS the
 *   prohibition and would false-positive.
 * - DRAFT invisibility end-to-end — 6.3 proves repo-created DRAFT rows
 *   are invisible; ADDED here as the full governance lifecycle over
 *   HTTP: console-create (DRAFT) → public API absent → console-publish
 *   → present, with the audited trail entries asserted (spec
 *   "Console edit audited").
 *
 * @module ProducerDupesD1IntegrationTest
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import {
  D1ProducerLinksRepository,
  type ProducerLinkInsert,
} from '../../../packages/data-platform/src/repositories/d1/producer-links.repository';
import type { Env } from '../../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures and composition — full production stack for BOTH ports
// ---------------------------------------------------------------------------

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const OPS_JSON = { 'content-type': 'application/json', ...OPS };

/**
 * index.ts registers the dupes handler (flag gate + limiter) and the
 * ops console (guard prefix) on the one app — the composition under
 * test is exactly what production serves.
 */
function fullApp(): ReturnType<typeof createApp> {
  return createApp();
}

/** Dupes flag ON + console open (permissive base) — the curated path. */
function curatedEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_PRODUCER_DUPE_FINDER: 'true' });
}

interface DupeJson {
  siblingProductId: number;
  producerKey: string;
  manufacturer: string;
  sourceUrl: string;
  reviewer: string;
  reviewedAt: string;
}

interface DupesJson {
  dupes: DupeJson[];
}

/** Seed the two FK parents under one manufacturer. */
function seedSiblingProducts(db: NonNullable<Parameters<typeof seedProduct>[0]>): void {
  seedProduct(db, { id: 1, name: 'Karjala III', manufacturer: 'Hartwall' });
  seedProduct(db, { id: 2, name: 'Nakki III (Systembolaget)', manufacturer: 'Hartwall' });
}

/** Complete, well-evidenced insert — the baseline every bad case mutates. */
const FULL_LINK: ProducerLinkInsert = {
  alkoProductId: 1,
  siblingProductId: 2,
  producerKey: '  Hartwall ',
  manufacturer: 'Hartwall Oyj',
  sourceUrl: 'https://systembolaget.example/karjala',
  reviewer: 'curator@example.invalid',
  reviewedAt: '2026-09-01T12:00:00.000Z',
};

// ===========================================================================
// 1. Flag-off 403 end-to-end — the gate is the only variable
//    (spec "Flag off": feature-disabled error; composed-app delta over
//    the 6.3 route-unit case)
// ===========================================================================

describe('GET /api/v1/products/:id/dupes — flag gate end-to-end (task 6.5)', () => {
  let db: NonNullable<Parameters<typeof seedProduct>[0]>;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = fullApp();
  });

  afterEach(() => {
    db.close();
  });

  it('serves the curated sibling with the flag ON, then 403s the identical request with the flag OFF', async () => {
    seedSiblingProducts(db);
    const repo = new D1ProducerLinksRepository(d1);
    const created = await repo.create(FULL_LINK);
    expect((await repo.publish(created.id))!.status).toBe('PUBLISHED');

    // Flag ON: the evidence-backed sibling serves (non-vacuity — data
    // exists that the OFF case must refuse to serve).
    const on = await request(app, curatedEnv(d1), '/api/v1/products/1/dupes');
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as DupesJson;
    expect(onBody.dupes).toHaveLength(1);
    expect(onBody.dupes[0]!.siblingProductId).toBe(2);

    // Flag OFF (flags otherwise open — the rollback semantics): the SAME
    // request on the SAME data gets the feature-disabled envelope.
    const off = await request(app, permissiveEnv(d1), '/api/v1/products/1/dupes');
    await expectEnvelope(off, 403, {
      message: 'Feature "PRODUCER_DUPE_FINDER" is not enabled',
      error: 'Forbidden',
    });

    // Fully locked env (the 6.3 route-unit case) — same verdict composed.
    const locked = await request(app, lockedEnv(d1), '/api/v1/products/1/dupes');
    await expectEnvelope(locked, 403, {
      message: 'Feature "PRODUCER_DUPE_FINDER" is not enabled',
      error: 'Forbidden',
    });
  });
});

// ===========================================================================
// 2. Unevidenced insert rejected at the repository boundary — past every
//    zod/console layer, the schema CHECK is the last gate
//    (design R9: "an unevidenced row is unrepresentable")
// ===========================================================================

describe('producer_links writes — unevidenced rows rejected at the repository boundary (task 6.5)', () => {
  let db: NonNullable<Parameters<typeof seedProduct>[0]>;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = fullApp();
  });

  afterEach(() => {
    db.close();
  });

  it('hard-rejects create() with any blank evidence/review field and lands nothing', async () => {
    seedSiblingProducts(db);
    const repo = new D1ProducerLinksRepository(d1);

    // The repository write path is below the console's zod schemas —
    // these calls bypass every DTO layer. (producerKey arrives as
    // whitespace, not empty: normalization must not rescue a blank key.)
    const unevidenced: ProducerLinkInsert[] = [
      { ...FULL_LINK, producerKey: '   ' },
      { ...FULL_LINK, manufacturer: '' },
      { ...FULL_LINK, sourceUrl: '' },
      { ...FULL_LINK, reviewer: '' },
      { ...FULL_LINK, reviewedAt: '' },
    ];
    for (const bad of unevidenced) {
      await expect(repo.create(bad)).rejects.toThrow(/CHECK constraint failed/);
    }

    // Nothing landed — the console listing is empty and the public read
    // path answers 200 with an empty list: an unevidenced row can never
    // become visible because it can never exist.
    expect(await repo.listAll()).toEqual([]);
    const dupes = await request(app, curatedEnv(d1), '/api/v1/products/1/dupes');
    expect(dupes.status).toBe(200);
    expect(((await dupes.json()) as DupesJson).dupes).toEqual([]);
  });

  it('hard-rejects the DRAFT edit path blanking evidence and leaves the stored evidence untouched', async () => {
    seedSiblingProducts(db);
    const repo = new D1ProducerLinksRepository(d1);
    const created = await repo.create(FULL_LINK);

    await expect(repo.update(created.id, { manufacturer: '' })).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(repo.update(created.id, { reviewedAt: '' })).rejects.toThrow(
      /CHECK constraint failed/,
    );

    // The refused edits changed nothing — the row still carries the
    // complete original evidence.
    const stored = await repo.findById(created.id);
    expect(stored).not.toBeNull();
    expect(stored!.manufacturer).toBe(FULL_LINK.manufacturer);
    expect(stored!.reviewedAt.toISOString()).toBe(FULL_LINK.reviewedAt);
    expect((await repo.listAll()).map((row) => row.id)).toEqual([created.id]);
  });
});

// ===========================================================================
// 3. DRAFT rows invisible on the public read path — the governance
//    lifecycle end-to-end: console-create (DRAFT) → public API absent →
//    console-publish → present, audited along the way
//    (spec "Console edit audited" + curated-governance lifecycle)
// ===========================================================================

describe('console-create → dupes absent → console-publish → dupes present (task 6.5)', () => {
  let db: NonNullable<Parameters<typeof seedProduct>[0]>;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;
  let env: Env;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = fullApp();
    env = curatedEnv(d1);
  });

  afterEach(() => {
    db.close();
  });

  it('moves a link through the audited DRAFT → PUBLISHED lifecycle across the HTTP boundary', async () => {
    seedSiblingProducts(db);

    // Console-create: the only sanctioned first write. The key arrives
    // unnormalized; the echoed (stored) form is normalized; status DRAFT.
    const created = await request(app, env, '/ops/console/producer-links', {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ operator: 'ops-integration', ...FULL_LINK }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      id: number;
      alkoProductId: number;
      siblingProductId: number;
      producerKey: string;
      status: string;
    };
    expect(createdBody.status).toBe('DRAFT');
    expect(createdBody.producerKey).toBe('hartwall');
    expect(createdBody.alkoProductId).toBe(1);
    expect(createdBody.siblingProductId).toBe(2);

    // While DRAFT: the public dupes API sees NOTHING (200 empty).
    const absent = await request(app, env, '/api/v1/products/1/dupes');
    expect(absent.status).toBe(200);
    expect(((await absent.json()) as DupesJson).dupes).toEqual([]);

    // The action is on the audited trail already.
    const trailWhileDraft = await request(app, env, '/ops/console/audit', { headers: OPS });
    expect(trailWhileDraft.status).toBe(200);

    // Console-publish: the operator's explicit human gate — the only
    // route to PUBLISHED.
    const published = await request(
      app,
      env,
      `/ops/console/producer-links/${createdBody.id}/publish`,
      { method: 'POST', headers: OPS_JSON, body: JSON.stringify({ operator: 'ops-integration' }) },
    );
    expect(published.status).toBe(200);
    expect(((await published.json()) as { id: number; status: string }).status).toBe(
      'PUBLISHED',
    );

    // Present — with the COMPLETE evidence set and nothing else.
    const present = await request(app, env, '/api/v1/products/1/dupes');
    expect(present.status).toBe(200);
    expect(((await present.json()) as DupesJson).dupes).toEqual([
      {
        siblingProductId: 2,
        producerKey: 'hartwall',
        manufacturer: 'Hartwall Oyj',
        sourceUrl: 'https://systembolaget.example/karjala',
        reviewer: 'curator@example.invalid',
        reviewedAt: '2026-09-01T12:00:00.000Z',
      },
    ]);

    // Both governance actions were recorded (spec "Console edit audited"):
    // created on curation, confirmed on publication — attributed to the
    // acting operator.
    const trail = await request(app, env, '/ops/console/audit', { headers: OPS });
    expect(trail.status).toBe(200);
    const items = ((await trail.json()) as {
      items: { entityType: string; entityId: string; action: string; author: string | null }[];
    }).items;
    const mine = items.filter(
      (entry) =>
        entry.entityType === 'producer_link' && entry.entityId === String(createdBody.id),
    );
    expect(mine.map((entry) => entry.action).sort()).toEqual(['confirmed', 'created']);
    expect(mine.every((entry) => entry.author === 'ops-integration')).toBe(true);
  });
});

// ===========================================================================
// 4. Source level — no similarity/scoring mechanism exists in the dupe
//    module (spec "No similarity scoring": source-level isolation)
//
//    Placement: tests/compliance would be the second-opinion home by
//    convention (trip-affiliate precedent), but this task's scope is
//    tests/integration/**, where the price-alerts d1 suite established
//    the readFileSync scan. Rigor is kept compliance-grade: non-vacuous
//    matcher, located-symbol proof, brace/paren-matched extraction —
//    whole-file scans would false-positive on the docblocks that
//    deliberately document the prohibition.
// ===========================================================================

const DATA_PLATFORM_SRC = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'data-platform',
  'src',
);
const API_WORKER_SRC = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'api-worker',
  'src',
);

/** The dupe module: the matching repository, its API surface, and the second sanctioned write path. */
const DUPE_PATH_FILES = {
  repository: path.join(DATA_PLATFORM_SRC, 'repositories/d1/producer-links.repository.ts'),
  route: path.join(API_WORKER_SRC, 'routes/product-dupes.routes.ts'),
  importer: path.join(DATA_PLATFORM_SRC, 'seed/producer-links-import.ts'),
} as const;

/** The committed schema of the dupe store. */
const PRODUCER_LINKS_MIGRATION = path.join(
  DATA_PLATFORM_SRC,
  'd1/migrations/0010_producer_links.sql',
);

/**
 * Similarity/scoring vocabulary — every banned mechanism's name. The
 * non-vacuity test proves each stem can fire; the scans prove the code
 * paths never do.
 */
const SCORING_VOCABULARY =
  /similar|embedding|taste|flavou?r|fuzzy|levenshtein|trigram|\bLIKE\b|scor|rank|relevan/i;

/** The code units that ARE the matching path — a rename must fail loudly here. */
const DUPE_PATH_CODE_UNITS: Readonly<Record<keyof typeof DUPE_PATH_FILES, readonly {
  label: string;
  pattern: RegExp;
  extract: (source: string) => string | null;
}[]>> = {
  repository: [
    {
      label: 'const FIND_PUBLISHED_BY_KEY_SQL',
      pattern: /\bconst FIND_PUBLISHED_BY_KEY_SQL\b/,
      extract: (s) => extractTemplateLiteral(s, 'FIND_PUBLISHED_BY_KEY_SQL'),
    },
    {
      label: 'const FIND_PUBLISHED_BY_PRODUCT_AND_KEY_SQL',
      pattern: /\bconst FIND_PUBLISHED_BY_PRODUCT_AND_KEY_SQL\b/,
      extract: (s) => extractTemplateLiteral(s, 'FIND_PUBLISHED_BY_PRODUCT_AND_KEY_SQL'),
    },
    {
      label: 'function normalizeProducerKey',
      pattern: /\bfunction normalizeProducerKey\b/,
      extract: (s) => extractBraceBlock(s, /\bfunction normalizeProducerKey\b/),
    },
  ],
  route: [
    {
      label: 'function getProductDupes',
      pattern: /\basync function getProductDupes\b/,
      extract: (s) => extractBraceBlock(s, /\basync function getProductDupes\b/),
    },
    {
      label: 'interface ProductDupe',
      pattern: /\binterface ProductDupe\b/,
      extract: (s) => extractBraceBlock(s, /\binterface ProductDupe\b/),
    },
  ],
  importer: [
    {
      label: 'function importProducerLinkCases',
      pattern: /\basync function importProducerLinkCases\b/,
      extract: (s) => extractBraceBlock(s, /\basync function importProducerLinkCases\b/),
    },
  ],
};

/** Extract a `const NAME = \`...\`` template literal (the SQL constants). */
function extractTemplateLiteral(source: string, constantName: string): string | null {
  const match = new RegExp(`\\bconst ${constantName}\\s*=\\s*\`([^\`]*)\``, 's').exec(
    source,
  );
  return match === null ? null : (match[1] ?? null);
}

/** Extract a full declaration block by brace matching (trip-affiliate precedent). */
function extractBraceBlock(source: string, declaration: RegExp): string | null {
  const match = declaration.exec(source);
  if (match === null) return null;
  const open = source.indexOf('{', match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

/** Extract a parenthesized block (the migration's CREATE TABLE column list). */
function extractParenBlock(source: string, declaration: RegExp): string | null {
  const match = declaration.exec(source);
  if (match === null) return null;
  const open = source.indexOf('(', match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

/** Every backtick literal in a file — the net over SQL strings and messages. */
function extractAllTemplateLiterals(source: string): string[] {
  return [...source.matchAll(/`(?:[^`\\]|\\.)*`/gs)].map((m) => m[0]);
}

describe('dupe module is similarity-free at source level (task 6.5)', () => {
  it('the vocabulary matcher itself can fire on every banned mechanism — the scans cannot pass vacuously', () => {
    const mustFire = [
      'similarity: 0.87',
      'embeddingIndex',
      'taste_profile',
      'flavorNotes',
      'flavourMatch',
      "WHERE producer_key LIKE '?%'",
      'fuzzyMatch',
      'levenshtein(a, b)',
      'trigramIndex',
      'scoreCents',
      'rankingWeight',
      'relevanceSort',
    ];
    for (const sample of mustFire) {
      expect(SCORING_VOCABULARY.test(sample), JSON.stringify(sample)).toBe(true);
    }
    // And it must NOT fire on the exact-match architecture's own vocabulary.
    expect(
      SCORING_VOCABULARY.test("WHERE producer_key = ? AND status = 'PUBLISHED'"),
    ).toBe(false);
    expect(SCORING_VOCABULARY.test('normalizeProducerKey(raw)')).toBe(false);
  });

  it('no matching-path code unit in the dupe module carries similarity/scoring vocabulary', () => {
    const located: string[] = [];
    for (const [fileKey, file] of Object.entries(DUPE_PATH_FILES)) {
      const source = readFileSync(file, 'utf8');
      expect(source.length).toBeGreaterThan(0);
      for (const unit of DUPE_PATH_CODE_UNITS[fileKey as keyof typeof DUPE_PATH_FILES]) {
        const block = unit.extract(source);
        // Located-symbol proof: a rename cannot silently skip a unit.
        expect(block, `${fileKey}::${unit.label} must still exist`).not.toBeNull();
        located.push(`${fileKey}::${unit.label}`);
        expect(
          block,
          `${fileKey}::${unit.label} must not carry similarity/scoring vocabulary ` +
            '(spec: no similarity scoring — matching is exact normalized-key equality only)',
        ).not.toMatch(SCORING_VOCABULARY);
      }
    }
    expect(located).toHaveLength(6);
  });

  it('the matching SQL is plain equality on the normalized key, PUBLISHED-only', () => {
    const source = readFileSync(DUPE_PATH_FILES.repository, 'utf8');
    const byKey = extractTemplateLiteral(source, 'FIND_PUBLISHED_BY_KEY_SQL');
    const byProduct = extractTemplateLiteral(
      source,
      'FIND_PUBLISHED_BY_PRODUCT_AND_KEY_SQL',
    );
    expect(byKey).not.toBeNull();
    expect(byProduct).not.toBeNull();
    for (const sql of [byKey!, byProduct!]) {
      expect(sql).toMatch(/producer_key\s*=\s*\?/);
      expect(sql).toMatch(/status\s*=\s*'PUBLISHED'/);
    }
    expect(byProduct).toMatch(/alko_product_id\s*=\s*\?/);
  });

  it('every SQL string and message template in the dupe module is free of the vocabulary', () => {
    for (const file of Object.values(DUPE_PATH_FILES)) {
      const source = readFileSync(file, 'utf8');
      const literals = extractAllTemplateLiterals(source);
      expect(literals.length).toBeGreaterThan(0);
      for (const literal of literals) {
        expect(literal, `${path.relative(DATA_PLATFORM_SRC, file)} template literal`).not.toMatch(
          SCORING_VOCABULARY,
        );
      }
    }
  });

  it('the producer_links schema carries exactly the R9 columns — no similarity-adjacent column is representable', () => {
    const source = readFileSync(PRODUCER_LINKS_MIGRATION, 'utf8');
    const createTable = extractParenBlock(
      source,
      /CREATE TABLE `producer_links`/,
    );
    expect(createTable).not.toBeNull();
    expect(createTable).not.toMatch(SCORING_VOCABULARY);

    // The exact R9 column set — data minimization: nothing "for later".
    const columns = [
      'id',
      'alko_product_id',
      'sibling_product_id',
      'producer_key',
      'manufacturer',
      'source_url',
      'reviewer',
      'reviewed_at',
      'status',
      'created_at',
    ];
    for (const column of columns) {
      expect(createTable).toMatch(new RegExp(`^\\t\\\`${column}\\\``, 'm'));
    }
  });
});

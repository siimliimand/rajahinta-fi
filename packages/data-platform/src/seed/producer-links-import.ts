/**
 * Producer-links curated seed import (task 6.2, change
 * product-roadmap-phases-1-4) — the importable logic behind
 * `scripts/import-producer-links.ts`, which is a thin CLI over these
 * functions so every rule here is unit-testable (spec:
 * producer-matching, design R9).
 *
 * EVIDENCE DISCIPLINE (R9): the import is one of the two sanctioned
 * write paths (spec "Curated governance": operator console or this
 * validated import script). Every case carries the complete evidence
 * set — producer key, manufacturer, source URL — plus review metadata
 * (reviewer, reviewedAt) supplied by the file itself, never invented at
 * import time. The write goes through
 * {@link ProducerLinksRepository.create}, so rows land DRAFT and the
 * audited console publish action is the human gate before anything is
 * publicly visible. The importer never publishes.
 *
 * IDEMPOTENCY (6.1 lifecycle): identity is the
 * (alkoProductId, siblingProductId) pair. A re-run skips pairs that
 * already exist — DRAFT or PUBLISHED — and never rewrites evidence.
 * PUBLISHED immutability is therefore preserved structurally (no
 * update call exists on this path); DRAFT rows are console-owned after
 * the initial load, so a re-run also refuses to clobber them (delete +
 * re-import through the console if a refresh is really wanted).
 *
 * @module ProducerLinksImport
 */
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from '../d1/executor';
import {
  normalizeProducerKey,
  type ProducerLinksRepository,
} from '../repositories/d1/producer-links.repository';

/** The only file format this module parses — bump to migrate. */
export const PRODUCER_LINKS_IMPORT_FORMAT_VERSION = 1;

/** Upper bound so a typo'd file cannot fan out into an unbounded write loop. */
export const PRODUCER_LINKS_IMPORT_MAX_CASES = 500;

/** Default per-URL reachability budget (online mode). */
export const SOURCE_URL_DEFAULT_TIMEOUT_MS = 10_000;

/** Trimmed, non-empty, length-capped text — the evidence-field shape. */
function evidenceText(max: number, label: string) {
  return z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be a string` })
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, `${label} must be non-empty`)
        .max(max, `${label} must be at most ${max} characters`),
    );
}

/** One curated case — every field is mandatory evidence or identity. */
export const producerLinkImportCaseSchema = z
  .strictObject({
    /** Alko product number — the Alko-side catalog id (leading zeros dropped). */
    alkoProductId: z
      .number({ required_error: 'alkoProductId is required', invalid_type_error: 'alkoProductId must be a number' })
      .int('alkoProductId must be an integer')
      .positive('alkoProductId must be positive'),
    /** Verified Alko product name — curation aid for the report, not persisted. */
    alkoProductName: evidenceText(256, 'alkoProductName'),
    /** The exact-match producer token; normalized via normalizeProducerKey on write. */
    producerKey: evidenceText(256, 'producerKey'),
    /** Evidence: the manufacturer behind the link. */
    manufacturer: evidenceText(256, 'manufacturer'),
    /** The foreign sibling's merchant-catalog id. */
    siblingProductId: z
      .number({ required_error: 'siblingProductId is required', invalid_type_error: 'siblingProductId must be a number' })
      .int('siblingProductId must be an integer')
      .positive('siblingProductId must be positive'),
    /** Which foreign merchant catalog siblingProductId belongs to (e.g. "systembolaget"). */
    siblingMerchant: evidenceText(64, 'siblingMerchant'),
    /** Verified sibling product name — curation aid for the report, not persisted. */
    siblingProductName: evidenceText(256, 'siblingProductName'),
    /** Evidence: verifiable source URL for the sibling claim (reachability-checked online). */
    sourceUrl: z
      .string({ required_error: 'sourceUrl is required', invalid_type_error: 'sourceUrl must be a string' })
      .trim()
      .pipe(
        z
          .string()
          .min(1, 'sourceUrl must be non-empty')
          .max(2048, 'sourceUrl must be at most 2048 characters')
          .regex(/^https?:\/\//, 'sourceUrl must be an http(s) URL'),
      ),
  })
  .refine((c) => c.alkoProductId !== c.siblingProductId, {
    message: 'alkoProductId and siblingProductId must differ (a product is its own trivial sibling)',
  });

/** The documented JSON file shape — see seed/producer-links/README.md. */
export const producerLinksImportFileSchema = z
  .strictObject({
    formatVersion: z.literal(PRODUCER_LINKS_IMPORT_FORMAT_VERSION, {
      errorMap: () => ({
        message: `formatVersion must be ${PRODUCER_LINKS_IMPORT_FORMAT_VERSION}`,
      }),
    }),
    /** True for the machine-assisted bootstrap load; documentation-only (see README). */
    bootstrap: z.boolean(),
    /** Review metadata: who reviewed these cases (never invented by the import). */
    reviewer: evidenceText(128, 'reviewer'),
    /** Review metadata: when the review happened; canonicalized to ISO-8601. */
    reviewedAt: z
      .string({ required_error: 'reviewedAt is required', invalid_type_error: 'reviewedAt must be a string' })
      .refine((value) => !Number.isNaN(Date.parse(value)), 'reviewedAt must be an ISO-8601 timestamp')
      .transform((value) => new Date(value).toISOString()),
    cases: z
      .array(producerLinkImportCaseSchema, { required_error: 'cases is required' })
      .min(1, 'cases must contain at least one case')
      .max(PRODUCER_LINKS_IMPORT_MAX_CASES, `cases must contain at most ${PRODUCER_LINKS_IMPORT_MAX_CASES} cases`),
  });

export type ProducerLinkImportCase = z.infer<typeof producerLinkImportCaseSchema>;
export type ProducerLinksImportFile = z.infer<typeof producerLinksImportFileSchema>;

/**
 * Parse + schema-validate a raw import file. Returns every issue (with
 * case index where applicable) so an operator fixes the whole file in
 * one pass instead of one error per run.
 */
export function parseProducerLinksImportFile(raw: string): {
  file: ProducerLinksImportFile | null;
  errors: string[];
} {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { file: null, errors: [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const result = producerLinksImportFileSchema.safeParse(json);
  if (result.success) {
    return { file: result.data, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
  return { file: null, errors };
}

// ---------------------------------------------------------------------------
// Source URL reachability (online mode)
// ---------------------------------------------------------------------------

export interface SourceUrlCheckOptions {
  /** Per-request budget; the default is {@link SOURCE_URL_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Injectable fetch — tests pass a fake; production uses globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface SourceUrlCheckResult {
  readonly ok: boolean;
  /** HTTP status when a response arrived. */
  readonly status?: number;
  /** Failure reason when ok is false. */
  readonly reason?: string;
}

/**
 * Verify one source URL is reachable: HEAD first, with a single GET
 * fallback for servers rejecting HEAD (405/501) or failing the request.
 * Any 2xx/3xx counts as reachable; 4xx/5xx and network/timeout errors
 * do not. Offline mode (`--offline`) skips this check entirely — it is
 * documented for tests and CI, which run without network access.
 */
export async function checkSourceUrlReachable(
  url: string,
  options: SourceUrlCheckOptions = {},
): Promise<SourceUrlCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SOURCE_URL_DEFAULT_TIMEOUT_MS;

  async function attempt(method: 'HEAD' | 'GET'): Promise<SourceUrlCheckResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method, signal: controller.signal, redirect: 'follow' });
      if (response.status >= 200 && response.status < 400) {
        return { ok: true, status: response.status };
      }
      return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(err);
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }

  const head = await attempt('HEAD');
  if (head.ok) {
    return head;
  }
  if (head.status === 405 || head.status === 501 || head.status === undefined) {
    const got = await attempt('GET');
    if (got.ok) {
      return got;
    }
    return { ok: false, status: got.status, reason: got.reason ?? head.reason };
  }
  return head;
}

// ---------------------------------------------------------------------------
// D1 handle over node:sqlite (local import runs)
// ---------------------------------------------------------------------------

interface StatementSyncLike {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

/**
 * Open a SQLite database file and expose it as a {@link D1DatabaseLike}
 * — the same structural shim the repository test harness uses, so the
 * import runs against a real SQLite engine with the committed schema
 * (apply migrations first: `scripts/seed-d1.ts --db-file …` or wrangler).
 */
export function openD1SqliteDatabase(dbPath: string): { db: DatabaseSync; d1: D1DatabaseLike } {
  const db = new DatabaseSync(dbPath);
  let batchActive = false;
  function prepare(query: string): D1PreparedStatementLike {
    const statement = db.prepare(query) as unknown as StatementSyncLike;
    let params: unknown[] = [];
    const bound: D1PreparedStatementLike = {
      bind(...values: unknown[]) {
        params = values;
        return bound;
      },
      async all<T>(): Promise<D1ResultLike<T>> {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>(): Promise<T | null> {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run(): Promise<D1ResultLike> {
        const result = statement.run(...params);
        return {
          results: [],
          success: true,
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
    };
    return bound;
  }
  return {
    db,
    d1: {
      prepare,
      async batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]> {
        if (batchActive) {
          throw new Error('concurrent batch() on the import D1 handle');
        }
        batchActive = true;
        const results: D1ResultLike[] = [];
        db.exec('BEGIN');
        try {
          for (const statement of statements) {
            results.push(await statement.run());
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        } finally {
          batchActive = false;
        }
        return results;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Product resolution + import
// ---------------------------------------------------------------------------

/** A case paired with what its two product references resolved to (null = absent). */
export interface CaseResolution {
  readonly case: ProducerLinkImportCase;
  readonly alkoProduct: { readonly id: number; readonly name: string } | null;
  readonly siblingProduct: { readonly id: number; readonly name: string } | null;
}

/**
 * Resolve every case's two product ids against product_master. Both
 * references are ids in the SAME table (schema FKs) — the bootstrap
 * file carries the merchants' own catalog ids (Alko product number,
 * Systembolaget artikelnummer; see seed/producer-links/README.md), so a
 * case whose products are not ingested under those ids resolves to null
 * and is reported as skipped instead of being written with fabricated
 * references.
 */
export async function resolveCaseProducts(
  d1: D1DatabaseLike,
  cases: readonly ProducerLinkImportCase[],
): Promise<CaseResolution[]> {
  const statement = d1.prepare('SELECT id, name FROM product_master WHERE id = ?');
  async function lookup(id: number): Promise<{ id: number; name: string } | null> {
    const row = await statement.bind(id).first<{ id: number; name: string }>();
    return row ? { id: row.id, name: row.name } : null;
  }
  const resolutions: CaseResolution[] = [];
  for (const entry of cases) {
    const [alkoProduct, siblingProduct] = await Promise.all([
      lookup(entry.alkoProductId),
      lookup(entry.siblingProductId),
    ]);
    resolutions.push({ case: entry, alkoProduct, siblingProduct });
  }
  return resolutions;
}

/** Outcome per case — the report the operator reads. */
export type CaseImportOutcome =
  | { readonly kind: 'inserted'; readonly linkId: number }
  | { readonly kind: 'skippedExistingDraft'; readonly linkId: number }
  | { readonly kind: 'skippedExistingPublished'; readonly linkId: number }
  | {
      readonly kind: 'skippedMissingProduct';
      readonly which: 'alkoProductId' | 'siblingProductId';
      readonly id: number;
    };

export interface CaseImportResult {
  readonly case: ProducerLinkImportCase;
  readonly outcome: CaseImportOutcome;
}

export interface ImportCounts {
  readonly inserted: number;
  readonly skippedExistingDraft: number;
  readonly skippedExistingPublished: number;
  readonly skippedMissingProduct: number;
}

function pairKey(alkoProductId: number, siblingProductId: number): string {
  return `${alkoProductId}:${siblingProductId}`;
}

/**
 * Import resolved cases through the repository write path. Idempotent:
 * existing pairs are skipped per the 6.1 lifecycle (see module docs) —
 * a re-run NEVER overwrites a PUBLISHED row's evidence and never
 * rewrites a DRAFT row the console may already have edited.
 */
export async function importProducerLinkCases(
  repo: ProducerLinksRepository,
  file: Pick<ProducerLinksImportFile, 'reviewer' | 'reviewedAt'>,
  resolutions: readonly CaseResolution[],
): Promise<{ results: CaseImportResult[]; counts: ImportCounts }> {
  const existing = await repo.listAll();
  const byPair = new Map(existing.map((link) => [pairKey(link.alkoProductId, link.siblingProductId), link]));

  const results: CaseImportResult[] = [];
  for (const resolution of resolutions) {
    const entry = resolution.case;
    if (resolution.alkoProduct === null) {
      results.push({
        case: entry,
        outcome: { kind: 'skippedMissingProduct', which: 'alkoProductId', id: entry.alkoProductId },
      });
      continue;
    }
    if (resolution.siblingProduct === null) {
      results.push({
        case: entry,
        outcome: { kind: 'skippedMissingProduct', which: 'siblingProductId', id: entry.siblingProductId },
      });
      continue;
    }
    const duplicate = byPair.get(pairKey(entry.alkoProductId, entry.siblingProductId));
    if (duplicate) {
      results.push({
        case: entry,
        outcome:
          duplicate.status === 'PUBLISHED'
            ? { kind: 'skippedExistingPublished', linkId: duplicate.id }
            : { kind: 'skippedExistingDraft', linkId: duplicate.id },
      });
      continue;
    }
    const created = await repo.create({
      alkoProductId: entry.alkoProductId,
      siblingProductId: entry.siblingProductId,
      // The repository normalizes the key before persistence — pass the
      // file's form through and let the single normalization rule apply.
      producerKey: normalizeProducerKey(entry.producerKey),
      manufacturer: entry.manufacturer,
      sourceUrl: entry.sourceUrl,
      reviewer: file.reviewer,
      reviewedAt: file.reviewedAt,
    });
    results.push({ case: entry, outcome: { kind: 'inserted', linkId: created.id } });
  }

  const counts: ImportCounts = {
    inserted: results.filter((r) => r.outcome.kind === 'inserted').length,
    skippedExistingDraft: results.filter((r) => r.outcome.kind === 'skippedExistingDraft').length,
    skippedExistingPublished: results.filter((r) => r.outcome.kind === 'skippedExistingPublished').length,
    skippedMissingProduct: results.filter((r) => r.outcome.kind === 'skippedMissingProduct').length,
  };
  return { results, counts };
}

/**
 * Dry-run: compute exactly what {@link importProducerLinkCases} would
 * do, without writing anything.
 */
export async function dryRunProducerLinkImport(
  repo: ProducerLinksRepository,
  resolutions: readonly CaseResolution[],
): Promise<{ results: CaseImportResult[]; counts: ImportCounts }> {
  const existing = await repo.listAll();
  const byPair = new Map(existing.map((link) => [pairKey(link.alkoProductId, link.siblingProductId), link]));

  const results: CaseImportResult[] = [];
  for (const resolution of resolutions) {
    const entry = resolution.case;
    if (resolution.alkoProduct === null) {
      results.push({
        case: entry,
        outcome: { kind: 'skippedMissingProduct', which: 'alkoProductId', id: entry.alkoProductId },
      });
      continue;
    }
    if (resolution.siblingProduct === null) {
      results.push({
        case: entry,
        outcome: { kind: 'skippedMissingProduct', which: 'siblingProductId', id: entry.siblingProductId },
      });
      continue;
    }
    const duplicate = byPair.get(pairKey(entry.alkoProductId, entry.siblingProductId));
    if (duplicate) {
      results.push({
        case: entry,
        outcome:
          duplicate.status === 'PUBLISHED'
            ? { kind: 'skippedExistingPublished', linkId: duplicate.id }
            : { kind: 'skippedExistingDraft', linkId: duplicate.id },
      });
      continue;
    }
    results.push({ case: entry, outcome: { kind: 'inserted', linkId: -1 } });
  }

  const counts: ImportCounts = {
    inserted: results.filter((r) => r.outcome.kind === 'inserted').length,
    skippedExistingDraft: results.filter((r) => r.outcome.kind === 'skippedExistingDraft').length,
    skippedExistingPublished: results.filter((r) => r.outcome.kind === 'skippedExistingPublished').length,
    skippedMissingProduct: results.filter((r) => r.outcome.kind === 'skippedMissingProduct').length,
  };
  return { results, counts };
}

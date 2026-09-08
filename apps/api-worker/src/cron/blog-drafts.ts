/**
 * Blog-draft hook at the rate-version confirmation point (task 5.1,
 * change trust-and-reach-roadmap; spec content-publication, design D3).
 *
 * ## Trigger — rate-version confirmation, not a cadence
 *
 * Draft posts are born when an operator CONFIRMS a rate dataset version
 * — the same point the TAX_CHANGE alert hook rides (task 4.1). NO cron
 * pattern registers here; {@link enqueueRateChangeBlogDrafts} is the
 * fail-open entry the confirmation path (src/cron/rate-confirmation.ts)
 * fires fire-and-forget. Fail-open is the design rule (spec: "a failure
 * SHALL NOT block the rate confirmation"): the wrapper never throws —
 * every failure is caught and logged, and the confirmation observes
 * nothing.
 *
 * ## Delta resolution
 *
 * The versioned rate delta comes straight from `tax_rules`: the rules
 * stepping INTO a confirmed version label, each paired with its
 * immediate predecessor (same tax_type + product_category, latest
 * effective_from before the new rule's). The pure core-domain builder
 * turns that delta into the FI + EN DRAFT pair (what changed, effective
 * date, typical-basket impact) and the D1BlogPostRepository persists
 * them. Draft creation is idempotent per (slug, locale): a re-run for
 * an already-drafted version is a logged skip, never a duplicate row.
 *
 * @module BlogDraftsCron
 */

import { buildRateChangeDrafts } from '../../../../packages/core-domain/src/content/content';
import type {
  RateChangeDraftInput,
  RateChangeLine,
} from '../../../../packages/core-domain/src/content/content.types';
import { D1BlogPostRepository } from '../../../../packages/data-platform/src/repositories/d1/blog-post.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** One tax_rules row the delta query projects. */
interface VersionRuleRow {
  readonly id: number;
  readonly tax_type: string;
  readonly product_category: string;
  readonly calculation_formula_reference: string;
  readonly rate: number;
  readonly effective_from: string;
  readonly version_label: string;
}

/**
 * Rules stepping INTO one of the confirmed versions. Existence of any
 * earlier same-line rule qualifies the rule as a CHANGE candidate; the
 * per-line predecessor rate resolves in the loop below.
 */
const VERSION_DELTA_SQL = `
  SELECT cur.id, cur.tax_type, cur.product_category,
         cur.calculation_formula_reference, cur.rate,
         cur.effective_from, cur.version_label
    FROM tax_rules cur
   WHERE cur.version_label IN (%VERSIONS%)
     AND EXISTS (
       SELECT 1 FROM tax_rules prev
        WHERE prev.tax_type = cur.tax_type
          AND prev.product_category = cur.product_category
          AND prev.effective_from < cur.effective_from
     )
   ORDER BY cur.id ASC`;

/** The resolved delta — the pure builder's input. */
export interface VersionDelta {
  /** Announced effective date (ISO, earliest of the changed lines). */
  readonly effectiveFrom: string;
  readonly changes: readonly RateChangeLine[];
}

/**
 * Resolve the versioned rate delta for the confirmed versions from D1.
 * Null when the versions carry no predecessor-paired rate change (a
 * confirmation without changes announces nothing). Exported for tests;
 * the hook's `deps` seam overrides it entirely.
 */
export async function resolveVersionDelta(
  d1: D1DatabaseLike,
  confirmedVersions: readonly string[],
): Promise<VersionDelta | null> {
  if (confirmedVersions.length === 0) return null;

  const placeholders = confirmedVersions.map(() => '?').join(', ');
  const sql = VERSION_DELTA_SQL.replace('%VERSIONS%', placeholders);
  const rows = (
    await d1.prepare(sql).bind(...confirmedVersions).all<VersionRuleRow>()
  ).results;
  if (rows.length === 0) return null;

  const changes: RateChangeLine[] = [];
  let effectiveFrom = rows[0].effective_from;
  for (const row of rows) {
    // Predecessor rate: the latest earlier rule for the same line.
    const prev = await d1
      .prepare(
        `SELECT rate FROM tax_rules
          WHERE tax_type = ? AND product_category = ?
            AND effective_from < ?
          ORDER BY effective_from DESC, id DESC LIMIT 1`,
      )
      .bind(row.tax_type, row.product_category, row.effective_from)
      .first<{ rate: number }>();
    if (prev === null || prev.rate === row.rate) continue;
    changes.push({
      taxType: row.tax_type,
      productCategory: row.product_category,
      formulaReference: row.calculation_formula_reference,
      fromRate: prev.rate,
      toRate: row.rate,
    });
    if (row.effective_from < effectiveFrom) effectiveFrom = row.effective_from;
  }

  if (changes.length === 0) return null;
  return { effectiveFrom, changes };
}

/** Result of one draft run — logged by the wrapper, asserted by tests. */
export interface BlogDraftRunResult {
  /** Confirmed versions the run was scoped to. */
  readonly confirmedVersions: readonly string[];
  /** Versioned rate lines that changed (predecessor-paired). */
  readonly changedLines: number;
  /** DRAFT rows created (0 or the FI+EN pairs). */
  readonly draftsCreated: number;
  /** Draft rows already present (idempotent re-run skips). */
  readonly draftsSkipped: number;
}

/**
 * One blog-draft run: resolve the confirmed versions' delta, build the
 * FI + EN drafts, persist each as a DRAFT row. Per-draft failures are
 * isolated (one locale failing must not drop the other); the unique
 * (slug, locale) key turns a re-run into a counted skip.
 */
export async function handleRateChangeBlogDrafts(
  env: Env,
  log: Logger,
  deps: {
    confirmedVersions?: readonly string[];
    resolveDelta?: (confirmedVersions: readonly string[]) => Promise<VersionDelta | null>;
    /** Draft-persist seam (tests) — defaults to the D1 blog repository. */
    createDraft?: typeof D1BlogPostRepository.prototype.create;
  } = {},
): Promise<BlogDraftRunResult> {
  const confirmedVersions = deps.confirmedVersions ?? [];
  const delta = deps.resolveDelta
    ? await deps.resolveDelta(confirmedVersions)
    : await resolveVersionDelta(env.DB, confirmedVersions);

  if (delta === null) {
    return { confirmedVersions: [...confirmedVersions], changedLines: 0, draftsCreated: 0, draftsSkipped: 0 };
  }

  // A multi-version confirmation folds into one post keyed by the first
  // (dominant) version label — the delta lines still name their own
  // categories; per-version posts would fragment one announcement.
  const input: RateChangeDraftInput = {
    versionLabel: confirmedVersions[0] ?? '',
    effectiveFrom: delta.effectiveFrom,
    changes: delta.changes,
  };
  const drafts = buildRateChangeDrafts(input);

  const repo = new D1BlogPostRepository(env.DB);
  const createDraft = deps.createDraft ?? repo.create.bind(repo);
  let created = 0;
  let skipped = 0;
  for (const draft of drafts) {
    // Idempotency: the (slug, locale) unique key — an existing row is a
    // skip, not an overwrite (a draft a human may have edited stays).
    const existing = await repo.findBySlugAndLocale(draft.slug, draft.locale);
    if (existing !== null) {
      skipped += 1;
      continue;
    }
    try {
      await createDraft({
        slug: draft.slug,
        locale: draft.locale,
        title: draft.title,
        bodyMarkdown: draft.bodyMarkdown,
        rateDatasetVersion: draft.rateDatasetVersion,
      });
      created += 1;
    } catch (err) {
      // Per-draft isolation: log and keep going — the fail-open rule
      // applies per draft, and the confirmation is never blocked.
      log.error({
        message: `Blog draft creation failed for (${draft.slug}, ${draft.locale}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      });
    }
  }

  log.info({
    message: `Rate-change blog drafts: ${created} created, ${skipped} skipped ` +
      `(${delta.changes.length} changed lines for [${confirmedVersions.join(', ')}])`,
    confirmedVersions: [...confirmedVersions],
  });

  return {
    confirmedVersions: [...confirmedVersions],
    changedLines: delta.changes.length,
    draftsCreated: created,
    draftsSkipped: skipped,
  };
}

/**
 * The fail-open wrapper — the entry the rate-confirmation path awaits
 * (via waitUntil). Never throws; every failure is caught, logged, and
 * the wrapper resolves to null so the call site cannot observe anything
 * but success (design D3's fail-open rule; the TAX_CHANGE wrapper twin).
 */
export async function enqueueRateChangeBlogDrafts(
  env: Env,
  log: Logger,
  confirmedVersions: readonly string[] = [],
): Promise<BlogDraftRunResult | null> {
  try {
    return await handleRateChangeBlogDrafts(env, log, { confirmedVersions });
  } catch (err) {
    log.error({
      message: `Blog draft creation failed (fail-open, the confirmation is unaffected): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
      confirmedVersions: [...confirmedVersions],
    });
    return null;
  }
}

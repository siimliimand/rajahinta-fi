/**
 * Curated lists route (task 7.2, change product-roadmap-phases-1-4)
 * — GET /api/v1/lists and GET /api/v1/lists/:slug, design R10, spec:
 * curated-lists.
 *
 * Guard/rate-limit composition (route-scoped, product-dupes precedent):
 *   GET /api/v1/lists            FeatureFlag(CURATED_LISTS) → RateLimit(DEFAULT) → handler
 *   GET /api/v1/lists/:slug      FeatureFlag(CURATED_LISTS) → RateLimit(DEFAULT) → handler
 *
 * LIST REGISTRY (R10 "of a listed slug"): the set of public lists —
 * slug, display title, and curation criteria — is this module's static
 * catalog. Criteria are editorial policy (mirrored in docs/ by task
 * 7.4), so a new list IS a code change by design; the entries within a
 * list are the operator-managed part (console CRUD, no deploys, task
 * 7.1). There is no lists table — data minimization forbids one whose
 * only column values would be this registry.
 *
 * Slug semantics (the distinction task 7.3's rendering needs):
 *   - unknown slug            → 404 `List "<slug>" not found`
 *   - known slug, 0 published → 200 with empty `entries` (the page
 *     renders its empty state; criteria still travel so the page can
 *     explain what WILL qualify)
 * The lookup key is normalizeListSlug'd (trim + lowercase) before the
 * registry match, so `Alkon-Hylkaamat` over the wire hits the
 * canonical `alkon-hylkaamat`.
 *
 * Published discipline: entries come ONLY from the repository's
 * PUBLISHED-by-slug read (composite (list_slug, status) index) — draft
 * entries are unrepresentable in every response, spec "Draft entries
 * hidden".
 *
 * Entry projection (data minimization): id, target (productId /
 * externalRef — exactly one, the outbound-link target the page turns
 * into a tracked redirect), rationale, evidenceLinks (validated on
 * every repository read). reviewer/status/timestamps are internal
 * editorial metadata — accountability lives in the audit trail, not
 * the public payload.
 *
 * The catalog endpoint serves the registry lists that currently have
 * at least one PUBLISHED entry — the sitemap's slug source (flag off →
 * 403 → zero list URLs) and the future lists-index feed.
 *
 * Rate-limit profile: DEFAULT — the public unauthenticated read
 * profile (60/min, product-dupes precedent).
 *
 * @module CuratedListsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, requireFeatureFlag } from '../middleware/feature-flags';
import { requireRateLimit } from '../middleware/rate-limit';
import {
  D1CuratedEntriesRepository,
  normalizeListSlug,
  type EvidenceLink,
} from '../../../../packages/data-platform/src/repositories/d1/curated-entries.repository';

/** A public list's identity + editorial standard (the registry row). */
interface CuratedListDescriptor {
  /** Canonical (already normalized) slug — the public lookup key. */
  readonly slug: string;
  /** Display title as it appears on the page. */
  readonly title: string;
  /** The documented curation criteria rendered on the page (spec
   * "Curation criteria documented and shown"). */
  readonly criteria: readonly string[];
}

/**
 * The public list registry. First (and for now only) list: design R10's
 * example — products Alko declined or delisted that remain available in
 * the EU. The criteria statements mirror the schema invariants of task
 * 7.1 (rationale + at least one evidence link are NOT NULL) and the
 * full policy document lands in docs/ with task 7.4.
 */
const CURATED_LIST_REGISTRY: readonly CuratedListDescriptor[] = [
  {
    slug: 'alkon-hylkaamat',
    title: 'Alkon hylkäämät',
    criteria: [
      'Tuote on jätetty Alkon valikoimaan hyväksymättä tai poistettu Alkon valikoimasta.',
      'Tuote on todistetusti saatavana vähintään yhdestä EU-alueen verkkokaupasta.',
      'Jokaisella listauksella on toimituksellinen perustelu ja vähintään yksi todistelulinkki (esimerkiksi arvio, palkinto tai virallinen lähde).',
    ],
  },
];

/** One published entry — the page-facing evidence projection. */
interface CuratedListEntry {
  readonly id: number;
  /** The Alko product reference — null exactly when externalRef is set. */
  readonly productId: number | null;
  /** The external reference — null exactly when productId is set. */
  readonly externalRef: string | null;
  /** The mandatory editorial justification. */
  readonly rationale: string;
  /** Validated evidence links (non-empty array of {label, url}). */
  readonly evidenceLinks: readonly EvidenceLink[];
}

interface CuratedListResponse {
  readonly slug: string;
  readonly title: string;
  readonly criteria: readonly string[];
  readonly entries: readonly CuratedListEntry[];
}

/** Catalog row — identity only; criteria live on the per-slug payload. */
interface CuratedListSummary {
  readonly slug: string;
  readonly title: string;
}

interface CuratedListsCatalogResponse {
  readonly lists: readonly CuratedListSummary[];
}

function findDescriptor(slug: string): CuratedListDescriptor | undefined {
  return CURATED_LIST_REGISTRY.find((list) => list.slug === slug);
}

async function getListBySlug(c: Context<AppEnv>): Promise<Response> {
  const slug = normalizeListSlug(c.req.param('slug') ?? '');
  try {
    const descriptor = findDescriptor(slug);
    if (descriptor === undefined) {
      throw new ApiHttpError(404, `List "${slug}" not found`);
    }

    // PUBLISHED rows only — the repository's composite-index read path.
    const published = await new D1CuratedEntriesRepository(
      c.env.DB,
    ).listPublishedBySlug(descriptor.slug);

    const body: CuratedListResponse = {
      slug: descriptor.slug,
      title: descriptor.title,
      criteria: descriptor.criteria,
      entries: published.map((entry) => ({
        id: entry.id,
        productId: entry.productId,
        externalRef: entry.externalRef,
        rationale: entry.rationale,
        evidenceLinks: entry.evidenceLinks,
      })),
    };
    return c.json(body);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to fetch curated list',
    );
  }
}

async function getListCatalog(c: Context<AppEnv>): Promise<Response> {
  try {
    const repo = new D1CuratedEntriesRepository(c.env.DB);
    // Only lists with live published content — a registry row with no
    // published entries is not yet a public list (and must not surface
    // in the sitemap).
    const lists: CuratedListSummary[] = [];
    for (const descriptor of CURATED_LIST_REGISTRY) {
      const published = await repo.listPublishedBySlug(descriptor.slug);
      if (published.length > 0) {
        lists.push({ slug: descriptor.slug, title: descriptor.title });
      }
    }
    const body: CuratedListsCatalogResponse = { lists };
    return c.json(body);
  } catch (err) {
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to fetch curated list catalog',
    );
  }
}

/** Register both list reads behind their flag gate + limiter. */
export function registerCuratedListsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.get(
    '/api/v1/lists',
    requireFeatureFlag(FeatureFlag.CURATED_LISTS),
    requireRateLimit('DEFAULT'),
    getListCatalog,
  );
  app.get(
    '/api/v1/lists/:slug',
    requireFeatureFlag(FeatureFlag.CURATED_LISTS),
    requireRateLimit('DEFAULT'),
    getListBySlug,
  );
  return app;
}

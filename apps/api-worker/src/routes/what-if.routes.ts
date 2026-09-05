/**
 * Excise what-if simulator route port (task 8.2, change
 * product-roadmap-phases-1-4) — POST /api/v1/what-if/excise,
 * design R11, spec: excise-what-if-simulator.
 *
 * Guard/rate-limit composition (event-calc/trip precedent):
 *   POST /api/v1/what-if/excise
 *     FeatureFlag(EXCISE_WHAT_IF) → RateLimit(CALCULATOR) → handler
 * ANONYMOUS by spec: no session guard — the endpoint requires no
 * account and stores no personal data.
 *
 * EPHEMERAL BY DESIGN (binding, R11): the module is pure — no tax rule
 * row is mutated and NO scenario is persisted server-side. Unlike the
 * calculator/trip routes there is deliberately NO idempotency lookup or
 * store here: the spec mandates no caching, a cached what-if result
 * would be scenario storage by another name, and the response is cheap
 * to recompute. The share token below is the only carry-over state,
 * and it lives with the client.
 *
 * Baseline resolution: each product's baseline rule is resolved through
 * the SAME path the calculator routes use — AlcoholExciseService over
 * D1TaxRuleRepositoryAdapter (calculator.routes.ts parity). The
 * engine's own rule selection (ABV tiers, other-fermented formula
 * resolution, exemption, zero-rate fallback) decides the baseline; the
 * route only NAMES the resolved rule (formula reference + raw rate +
 * version + rule id + reliability) for the pure module to recompute
 * from. One `asOf` instant is resolved per request — the module's
 * single-baseline-version invariant (MixedTaxDatasetVersionsError)
 * holds by construction for engine-resolved data, and the result cites
 * exactly the version the engine resolved (spec: baseline version
 * cited).
 *
 * SHARE TOKEN (spec: sharing works by encoding inputs into an opaque
 * token, decoded read-only by the embed route): `wi1.<base64url
 * payload>.<checksum>` — a versioned envelope of the scenario INPUTS
 * only (hypothetical rate + product facts; never results, never rule
 * rows). Deterministic: encode∘decode is the identity, so the same
 * scenario always yields the same token. Integrity is a plain FNV-1a
 * checksum over the payload: it deterministically rejects corrupted or
 * mistyped links, and — because the payload is non-sensitive, user-
 * supplied scenario input that is re-validated against the SAME zod
 * bounds on decode and recomputed server-side — no cryptographic
 * tamper-proofing is required by the spec (a forged-but-valid token
 * can only produce a different hypothetical, never an exposure or a
 * stored row). Size-bounded: tokens over MAX_SHARE_TOKEN_CHARS are
 * rejected outright.
 *
 * The structural HYPOTHETICAL disclaimer rides the module's result
 * (WHATIF_DISCLAIMER — spec: disclaimer travels with the result) on
 * EVERY 200 response; it is never stripped or replaced here.
 *
 * @module WhatIfRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, requireFeatureFlag } from '../middleware/feature-flags';
import { requireRateLimit } from '../middleware/rate-limit';
import { parseDto } from './support';
import { AlcoholExciseService, TAX_TYPES, normaliseCategory } from '../adapters/core-domain-bridge';
import { calculateWhatIfExcise } from '../../../../packages/core-domain/src/whatif/whatif';
import {
  InvalidWhatIfInputError,
  MixedTaxDatasetVersionsError,
} from '../../../../packages/core-domain/src/whatif/whatif.types';
import type {
  WhatIfBaselineRule,
  WhatIfProductInput,
  WhatIfScenarioResult,
} from '../../../../packages/core-domain/src/whatif/whatif.types';
import {
  DEFAULT_RATES,
  resolveOtherFermentedFormula,
} from '../../../../packages/core-domain/src/tax/services/alcohol-excise.math';
import { TAX_CATEGORY_KEYS } from '../../../../packages/core-domain/src/tax/tax-categories';
import { D1TaxRuleRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';

// ---------------------------------------------------------------------------
// Validation — caps documented in the module doc (spec: rate bounds,
// product list caps, category validation)
// ---------------------------------------------------------------------------

/** Hypothetical rate is € per formula unit; the cap is a sanity bound
 *  orders of magnitude above any real Finnish rate (module floor: ≥ 0). */
const MAX_HYPOTHETICAL_RATE = 1000;
/** Transport cap on scenario size — the module itself has no list cap. */
const MAX_PRODUCTS = 20;
/** Price/volume sanity caps (trip-feasibility parity). */
const MAX_PRICE_CENTS = 10_000_000;
const MAX_VOLUME_LITRES = 10_000;
const MAX_ID_LENGTH = 100;

const RATE_MESSAGE = `hypotheticalRate must be a finite number between 0 and ${MAX_HYPOTHETICAL_RATE} (€ per formula unit)`;
const CATEGORY_MESSAGE = `category must be one of: ${TAX_CATEGORY_KEYS.join(', ')}`;

/** One scenario product — caller facts only; the baseline is resolved server-side. */
const whatIfProductSchema = z.object({
  id: z.string().trim().min(1).max(MAX_ID_LENGTH),
  category: z.enum(TAX_CATEGORY_KEYS, {
    errorMap: () => ({ message: CATEGORY_MESSAGE }),
  }),
  /** ABV as a fraction in [0, 1] — the engine's and module's contract. */
  abv: z.number().finite().min(0).max(1),
  volumeLitres: z.number().finite().min(0).max(MAX_VOLUME_LITRES),
  alkoPriceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  importPriceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
});

const whatIfScenarioSchema = z
  .object({
    hypotheticalRate: z
      .number()
      .finite()
      .min(0, { message: RATE_MESSAGE })
      .max(MAX_HYPOTHETICAL_RATE, { message: RATE_MESSAGE }),
    products: z.array(whatIfProductSchema).min(1).max(MAX_PRODUCTS),
  })
  .superRefine((dto, ctx) => {
    const seen = new Set<string>();
    for (const [index, product] of dto.products.entries()) {
      if (seen.has(product.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['products', index, 'id'],
          message: `products carries the id "${product.id}" more than once`,
        });
      }
      seen.add(product.id);
    }
  });

type WhatIfScenarioDto = z.infer<typeof whatIfScenarioSchema>;

// ---------------------------------------------------------------------------
// Share-token codec — exported for the 8.3 embed route (read-only decode)
// ---------------------------------------------------------------------------

const SHARE_TOKEN_PREFIX = 'wi1';
/** Size bound — 20 fully-named products encode far below this; anything
 *  larger is rejected before parsing. */
const MAX_SHARE_TOKEN_CHARS = 8192;

/** One product inside a share token — the scenario INPUTS, nothing else. */
export interface WhatIfShareProduct {
  readonly id: string;
  readonly category: string;
  readonly abv: number;
  readonly volumeLitres: number;
  readonly alkoPriceCents: number;
  readonly importPriceCents: number;
}

/** The scenario a share token carries. */
export interface WhatIfShareScenario {
  readonly hypotheticalRate: number;
  readonly products: readonly WhatIfShareProduct[];
}

/** The token is malformed, corrupted, oversized, or violates the bounds. */
export class WhatIfShareTokenError extends Error {
  constructor(detail: string) {
    super(`invalid what-if share token: ${detail}`);
    this.name = 'WhatIfShareTokenError';
  }
}

/** Versioned envelope — field order IS the canonical encoding order. */
interface ShareEnvelope {
  v: 1;
  rate: number;
  p: WhatIfShareProduct[];
}

/** FNV-1a 32-bit — corruption check only, not a cryptographic MAC (module doc). */
function fnv1a32(input: string): string {
  let hash = 0x0811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Encode scenario inputs into the opaque share token (deterministic). */
export function encodeWhatIfShareToken(scenario: WhatIfShareScenario): string {
  const envelope: ShareEnvelope = {
    v: 1,
    rate: scenario.hypotheticalRate,
    p: scenario.products.map((product) => ({
      id: product.id,
      category: product.category,
      abv: product.abv,
      volumeLitres: product.volumeLitres,
      alkoPriceCents: product.alkoPriceCents,
      importPriceCents: product.importPriceCents,
    })),
  };
  const payload = JSON.stringify(envelope);
  const token = `${SHARE_TOKEN_PREFIX}.${base64UrlEncode(payload)}.${fnv1a32(payload)}`;
  if (token.length > MAX_SHARE_TOKEN_CHARS) {
    throw new WhatIfShareTokenError(
      `encoded scenario exceeds the ${MAX_SHARE_TOKEN_CHARS}-character token bound`,
    );
  }
  return token;
}

/**
 * Decode a share token back to its scenario inputs — READ-ONLY: no
 * rule data is resolved, nothing is computed, nothing is stored here
 * (the embed route recomputes through the same pure module). Throws
 * {@link WhatIfShareTokenError} on any malformation, corruption,
 * oversize, or bound violation.
 */
export function decodeWhatIfShareToken(token: string): WhatIfShareScenario {
  if (token.length > MAX_SHARE_TOKEN_CHARS) {
    throw new WhatIfShareTokenError(`token exceeds the ${MAX_SHARE_TOKEN_CHARS}-character bound`);
  }
  const segments = token.split('.');
  if (segments.length !== 3 || segments[0] !== SHARE_TOKEN_PREFIX) {
    throw new WhatIfShareTokenError('malformed token envelope');
  }
  const [, payloadSegment, checksumSegment] = segments;

  let payload: string;
  try {
    payload = base64UrlDecode(payloadSegment);
  } catch {
    throw new WhatIfShareTokenError('payload is not valid base64url');
  }
  if (fnv1a32(payload) !== checksumSegment) {
    throw new WhatIfShareTokenError('checksum mismatch — token corrupted or altered');
  }

  let envelope: ShareEnvelope;
  try {
    envelope = JSON.parse(payload) as ShareEnvelope;
  } catch {
    throw new WhatIfShareTokenError('payload is not valid JSON');
  }
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    envelope.v !== 1 ||
    typeof envelope.rate !== 'number' ||
    !Array.isArray(envelope.p)
  ) {
    throw new WhatIfShareTokenError('unknown payload shape');
  }

  // Re-validate against the SAME bounds the POST endpoint enforces —
  // a token can never smuggle in a scenario the API itself would reject.
  const parsed = whatIfScenarioSchema.safeParse({
    hypotheticalRate: envelope.rate,
    products: envelope.p,
  });
  if (!parsed.success) {
    throw new WhatIfShareTokenError(
      `payload violates the scenario bounds (${parsed.error.issues[0]?.message ?? 'unknown'})`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Baseline resolution — the calculator route's exact engine path
// ---------------------------------------------------------------------------

/**
 * Name the rule the engine applied: AlcoholExciseService.calculate is
 * THE baseline path (calculator parity); the matching tax-rule row is
 * joined back by the rule id the engine reports, so tier selection,
 * exemption handling, and fallback semantics are never reimplemented
 * here. The formula reference mirrors the engine's other-fermented
 * override (computeFromRule parity) so the module recomputes the
 * baseline through the exact formula the engine applied.
 */
async function resolveBaselineRule(
  exciseService: AlcoholExciseService,
  taxRepo: D1TaxRuleRepositoryAdapter,
  product: WhatIfScenarioDto['products'][number],
  asOf: Date,
): Promise<WhatIfBaselineRule> {
  const category = normaliseCategory(product.category);
  const excise = await exciseService.calculate(
    product.category,
    product.abv,
    product.volumeLitres,
    asOf,
  );

  if (excise.ruleId !== null) {
    const rules = await taxRepo.findAllApplicable(TAX_TYPES.excise, category, asOf);
    const rule = rules.find((candidate) => candidate.id === excise.ruleId);
    if (rule) {
      return {
        formulaRef:
          category === 'other_fermented'
            ? resolveOtherFermentedFormula(product.category)
            : rule.calculationFormulaReference,
        // Raw rule rate (decimal string → number, engine parseDecimal parity)
        // — the number the formula dispatch multiplies by, not the effective
        // per-litre figure ExciseResult exposes.
        rate: Number(rule.rate),
        taxDatasetVersion: excise.taxDatasetVersion,
        ruleId: rule.id,
        reliability: excise.reliability,
      };
    }
  }

  // Engine zero-rate fallback parity (computeFallback): the category's
  // DEFAULT_RATES formula at its zero rate — never a silent plausible number.
  const defaults = DEFAULT_RATES[category] ?? DEFAULT_RATES.other_fermented;
  return {
    formulaRef: defaults.formula,
    rate: defaults.rate,
    taxDatasetVersion: excise.taxDatasetVersion,
    ruleId: excise.ruleId,
    reliability: excise.reliability,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/what-if/excise
// ---------------------------------------------------------------------------

/** The 200 payload: the pure module result + the share token for the inputs. */
type WhatIfResponse = WhatIfScenarioResult & { readonly shareToken: string };

async function calculateWhatIfExciseRoute(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, whatIfScenarioSchema);

  // ONE resolution instant per request — every product's baseline is
  // resolved against the same active dataset window.
  const asOf = new Date();
  const taxRepo = new D1TaxRuleRepositoryAdapter(c.env.DB);
  const exciseService = new AlcoholExciseService(taxRepo);

  const result: WhatIfScenarioResult = await (async () => {
    try {
      const products: WhatIfProductInput[] = [];
      for (const product of dto.products) {
        products.push({
          id: product.id,
          category: product.category,
          abv: product.abv,
          volumeLitres: product.volumeLitres,
          alkoPriceCents: product.alkoPriceCents,
          importPriceCents: product.importPriceCents,
          baselineRule: await resolveBaselineRule(exciseService, taxRepo, product, asOf),
        });
      }

      return calculateWhatIfExcise({
        hypotheticalRate: dto.hypotheticalRate,
        products,
      });
    } catch (err) {
      // Engine-resolved data spanning two dataset versions at one
      // instant is curated-data inconsistency — operator-visibility
      // 500, not a client 400 (InconsistentNorms/Allowances parity).
      if (err instanceof MixedTaxDatasetVersionsError) {
        throw new ApiHttpError(500, {
          statusCode: 500,
          message: err.message,
          error: 'InconsistentTaxDatasets',
        });
      }
      // Defense in depth: zod makes the input-shaped reasons
      // unreachable, but the module is callable with any shape.
      if (err instanceof InvalidWhatIfInputError) {
        throw new ApiHttpError(400, {
          statusCode: 400,
          message: err.message,
          error: 'ValidationError',
        });
      }
      throw err;
    }
  })();

  // The token encodes the INPUTS (never the result): the embed route
  // decodes read-only and recomputes through the same pure module.
  const shareToken = encodeWhatIfShareToken({
    hypotheticalRate: dto.hypotheticalRate,
    products: dto.products,
  });

  const body: WhatIfResponse = { ...result, shareToken };
  return c.json(body);
}

/** Register the what-if handler behind its flag gate + limiter (anonymous). */
export function registerWhatIfRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post(
    '/api/v1/what-if/excise',
    requireFeatureFlag(FeatureFlag.EXCISE_WHAT_IF),
    requireRateLimit('CALCULATOR'),
    calculateWhatIfExciseRoute,
  );
  return app;
}

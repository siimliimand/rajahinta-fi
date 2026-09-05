/**
 * Event calculator API (tasks 4.3 + 4.5, change product-roadmap-phases-1-4) —
 * POST /api/v1/event-calc over the task-4.2 pure eventcalc module and
 * the task-4.1 D1ConsumptionNormsRepository.
 *
 * Per request: resolve the PUBLISHED norms effective on the event date
 * (half-open window, one row per drink type, each naming its
 * `versionLabel`), feed them into `calculateEventShoppingList`, and
 * return the module's result plus a STRUCTURAL norms-are-estimates
 * disclaimer field (disclaimer.ts architecture rule: the disclaimer is
 * part of the result object, server-side — not a UI-only string).
 *
 * V2 CROSS-BORDER SOURCING (task 4.5, design R6) — an optional
 * `sourcing` request section switches the response from the MVP
 * shopping list to shopping list + sourcing `plan` (buy here vs bring
 * from a candidate country per drink-type line). MVP requests (no
 * `sourcing` field) keep byte-identical responses AND cache keys — the
 * V2 fields are strictly additive. Architecture split (binding):
 *
 *   - The PURE eventcalc module (`sourcing.ts`) only assigns: it
 *     receives per-source resolved cost figures and picks the cheapest
 *     under the documented tie-break; it never calls engines.
 *   - THIS ROUTE is where the landed-cost engines run: per priced line
 *     per source it maps user-supplied retail bases plus
 *     engine-computed figures into the module's `SourcingCostOption`.
 *
 * Sourcing cost resolution, component by component (the
 * `ComputedItemCostsResult` shape, transport line included):
 *
 *   - Retail basis (per litre, per source) is USER-SUPPLIED. No
 *     per-drink-type retail price dataset exists in the platform, and
 *     inventing representative shelf prices server-side would break
 *     every-figure-traceable; consumer-supplied money inputs are the
 *     roadmap's established pattern (the trip calculator's travel cost
 *     and price difference, task 5.2). The basis is therefore honestly
 *     labelled `ESTIMATED` on every option, domestic and foreign alike.
 *     Line retail = round(pricePerLitre × purchasedMl / 1000) —
 *     deterministic half-up rounding to whole cents on integer inputs.
 *   - Excise (foreign sources only — the domestic shelf price is
 *     tax-inclusive, its excise/duty components are structurally zero
 *     and labelled `UNAVAILABLE`: no separate data point exists):
 *     AlcoholExciseService.calculate(drinkType, abv, purchasedLitres,
 *     asOf: eventDate) — the EVENT DATE is the relevant date, so a
 *     past rate version resolves exactly like the norms do.
 *   - Container duty (foreign only): ContainerDutyService.calculate(
 *     purchasedLitres, container, depositSystemStatus: null, asOf) —
 *     deposit status unknown is ESTIMATED by the engine (guardrail:
 *     never silently assumed).
 *   - Transport: the contract slot exists on every option, but the
 *     MVP request carries no carrier/package-tier dimension to feed
 *     TransportEstimationService, so it resolves to 0 cents /
 *     `UNAVAILABLE` and the omission is VISIBLE in the per-line
 *     statuses — never a silently assumed free trip. Wiring a carrier
 *     choice is the trip module's territory (tasks 5.2/5.3).
 *   - Confidence: ConfidenceFrameworkService over the four real
 *     components (productPrice, excise, containerDuty, transport).
 *     computeItemCosts' fifth input (classification) has no
 *     transaction counterpart for an anonymous category line and is
 *     deliberately absent.
 *
 * Budget: optional `budgetCents`. An exceeded budget NEVER truncates
 * the plan — the module returns the complete cheapest assignment with
 * an explicit `budget { met: false, overrunCents }` block (documented
 * module semantics; the UI renders the state).
 *
 * Idempotency: MVP keys and payloads unchanged (above). V2 requests
 * derive `event-calc-v2:` keys that add the CANONICALIZED sourcing
 * section (lines sorted by drink type, foreign entries by country —
 * so equal plans share one key regardless of array order) and the
 * resolved tax dataset versions to the norms version already present;
 * the lookup version check covers them all. Client
 * `x-idempotency-key` values travel verbatim (calculator parity).
 *
 * Packing opt-in: `sourcing.packing: true` attaches a packing
 * section computed by the R4 packing module over the FOREIGN-sourced
 * haul (the part of the event's drinks that must travel). Event lines
 * are drink types, not products — there are no product_dimensions rows
 * to consult, so units carry the request's container material with
 * null dimensions and degrade to the packing module's own
 * MISSING_DIMENSIONS exclusion path (`ESTIMATED` status), never
 * invented geometry. Like the basket section (task 3.3), the section
 * is gated per-request by PACKING_OPTIMIZER: flag off → the response
 * keeps its exact flag-less shape.
 *
 * Middleware chain per request (in registration order):
 *
 *   requireFeatureFlag('EVENT_CALCULATOR') → requireRateLimit('CALCULATOR')
 *   → handler
 *
 * The flag gate composes here, not in guards.ts: this is a NEW surface
 * with no Nest counterpart, and guards.ts is the Nest-parity enumeration.
 * Flag BEFORE limiter (alerts ordering rationale): a flag-off deployment
 * rejects with 403 before any limiter DO traffic. The route is anonymous
 * (no session) like the calculator surface — the per-IP CALCULATOR
 * profile (10/min) applies.
 *
 * Documented decisions:
 * - Caps: guests 1..500, durationHours 1..72. The module accepts 0, but
 *   the API surface targets real events — a zero/absent dimension is a
 *   caller bug and rejects 400 instead of returning an all-zero list.
 *   500 guests sits far above any private gathering the MVP targets
 *   (larger events are professional-catering scale) and bounds the plan
 *   enumeration; 72 whole hours covers a three-day festival weekend.
 *   Fractional hours are unrepresentable at the module's exactness
 *   contract (whole hours only) and reject as non-integer. Out-of-cap
 *   rejects 400 ValidationError per the sibling convention (alerts/
 *   basket manual validation), not 422.
 * - Sourcing caps: ≤6 priced lines (the canonical drink-type set),
 *   ≤5 foreign sources per line (the fixed candidate set), prices
 *   1..100 000 cents/litre, ABV 0.1..100 %, budget 1..10 000 000
 *   cents (a €100 000 event budget bounds any realistic gathering).
 * - No published norms: 200 with the module's `NO_PUBLISHED_NORMS`
 *   result VALUE plus the disclaimer — an expected operational state
 *   (nothing published yet), not a missing resource; the module models
 *   it as a value (unitprice 'unavailable' precedent) and the API
 *   boundary preserves that. 404 stays reserved for unknown resources.
 *   This state is identical with or without a sourcing section: no
 *   norms means no shopping list, hence no lines to source.
 * - Version-aware idempotency (calculator/basket parity): the resolved
 *   norms version IS the dataset version. It is resolved FIRST and is
 *   part of the derived key AND the lookup version check, so repeated
 *   identical requests within one norms version return a
 *   byte-identical result (X-Cache HIT) while a norms bump produces a
 *   fresh result (new key). The NO_PUBLISHED_NORMS path is deliberately
 *   not cached: its result depends on input alone, and a cached empty
 *   state could outlive a norms publication.
 *
 * @module EventCalcRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, requireFeatureFlag, FeatureFlagService } from '../middleware/feature-flags';
import { requireRateLimit } from '../middleware/rate-limit';
import { parseDto } from './support';
import { calculateEventShoppingList } from '../../../../packages/core-domain/src/eventcalc/eventcalc';
import { buildEventSourcingPlan } from '../../../../packages/core-domain/src/eventcalc/sourcing';
import { suggestPacking } from '../../../../packages/core-domain/src/packing/packing';
import {
  InconsistentNormsError,
  InvalidEventInputError,
  MixedNormVersionsError,
  EVENT_CALC_DRINK_TYPES,
} from '../../../../packages/core-domain/src/eventcalc/eventcalc.types';
import type {
  EventCalcResult,
  EventDrinkType,
  EventNormRow,
} from '../../../../packages/core-domain/src/eventcalc/eventcalc.types';
import {
  SOURCING_COUNTRY_ORDER,
  SourcingInputError,
} from '../../../../packages/core-domain/src/eventcalc/sourcing.types';
import type {
  EventSourcingPlan,
  SourcingCostOption,
} from '../../../../packages/core-domain/src/eventcalc/sourcing.types';
import type {
  PackingItem,
  PackingMaterial,
  PackingSuggestion,
} from '../../../../packages/core-domain/src/packing/packing.types';
import type { Disclaimer } from '../../../../packages/core-domain/src/calculator/calculator.types';
import {
  AlcoholExciseService,
  ContainerDutyService,
  ConfidenceFrameworkService,
  ReliabilityService,
} from '../adapters/core-domain-bridge';
import { D1ConsumptionNormsRepository } from '../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import { D1TaxRuleRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1CarrierBoxTypesRepository } from '../../../../packages/data-platform/src/repositories/d1/carrier-box-types.repository';
import {
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';

// ---------------------------------------------------------------------------
// Structural disclaimer — norms are estimates (DISCLAIMER_FI precedent:
// same { text, language, version } keys, attached ON the result object)
// ---------------------------------------------------------------------------

const NORMS_ESTIMATES_DISCLAIMER_FI: Disclaimer = {
  text: 'Ostoslista perustuu yleisiin kulutusnormeihin. Normiarvot ovat arvioita keskimääräisestä kulutuksesta — todellinen kulutus vaihtelee tilaisuuden ja vieraiden mukaan.',
  language: 'fi',
  version: '1.0',
};

// ---------------------------------------------------------------------------
// Validation — caps documented in the module doc
// ---------------------------------------------------------------------------

const MAX_GUESTS = 500;
const MAX_DURATION_HOURS = 72;

const EVENT_PROFILES = ['casual_gathering', 'dinner_party', 'celebration'] as const;

const GUESTS_MESSAGE = `guests must be an integer between 1 and ${MAX_GUESTS}`;
const DURATION_MESSAGE = `durationHours must be an integer between 1 and ${MAX_DURATION_HOURS}`;

const eventCalcRequestSchema = z.object({
  guests: z
    .number({
      required_error: GUESTS_MESSAGE,
      invalid_type_error: GUESTS_MESSAGE,
    })
    .int(GUESTS_MESSAGE)
    .min(1, GUESTS_MESSAGE)
    .max(MAX_GUESTS, `guests must be at most ${MAX_GUESTS}`),
  durationHours: z
    .number({
      required_error: DURATION_MESSAGE,
      invalid_type_error: DURATION_MESSAGE,
    })
    .int(DURATION_MESSAGE)
    .min(1, DURATION_MESSAGE)
    .max(MAX_DURATION_HOURS, `durationHours must be at most ${MAX_DURATION_HOURS}`),
  eventProfile: z.enum(EVENT_PROFILES, {
    errorMap: () => ({
      message: `eventProfile must be one of: ${EVENT_PROFILES.join(', ')}`,
    }),
  }),
  eventDate: z
    .string({
      required_error: 'eventDate must be an ISO YYYY-MM-DD calendar date',
      invalid_type_error: 'eventDate must be an ISO YYYY-MM-DD calendar date',
    })
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'eventDate must be an ISO YYYY-MM-DD calendar date',
    ),
  // ── V2 cross-border sourcing (task 4.5) — strictly optional; a body
  // without this section takes the byte-compatible MVP path. ──
  sourcing: z
    .object({
      /** Optional budget for the priced plan total, euro-cents (see module doc caps). */
      budgetCents: z
        .number({
          invalid_type_error: 'sourcing.budgetCents must be a positive integer (euro cents)',
        })
        .int('sourcing.budgetCents must be a positive integer (euro cents)')
        .min(1, 'sourcing.budgetCents must be a positive integer (euro cents)')
        .max(10_000_000, 'sourcing.budgetCents must be at most 10000000')
        .optional(),
      /** Opt into packing recommendations over the foreign-sourced haul. */
      packing: z.boolean({ invalid_type_error: 'sourcing.packing must be a boolean' }).optional(),
      lines: z
        .array(
          z.object({
            drinkType: z.enum(EVENT_CALC_DRINK_TYPES, {
              errorMap: () => ({
                message: `sourcing.lines[].drinkType must be one of: ${EVENT_CALC_DRINK_TYPES.join(', ')}`,
              }),
            }),
            /** Typical ABV (%) of the drinks this line will actually be bought in. */
            abvPercent: z
              .number({
                invalid_type_error: 'sourcing.lines[].abvPercent must be a percentage between 0.1 and 100',
              })
              .min(0.1, 'sourcing.lines[].abvPercent must be a percentage between 0.1 and 100')
              .max(100, 'sourcing.lines[].abvPercent must be a percentage between 0.1 and 100'),
            /**
             * Retail container the line will be bought in — feeds the
             * container-duty packaging and the packing material.
             */
            container: z.enum(['can', 'glass', 'plastic', 'other'], {
              errorMap: () => ({
                message: 'sourcing.lines[].container must be one of: can, glass, plastic, other',
              }),
            }),
            /** User-supplied domestic retail basis, cents per litre (1 €/l = 100). */
            domesticPricePerLitreCents: z
              .number({
                invalid_type_error:
                  'sourcing.lines[].domesticPricePerLitreCents must be an integer between 1 and 100000',
              })
              .int('sourcing.lines[].domesticPricePerLitreCents must be an integer between 1 and 100000')
              .min(1, 'sourcing.lines[].domesticPricePerLitreCents must be an integer between 1 and 100000')
              .max(100_000, 'sourcing.lines[].domesticPricePerLitreCents must be an integer between 1 and 100000'),
            /** User-supplied foreign retail bases, one entry per candidate country. */
            foreign: z
              .array(
                z.object({
                  country: z.enum(SOURCING_COUNTRY_ORDER.slice(1) as unknown as ['EE', 'LV', 'LT', 'SE', 'DE'], {
                    errorMap: () => ({
                      message: 'sourcing.lines[].foreign[].country must be one of: EE, LV, LT, SE, DE',
                    }),
                  }),
                  pricePerLitreCents: z
                    .number({
                      invalid_type_error:
                        'sourcing.lines[].foreign[].pricePerLitreCents must be an integer between 1 and 100000',
                    })
                    .int('sourcing.lines[].foreign[].pricePerLitreCents must be an integer between 1 and 100000')
                    .min(1, 'sourcing.lines[].foreign[].pricePerLitreCents must be an integer between 1 and 100000')
                    .max(100_000, 'sourcing.lines[].foreign[].pricePerLitreCents must be an integer between 1 and 100000'),
                }),
                { invalid_type_error: 'sourcing.lines[].foreign must be an array' },
              )
              .max(SOURCING_COUNTRY_ORDER.length - 1, 'sourcing.lines[].foreign exceeds the candidate country set')
              .optional(),
          }),
        )
        .min(1, 'sourcing.lines must price at least one drink type')
        .max(EVENT_CALC_DRINK_TYPES.length, `sourcing.lines must price at most ${EVENT_CALC_DRINK_TYPES.length} drink types`),
    })
    .superRefine((sourcing, ctx) => {
      const seenTypes = new Set<string>();
      for (const [lineIndex, line] of sourcing.lines.entries()) {
        if (seenTypes.has(line.drinkType)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lines', lineIndex, 'drinkType'],
            message: `sourcing.lines prices "${line.drinkType}" more than once`,
          });
        }
        seenTypes.add(line.drinkType);

        const seenCountries = new Set<string>();
        for (const [entryIndex, entry] of (line.foreign ?? []).entries()) {
          if (seenCountries.has(entry.country)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['lines', lineIndex, 'foreign', entryIndex, 'country'],
              message: `sourcing.lines[].foreign prices "${entry.country}" more than once`,
            });
          }
          seenCountries.add(entry.country);
        }
      }
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// POST /api/v1/event-calc
// ---------------------------------------------------------------------------

/** The module result decorated with the structural disclaimer field. */
type EventCalcResponse = EventCalcResult & { readonly disclaimer: Disclaimer };

/** Echo mapping the packing section's synthetic productIds back to drink types. */
interface EventPackingSection {
  readonly suggestion: PackingSuggestion;
  readonly lines: readonly { readonly productId: number; readonly drinkType: string }[];
}

/** The V2 200 payload: MVP shape plus plan, plus the optional packing section. */
type EventCalcV2Response = EventCalcResponse & {
  readonly plan: EventSourcingPlan;
  readonly packing?: EventPackingSection;
};

/** The V2 request section, post-zod. */
interface SourcingDto {
  readonly budgetCents?: number | undefined;
  readonly packing?: boolean | undefined;
  readonly lines: readonly {
    readonly drinkType: EventDrinkType;
    readonly abvPercent: number;
    readonly container: 'can' | 'glass' | 'plastic' | 'other';
    readonly domesticPricePerLitreCents: number;
    readonly foreign?: readonly { readonly country: string; readonly pricePerLitreCents: number }[] | undefined;
  }[];
}

/** Container vocabulary → the packing module's material set. */
const PACKING_MATERIAL: Record<SourcingDto['lines'][number]['container'], PackingMaterial> = {
  can: 'CAN',
  glass: 'GLASS',
  plastic: 'PLASTIC',
  other: 'OTHER',
};

/**
 * Deterministic half-up rounding to whole cents for the user-supplied
 * per-litre basis over the line's exact purchased millilitres —
 * `(centsPerLitre × purchasedMl) / 1000` on integers only.
 */
function retailCentsForLine(pricePerLitreCents: number, purchasedMl: number): number {
  return Math.round((pricePerLitreCents * purchasedMl) / 1000);
}

/**
 * Resolve every priced line's per-source cost options by running the
 * landed-cost engines (module doc: component-by-component). Returns the
 * module's option map plus every distinct tax dataset version met —
 * the V2 idempotency dimensions beyond the norms version.
 */
async function resolveSourcingOptions(
  d1: AppEnv['Bindings']['DB'],
  shoppingList: Extract<EventCalcResult, { status: 'COMPUTED' }>,
  sourcing: SourcingDto,
): Promise<{ options: Map<EventDrinkType, SourcingCostOption[]>; taxDatasetVersions: string[] }> {
  const taxRepo = new D1TaxRuleRepositoryAdapter(d1);
  const exciseEngine = new AlcoholExciseService(taxRepo);
  const dutyEngine = new ContainerDutyService(taxRepo);
  const confidence = new ConfidenceFrameworkService(new ReliabilityService());

  // The event date is the relevant date for tax rules — a past rate
  // version resolves exactly like the norms do (same half-open window
  // discipline). UTC midnight of the calendar date.
  const asOf = new Date(`${shoppingList.eventDate}T00:00:00Z`);

  const linesByType = new Map(shoppingList.lines.map((line) => [line.drinkType, line]));
  const options = new Map<EventDrinkType, SourcingCostOption[]>();
  const taxDatasetVersions = new Set<string>();

  for (const line of sourcing.lines) {
    const shoppingLine = linesByType.get(line.drinkType);
    if (shoppingLine === undefined || shoppingLine.purchasedMl === 0) {
      // Norms for this type resolved to zero need (e.g. zero-length
      // event) — there is no volume to source; pricing it would invent
      // figures for nothing. Skipped lines stay explicitly UNPRICED.
      continue;
    }
    const purchasedLitres = shoppingLine.purchasedMl / 1000;

    const buildOption = async (
      country: string,
      pricePerLitreCents: number,
      foreign: boolean,
    ): Promise<SourcingCostOption> => {
      const retailCents = retailCentsForLine(pricePerLitreCents, shoppingLine.purchasedMl);

      // Foreign sources pay Finnish excise + container duty on import;
      // the domestic shelf price is tax-inclusive, so its tax/transport
      // components are structural zeros with no separate data point
      // (`UNAVAILABLE` — never presented as verified figures).
      let exciseCents = 0;
      let dutyCents = 0;
      let exciseStatus: SourcingCostOption['statuses']['excise'] = 'UNAVAILABLE';
      let dutyStatus: SourcingCostOption['statuses']['containerDuty'] = 'UNAVAILABLE';
      const datasets: string[] = [];
      if (foreign) {
        const excise = await exciseEngine.calculate(
          line.drinkType,
          line.abvPercent / 100,
          purchasedLitres,
          asOf,
        );
        exciseCents = excise.taxCents;
        exciseStatus = excise.reliability;
        if (excise.taxDatasetVersion) datasets.push(excise.taxDatasetVersion);

        const duty = await dutyEngine.calculate(
          purchasedLitres,
          line.container,
          null, // deposit status unknown ⇒ ESTIMATED by the engine, never assumed
          asOf,
        );
        dutyCents = duty.dutyCents;
        dutyStatus = duty.reliability;
        if (duty.taxDatasetVersion) datasets.push(duty.taxDatasetVersion);
        for (const version of datasets) {
          taxDatasetVersions.add(version);
        }
      }

      // The same component labels computeItemCosts feeds the confidence
      // framework, minus classification (no transaction counterpart for
      // an anonymous category line — module doc).
      const report = confidence.buildReport([
        { status: 'ESTIMATED', label: 'productPrice' }, // user-supplied basis
        { status: 'UNAVAILABLE', label: 'transport' },
        { status: exciseStatus, label: 'excise' },
        { status: dutyStatus, label: 'containerDuty' },
      ]);

      return {
        country,
        retailCents,
        exciseCents,
        containerDutyCents: dutyCents,
        transportCents: 0, // no carrier dimension yet — visible UNAVAILABLE, never assumed free
        statuses: {
          retail: 'ESTIMATED',
          excise: exciseStatus,
          containerDuty: dutyStatus,
          transport: 'UNAVAILABLE',
        },
        confidenceOverall: report.overall,
        datasetVersions: datasets,
      };
    };

    const lineOptions: SourcingCostOption[] = [
      await buildOption('FI', line.domesticPricePerLitreCents, false),
    ];
    for (const entry of line.foreign ?? []) {
      lineOptions.push(await buildOption(entry.country, entry.pricePerLitreCents, true));
    }
    options.set(line.drinkType, lineOptions);
  }

  return { options, taxDatasetVersions: [...taxDatasetVersions] };
}

/**
 * Canonicalized sourcing key fragment: lines sorted by drink type,
 * foreign entries by country, fixed key order — equal plans share one
 * cache key regardless of the arrays' incoming order.
 */
function canonicalSourcingKey(sourcing: SourcingDto): string {
  return JSON.stringify({
    b: sourcing.budgetCents ?? null,
    p: sourcing.packing === true,
    l: sourcing.lines
      .slice()
      .sort((a, b) => (a.drinkType < b.drinkType ? -1 : a.drinkType > b.drinkType ? 1 : 0))
      .map((line) => ({
        t: line.drinkType,
        a: line.abvPercent,
        c: line.container,
        d: line.domesticPricePerLitreCents,
        f: (line.foreign ?? [])
          .slice()
          .sort((a, b) => (a.country < b.country ? -1 : a.country > b.country ? 1 : 0))
          .map((entry) => ({ c: entry.country, p: entry.pricePerLitreCents })),
      })),
  });
}

/**
 * Build the packing section over the FOREIGN-sourced haul (module doc).
 * Drink types are not products: units carry the request's container
 * material with null dimensions and degrade through the packing
 * module's own MISSING_DIMENSIONS path — no geometry is invented here.
 * Quantities are the shopping list's container counts per line.
 */
async function buildEventPackingSection(
  d1: AppEnv['Bindings']['DB'],
  shoppingList: Extract<EventCalcResult, { status: 'COMPUTED' }>,
  plan: EventSourcingPlan,
  sourcing: SourcingDto,
): Promise<EventPackingSection> {
  const containerByType = new Map(sourcing.lines.map((line) => [line.drinkType, line.container]));
  const unitsByType = new Map(shoppingList.lines.map((line) => [line.drinkType, line.totalUnits]));
  // Stable synthetic ids: position in the canonical drink-type set + 1 —
  // echoed in the section so the UI can map boxes/exclusions back.
  const productIdByType = new Map<EventDrinkType, number>(
    EVENT_CALC_DRINK_TYPES.map((drinkType, index) => [drinkType, index + 1]),
  );

  const foreignLines = plan.lines.filter((line) => line.sourceKind === 'FOREIGN');
  const items: PackingItem[] = foreignLines.map((line) => ({
    productId: productIdByType.get(line.drinkType) as number,
    quantity: unitsByType.get(line.drinkType) as number,
    weightG: null,
    heightMm: null,
    diameterMm: null,
    material: PACKING_MATERIAL[containerByType.get(line.drinkType) as 'can' | 'glass' | 'plastic' | 'other'],
  }));

  const boxTypes = await new D1CarrierBoxTypesRepository(d1).listAll();

  return {
    suggestion: suggestPacking(items, boxTypes),
    lines: foreignLines.map((line) => ({
      productId: productIdByType.get(line.drinkType) as number,
      drinkType: line.drinkType,
    })),
  };
}

async function calculateEvent(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, eventCalcRequestSchema);

  // Version-aware idempotency starts HERE: the norms version resolved for
  // (profile, date) is the dataset dimension of the cache key — resolved
  // FIRST, like the calculator's tax-version resolution (§15 known-issue fix).
  const resolvedNorms = await new D1ConsumptionNormsRepository(
    c.env.DB,
  ).findPublishedEffectiveOn(dto.eventProfile, dto.eventDate);

  // Repository rows → the pure module's narrow row shape (structurally
  // compatible by design, task 4.2; the explicit mapping keeps the API
  // layer honest about which fields cross the boundary).
  const norms: EventNormRow[] = resolvedNorms.map((row) => ({
    drinkType: row.drinkType,
    normValuePerGuestPerHour: row.normValuePerGuestPerHour,
    versionLabel: row.versionLabel,
  }));

  let result: EventCalcResult;
  try {
    result = calculateEventShoppingList({
      eventDate: dto.eventDate,
      eventProfile: dto.eventProfile,
      guests: dto.guests,
      durationHours: dto.durationHours,
      norms,
    });
  } catch (err) {
    // Defense in depth: zod makes InvalidEventInputError unreachable, but
    // the module is callable with any shape — keep the 400 contract.
    if (err instanceof InvalidEventInputError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: 'ValidationError',
      });
    }
    // InconsistentNormsError / MixedNormVersionsError are curated-DATA
    // faults (the repository's per-date resolution guarantees a coherent
    // version) — the caller cannot fix them; 500 for operator visibility.
    if (err instanceof InconsistentNormsError || err instanceof MixedNormVersionsError) {
      throw new ApiHttpError(500, {
        statusCode: 500,
        message: err.message,
        error: 'InconsistentNorms',
      });
    }
    throw err;
  }

  if (result.status === 'NO_PUBLISHED_NORMS') {
    // Explicit empty state (module doc): 200 + result value, not cached —
    // see the module doc's idempotency decision. Identical with or
    // without a sourcing section: no norms ⇒ no lines to source.
    const empty: EventCalcResponse = { ...result, disclaimer: NORMS_ESTIMATES_DISCLAIMER_FI };
    return c.json(empty);
  }

  // ── V2 sourcing path (task 4.5) — engines run HERE, the pure module
  // only assigns. The MVP path below keeps its byte-compatible payload
  // and cache-key format. ──
  if (dto.sourcing !== undefined) {
    const { options, taxDatasetVersions } = await resolveSourcingOptions(c.env.DB, result, dto.sourcing);

    let plan: EventSourcingPlan;
    try {
      plan = buildEventSourcingPlan({
        plan: result,
        options,
        budgetCents: dto.sourcing.budgetCents,
      });
    } catch (err) {
      // Defense in depth: zod + the resolver make these unreachable —
      // the 400 contract matches InvalidEventInputError's class.
      if (err instanceof SourcingInputError) {
        throw new ApiHttpError(400, {
          statusCode: 400,
          message: err.message,
          error: 'ValidationError',
        });
      }
      throw err;
    }

    // Packing opt-in (R4 module), gated per-request like the basket
    // section: flag off ⇒ the response keeps its exact flag-less shape.
    const includePacking =
      dto.sourcing.packing === true &&
      new FeatureFlagService(c.env).isEnabled(FeatureFlag.PACKING_OPTIMIZER);
    const packing = includePacking
      ? await buildEventPackingSection(c.env.DB, result, plan, dto.sourcing)
      : undefined;

    const normsVersion: string = result.normsVersion;
    // Dataset dimensions beyond the norms version: every tax dataset the
    // engines resolved. Sorted so the key cannot depend on engine order.
    const datasetVersions = [normsVersion, ...taxDatasetVersions].sort();
    const cacheKey =
      c.req.header('x-idempotency-key') ??
      [
        'event-calc-v2',
        dto.eventProfile,
        dto.eventDate,
        dto.guests,
        dto.durationHours,
        normsVersion,
        canonicalSourcingKey(dto.sourcing),
        ...[...taxDatasetVersions].sort(),
      ].join('|');

    const cached = await idempotencyLookup(c.env, cacheKey, datasetVersions);
    if (cached !== null) {
      c.header('X-Cache', 'HIT');
      c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
      return c.json(cached.result);
    }

    const body: EventCalcV2Response = {
      ...result,
      disclaimer: NORMS_ESTIMATES_DISCLAIMER_FI,
      plan,
      ...(packing !== undefined ? { packing } : {}),
    };
    await idempotencyStore(c.env, cacheKey, body, { datasetVersions });

    c.header('X-Cache', 'MISS');
    c.header('X-Content-Hash', await idempotencyContentHash(body));
    return c.json(body);
  }

  const normsVersion: string = result.normsVersion;
  const clientKey = c.req.header('x-idempotency-key');
  const cacheKey =
    clientKey ??
    [
      'event-calc',
      dto.eventProfile,
      dto.eventDate,
      dto.guests,
      dto.durationHours,
      normsVersion,
    ].join('|');

  // Lookup re-checks the version (defense in depth — a verbatim client
  // key reused across a norms bump is a miss, calculator parity).
  const cached = await idempotencyLookup(c.env, cacheKey, [normsVersion]);
  if (cached !== null) {
    c.header('X-Cache', 'HIT');
    c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
    return c.json(cached.result);
  }

  const body: EventCalcResponse = { ...result, disclaimer: NORMS_ESTIMATES_DISCLAIMER_FI };
  await idempotencyStore(c.env, cacheKey, body, { datasetVersions: [normsVersion] });

  c.header('X-Cache', 'MISS');
  c.header('X-Content-Hash', await idempotencyContentHash(body));
  return c.json(body);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the event-calculator handler behind its flag gate + limiter. */
export function registerEventCalcRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post(
    '/api/v1/event-calc',
    requireFeatureFlag(FeatureFlag.EVENT_CALCULATOR),
    requireRateLimit('CALCULATOR'),
    calculateEvent,
  );
  return app;
}

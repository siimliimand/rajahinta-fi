/**
 * Safety contract tests for ExciseDeclarationService.
 *
 * Verifies at both runtime and type level that the declaration assistant
 * never submits data to any external service — it is read-only by design.
 *
 * Extended for Phase 2C: the no-submission guarantee is re-proven over the
 * NEW guidance assembly paths (records carrying the optional provenance
 * fields), the type-level constraint is shown to still compile with the
 * guidance-carrying payload shape, and the source-level proof symbols in
 * the service module are asserted to exist (vitest does not typecheck —
 * `pnpm typecheck` enforces that they compile).
 *
 * High-liability: if these tests fail, the safety guarantee is broken.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ExciseDeclarationService,
} from '../excise-declaration.service';
import { NO_SUBMISSION_GUARANTEE } from '../declaration.types';
import type {
  ReadonlyInterface,
  DeclarationSafetyConstraint,
  DeclarationSummary,
  DeclarationGuidance,
  CalculationRecordData,
  ICalculationRecordQueryPort,
} from '../declaration.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A mock query port that always returns null. */
const nullQueryPort: ICalculationRecordQueryPort = {
  findById: async () => null,
};

/**
 * A calculation record with EVERY Phase 2C guidance-provenance field
 * populated — forces prepareDeclaration through the new guidance
 * assembly paths (derivation rate lines, deadline, caveats).
 */
const guidanceCarryingRecord: CalculationRecordData = {
  id: 7,
  productName: 'Sahti',
  productBrand: 'Lammin Sahti',
  productCategory: 'Beer',
  alcoholByVolume: 8.0,
  volumeLitres: 0.5,
  containerType: 'Bottle',
  depositSystemStatus: true,
  quantity: 12,
  transportCarrier: 'Posti',
  transportOrigin: 'EE',
  transportDestination: 'FI',
  alcoholExciseCents: 512,
  containerDutyCents: 31,
  totalCents: 543,
  confidence: 'HIGH',
  classification: 'DistanceBuying',
  disclaimerText: 'Tämä on laskelma, ei sitova päätös.',
  disclaimerLanguage: 'fi',
  disclaimerVersion: '1.2.0',
  calculationTimestamp: '2026-06-15T10:30:00.000Z',
  // Guidance provenance (Phase 2C optional fields) — all populated.
  alcoholExciseRatePerUnit: 38.05,
  containerDutyRatePerLitre: 0.51,
  exciseRuleVersionLabel: '2025.1',
  containerDutyRuleVersionLabel: '2025.1',
  exciseFormulaReference: 'PER_CENTILITRE_ETHANOL',
};

/** A query port that always returns the guidance-carrying record. */
const guidanceQueryPort: ICalculationRecordQueryPort = {
  findById: async () => guidanceCarryingRecord,
};

/**
 * Collect every object key at every depth of a plain-data value.
 * Used to prove the returned summary contains nothing submission-like.
 */
function collectDeepKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDeepKeys(item, acc);
    }
    return acc;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.push(key);
      collectDeepKeys(child, acc);
    }
  }
  return acc;
}

/** Keys a submission/filing/confirmation flow would need — none may appear. */
const SUBMISSION_LIKE_KEY =
  /submi|filing|filed|confirm|receipt|acknowledg|transmit|dispatch|tracking/i;

/** Extract all method names from the service prototype. */
function getMethodNames(
  proto: object,
): string[] {
  const names: string[] = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (desc && typeof desc.value === 'function') {
      names.push(key);
    }
  }
  return names;
}

/** True when the method's return type looks like a create/update pattern. */
function isWriteMethod(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  fn: Function,
): boolean {
  // We cannot inspect return types at runtime, but we CAN check the method
  // name for write-like verbs.  This is the defensive layer; compile-time
  // checks do the heavy lifting.
  const name = fn.name ?? '(anonymous)';
  const writeVerbs = /^(create|update|delete|save|submit|post|put|patch|destroy|remove|insert|upsert)/i;
  return writeVerbs.test(name);
}

// ---------------------------------------------------------------------------
// Runtime — noSubmissionGuarantee
// ---------------------------------------------------------------------------

describe('ExciseDeclarationService — safety guarantee', () => {
  it('declares noSubmissionGuarantee at runtime', () => {
    const svc = new ExciseDeclarationService(nullQueryPort);
    expect(svc.noSubmissionGuarantee).toBe(NO_SUBMISSION_GUARANTEE);
  });

  it('noSubmissionGuarantee is typed as a string', () => {
    // Type-level assertion: the field exists and is a string
    const svc = new ExciseDeclarationService(nullQueryPort);
    const _typeCheck: string = svc.noSubmissionGuarantee;
    expect(typeof _typeCheck).toBe('string');
  });

  it('has no methods whose name suggests a write operation', () => {
    const proto = ExciseDeclarationService.prototype;
    const methods = getMethodNames(proto);

    for (const name of methods) {
      // We already know prepareDeclaration is safe — verify it explicitly
      if (name === 'prepareDeclaration') continue;
      const fn = (proto as any)[name];
      expect(
        isWriteMethod(fn),
        `Unexpected write-like method "${name}" found on service`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Compile-time — ReadonlyInterface proofs (type-level, verified by tsc)
// ---------------------------------------------------------------------------

describe('ExciseDeclarationService — type-level safety', () => {
  it('satisfies DeclarationSafetyConstraint at compile time', () => {
    // This line must compile: it proves DeclarationSafetyConstraint<T>
    // resolved to `true` (not `never`).
    type _safety = DeclarationSafetyConstraint<ExciseDeclarationService>;
    const proof: _safety = true as const;
    expect(proof).toBe(true);
  });

  it('is assignable to ReadonlyInterface<ExciseDeclarationService>', () => {
    // If a write method existed, the key counts would differ and the
    // assignment below would fail compilation.  We verify it compiles
    // by asserting the type is structurally compatible.
    type ReadOnly = ReadonlyInterface<ExciseDeclarationService>;
    const svc: ReadOnly = new ExciseDeclarationService(nullQueryPort);
    // The service must still expose prepareDeclaration through the
    // readonly interface.
    expect(typeof svc.prepareDeclaration).toBe('function');
  });

  it('preserves all methods through ReadonlyInterface (no methods stripped)', () => {
    // When a service has zero write methods, ReadonlyInterface should
    // leave every key intact.
    type Orig = ExciseDeclarationService;
    type Stripped = ReadonlyInterface<ExciseDeclarationService>;
    // The key-sets must be equal.
    type KeysMatch =
      keyof Orig extends keyof Stripped
        ? keyof Stripped extends keyof Orig
          ? true
          : false
        : false;
    const _keysMatch: KeysMatch = true;
    expect(_keysMatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Negative compile-time test — ts-expect-error proves that adding a write
// method would break the safety constraint.
//
// NOTE: Because we cannot modify the real service in a test, we use a
// local inline type to prove the mechanism works.
// ---------------------------------------------------------------------------

describe('DeclarationSafetyConstraint — rejects write methods at type level', () => {
  /**
   * If UnsafeService has a write method, DeclarationSafetyConstraint becomes
   * `never`.  Assigning `true` to `never` is a type error — the
   * @ts-expect-error proves the mechanism catches it.
   *
   * If the write method were removed, `never` would become `true`, `true`
   * would be assignable to `true`, and tsc would report the unused
   * @ts-expect-error — catching the regression.
   */
  it('proves the mechanism rejects Promise<{id: number}> return types', () => {
    interface UnsafeService {
      submitDeclaration(): Promise<{ id: number }>;
    }
    type UnsafeSafety = DeclarationSafetyConstraint<UnsafeService>;
    // @ts-expect-error — UnsafeSafety is `never`, so `true` is not assignable
    const _mustBeNever: UnsafeSafety = true;
    void _mustBeNever;
  });

  it('proves the mechanism accepts read-only services', () => {
    // A service with only read methods — no `id` fields at all, matching
    // the real DeclarationSummary pattern.
    interface SafeService {
      prepareDeclaration(): Promise<{ readonly name: string; readonly total: number }>;
      getSummary(): Promise<{ readonly total: number }>;
    }

    // DeclarationSafetyConstraint should be `true`, so the assignment compiles.
    type SafeSafety = DeclarationSafetyConstraint<SafeService>;
    const _isSafe: SafeSafety = true;
    expect(_isSafe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 2C — no-submission guarantee over the guidance assembly paths.
// A record carrying the optional provenance fields routes
// prepareDeclaration through buildDerivation / buildDeadline /
// buildCaveats / buildGuidance; the guarantee must hold on those paths.
// ---------------------------------------------------------------------------

describe('ExciseDeclarationService — no-submission guarantee over guidance paths', () => {
  it('keeps noSubmissionGuarantee while completing the guidance-carrying assembly', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);

    expect(svc.noSubmissionGuarantee).toBe(NO_SUBMISSION_GUARANTEE);

    const summary = await svc.prepareDeclaration(7);

    // Prove the NEW assembly paths actually ran — the guidance was
    // populated from the optional record fields, not skipped.
    const [excise, containerDuty] = summary.guidance.derivation.appliedRates;
    expect(excise.ratePerUnit).toBe(38.05);
    expect(excise.ruleVersionLabel).toBe('2025.1');
    expect(containerDuty.ratePerUnit).toBe(0.51);
    // Post-reform DistanceBuying: the buyer must file an advance notice,
    // but the due date stays null — the obligation is tied to dispatch, a
    // date the record does not carry, so none is invented.
    expect(summary.guidance.deadline.required).toBe(true);
    expect(summary.guidance.deadline.dueDate).toBeNull();
    expect(summary.guidance.liabilityNotice).toEqual({
      classification: 'DistanceBuying',
      buyerMustFileAdvanceNotice: true,
      buyerJointlyLiable: false,
      ruleSetVersion: '2.0-2026.1',
    });
    expect(summary.guidance.caveats).toEqual([]);
  });

  it('returns a summary with no submission-like key at any depth', async () => {
    const summary = await new ExciseDeclarationService(
      guidanceQueryPort,
    ).prepareDeclaration(7);

    const deepKeys = collectDeepKeys(summary);
    expect(deepKeys.length).toBeGreaterThan(0); // the scan actually traversed

    for (const key of deepKeys) {
      expect(
        SUBMISSION_LIKE_KEY.test(key),
        `Submission-like key "${key}" found in the declaration summary`,
      ).toBe(false);
    }

    // The write-method detector keys on Promise<{ id }>-shaped returns;
    // an id-bearing payload object would be the natural accompaniment.
    expect(deepKeys).not.toContain('id');
  });

  it('returns pure JSON-serializable data — no callbacks, handles, or functions', async () => {
    const summary = await new ExciseDeclarationService(
      guidanceQueryPort,
    ).prepareDeclaration(7);

    const roundTripped = JSON.parse(JSON.stringify(summary));
    expect(roundTripped).toEqual(summary);
  });
});

// ---------------------------------------------------------------------------
// Phase 2C — type-level safety over the guidance-carrying surface.
// The type-level constraint ("still compiles") is enforced by the
// source-level `_exciseServiceSafetyProof` assertions in the service
// module; the tests below re-prove the constraint over the NEW payload
// shape and verify the proof symbols still exist.
// ---------------------------------------------------------------------------

describe('ExciseDeclarationService — type-level safety over guidance surface', () => {
  it('a read-only service returning a guidance-carrying DeclarationSummary is still safe', () => {
    // The Phase 2C return type now embeds DeclarationGuidance. If the
    // guidance payload were write-shaped (Promise<{ id }>), this
    // assignment would stop compiling.
    interface ReadOnlyWithGuidance {
      prepareDeclaration(): Promise<DeclarationSummary>;
    }

    type SafeWithGuidance = DeclarationSafetyConstraint<ReadOnlyWithGuidance>;
    const _isSafe: SafeWithGuidance = true;
    expect(_isSafe).toBe(true);
  });

  it('a guidance-carrying write method cannot pass DeclarationSafetyConstraint', () => {
    // Negative proof: wrapping a write method's payload in guidance does
    // not smuggle it past the constraint — it resolves to `never`.
    interface UnsafeWithGuidance {
      submitDeclarationWithGuidance(): Promise<{
        id: number;
        guidance: DeclarationGuidance;
      }>;
    }

    type UnsafeConstraint = DeclarationSafetyConstraint<UnsafeWithGuidance>;
    // @ts-expect-error — UnsafeConstraint resolves to `never`, so `true`
    // is not assignable. If the constraint stopped detecting this write
    // shape, tsc would flag the unused @ts-expect-error and fail here.
    const _mustBeNever: UnsafeConstraint = true;
    void _mustBeNever;
    expect(true).toBe(true);
  });

  it('DeclarationGuidance is a data-only payload (no id-bearing field)', () => {
    type _NoNumericId = DeclarationGuidance extends { id: number }
      ? never
      : true;
    type _NoStringId = DeclarationGuidance extends { id: string }
      ? never
      : true;

    const _numericCheck: _NoNumericId = true;
    const _stringCheck: _NoStringId = true;
    expect(_numericCheck && _stringCheck).toBe(true);
  });

  it('the service module still carries the source-level proof symbols', () => {
    // Vitest transpiles without typechecking, so the compile-time proofs
    // in excise-declaration.service.ts are enforced by `pnpm typecheck`.
    // This guards their PRESENCE — removing or renaming the proofs is
    // caught here even before typecheck runs.
    const source = readFileSync(
      resolve(__dirname, '..', 'excise-declaration.service.ts'),
      'utf-8',
    );

    expect(source).toContain('_exciseServiceSafetyProof');
    expect(source).toContain('_readonlySurface');
    expect(source).toMatch(
      /type\s+_exciseServiceSafety\s*=\s*DeclarationSafetyConstraint<ExciseDeclarationService>/,
    );
  });
});

// ---------------------------------------------------------------------------
// import-filing-assistant Stage 1 — safety + phrasing register over the
// dated pre-dispatch checklist (design D2/D4/D5).
//
// The new string families (checklist steps, guarantee line, reference-number
// step, post-deadline state) must stay in the observed-pattern register:
// described as observed patterns and cited facts, never imperative
// instructions or legal conclusions. The negligence penalty may appear only
// in the officially hedged form, always with the official-source direction.
// ---------------------------------------------------------------------------

/** A dispatch date far ahead of any test run — stable DATED behavior. */
const STAGE1_FUTURE_DATE = '2099-06-15';
/** A dispatch date far in the past — stable POST_DEADLINE behavior. */
const STAGE1_PAST_DATE = '2020-01-15';

/** All new guidance strings of one summary, keyed by the family they belong to. */
interface NewStringFamilies {
  readonly stepDescriptions: readonly string[];
  readonly guaranteeDescription: string | null;
  readonly postDeadlineDescription: string | null;
}

function collectStringFamilies(summary: DeclarationSummary): NewStringFamilies {
  const checklist = summary.guidance.datedChecklist;
  return {
    stepDescriptions: checklist.steps.map((step) => step.description),
    guaranteeDescription:
      checklist.steps.find((step) => step.kind === 'guarantee')?.description ??
      null,
    postDeadlineDescription: checklist.postDeadline?.description ?? null,
  };
}

describe('Stage 1 — no-submission guarantee over the dated checklist paths', () => {
  it('keeps noSubmissionGuarantee in the dated, undated, and post-deadline states', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);

    const dated = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });
    const undated = await svc.prepareDeclaration(7);
    const past = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_PAST_DATE,
    });

    expect(dated.guidance.datedChecklist.state).toBe('DATED');
    expect(undated.guidance.datedChecklist.state).toBe('UNDATED');
    expect(past.guidance.datedChecklist.state).toBe('POST_DEADLINE');
    // The runtime guarantee stays on the service through every state.
    expect(svc.noSubmissionGuarantee).toBe(NO_SUBMISSION_GUARANTEE);
  });

  it('returns no submission-like key at any depth in any checklist state', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);

    for (const options of [
      undefined,
      { plannedDispatchDate: STAGE1_FUTURE_DATE },
      { plannedDispatchDate: STAGE1_PAST_DATE },
    ]) {
      const summary = await svc.prepareDeclaration(7, options);
      const deepKeys = collectDeepKeys(summary);
      expect(deepKeys.length).toBeGreaterThan(0);
      for (const key of deepKeys) {
        expect(
          SUBMISSION_LIKE_KEY.test(key),
          `Submission-like key "${key}" found in the ${summary.guidance.datedChecklist.state} summary`,
        ).toBe(false);
      }
      expect(deepKeys).not.toContain('id');
    }
  });

  it('returns pure JSON-serializable data in the dated and post-deadline states', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);

    const dated = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });
    const past = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_PAST_DATE,
    });

    expect(JSON.parse(JSON.stringify(dated))).toEqual(dated);
    expect(JSON.parse(JSON.stringify(past))).toEqual(past);
  });
});

describe('Stage 1 — phrasing register: checklist steps', () => {
  it('every step is non-empty observed-pattern text in every state', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);

    const summaries = [
      await svc.prepareDeclaration(7),
      await svc.prepareDeclaration(7, { plannedDispatchDate: STAGE1_FUTURE_DATE }),
      await svc.prepareDeclaration(7, { plannedDispatchDate: STAGE1_PAST_DATE }),
    ];

    for (const summary of summaries) {
      const steps = summary.guidance.datedChecklist.steps;
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.description.length).toBeGreaterThan(0);
        expect(step.description).toMatch(/observed|Observed/);
      }
    }
  });

  it('no step opens with an imperative instruction', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });

    const imperativeOpener =
      /^(please\s+)?(file|pay|make|do|remember|ensure|always|never|don't|do not|you must)\b/i;
    for (const step of summary.guidance.datedChecklist.steps) {
      expect(
        imperativeOpener.test(step.description),
        `Step "${step.kind}" opens with imperative phrasing`,
      ).toBe(false);
    }
  });

  it('every step carries its citation reference to an official vero.fi source', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });

    for (const step of summary.guidance.datedChecklist.steps) {
      expect(step.citations.length).toBeGreaterThan(0);
      for (const citation of step.citations) {
        expect(citation.sourceId.length).toBeGreaterThan(0);
        expect(citation.title.length).toBeGreaterThan(0);
        expect(citation.url).toMatch(/^https:\/\/www\.vero\.fi\//);
      }
    }
  });

  it('includes the packaging-notice step verified in task 1.1 (two separate notices)', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7);

    const packagingStep = summary.guidance.datedChecklist.steps.find(
      (step) => step.kind === 'noticePackaging',
    );
    expect(packagingStep).toBeDefined();
    expect(packagingStep?.description).toContain('beverage-packaging duty');
    expect(packagingStep?.description).toContain('no guarantee');
    expect(packagingStep?.citations.length).toBeGreaterThan(0);
  });

  it('describes the reference-number lifecycle at the verified point: after guarantee payment, all numbers to the carrier', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });

    const referenceStep = summary.guidance.datedChecklist.steps.find(
      (step) => step.kind === 'referenceNumber',
    );
    expect(referenceStep).toBeDefined();
    expect(referenceStep?.description).toContain(
      'only once the guarantee has been paid',
    );
    expect(referenceStep?.description).toContain('1–2 business days');
    // Several numbers may exist — every one must reach the carrier.
    expect(referenceStep?.description).toContain('several numbers');
    expect(referenceStep?.description).toContain('all of them');
    expect(referenceStep?.citations.length).toBeGreaterThan(0);
  });
});

describe('Stage 1 — phrasing register: guarantee line', () => {
  it('states the offered figure with its ESTIMATED status, never VERIFIED', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });

    const guarantee = summary.guidance.datedChecklist.guarantee;
    expect(guarantee.available).toBe(true);
    expect(guarantee.status).toBe('ESTIMATED');

    const guaranteeStep = summary.guidance.datedChecklist.steps.find(
      (step) => step.kind === 'guarantee',
    );
    expect(guaranteeStep?.description).toContain('5.12 €');
    expect(guaranteeStep?.description).toContain('ESTIMATED');
    expect(guaranteeStep?.description).not.toMatch(/VERIFIED/);
    // The figure is a prepayment credited against the duty — never framed
    // as a fine or an extra charge.
    expect(guaranteeStep?.description).toContain('prepayment');
    expect(guaranteeStep?.description).not.toMatch(/\bfine\b|\bextra charge\b/);
  });

  it('renders the unavailable state with no number when the figure degrades', async () => {
    // A record with no persisted excise rule provenance → unavailable.
    const unprovenancedPort: ICalculationRecordQueryPort = {
      findById: async () => ({
        ...guidanceCarryingRecord,
        exciseRuleVersionLabel: null,
      }),
    };
    const summary = await new ExciseDeclarationService(unprovenancedPort).prepareDeclaration(
      7,
      { plannedDispatchDate: STAGE1_FUTURE_DATE },
    );

    const checklist = summary.guidance.datedChecklist;
    expect(checklist.guarantee.available).toBe(false);
    expect(checklist.guarantee.amountCents).toBeNull();
    expect(checklist.guarantee.status).toBe('UNAVAILABLE');

    const guaranteeStep = checklist.steps.find(
      (step) => step.kind === 'guarantee',
    );
    expect(guaranteeStep?.description).toContain('unavailable');
    // The degraded step never renders a euro amount.
    expect(guaranteeStep?.description).not.toMatch(/\d+([.,]\d{2})\s?€/);
  });
});

describe('Stage 1 — phrasing register: post-deadline state', () => {
  it('names the negligence penalty only hedged, with the official-source direction', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_PAST_DATE,
    });

    const postDeadline = summary.guidance.datedChecklist.postDeadline;
    expect(postDeadline?.deadlinePassed).toBe(true);

    const description = postDeadline?.description ?? '';
    // The official hedge ("voi olla" / "may") — never an automatic assertion.
    expect(description).toMatch(/\bmay\b/);
    expect(description).toContain('may result in a negligence penalty');
    expect(description).toContain('laiminlyöntimaksu');
    expect(description).toContain('official sources');
  });

  it('asserts no unhedged penalty language in any new string family', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_PAST_DATE,
    });

    const families = collectStringFamilies(summary);
    const allStrings = [
      ...families.stepDescriptions,
      families.guaranteeDescription ?? '',
      families.postDeadlineDescription ?? '',
    ];

    const unhedgedPenaltyLanguage =
      /will incur|must pay a penalty|penalty of [0-9]|automatically (incurs?|impos)|sanction|veronkorotus|myöhästymismaksu/i;
    for (const text of allStrings) {
      expect(
        unhedgedPenaltyLanguage.test(text),
        `Unhedged penalty language found: "${text}"`,
      ).toBe(false);
    }

    // The hedged penalty is confined to the post-deadline family — the
    // checklist steps never mention consequences.
    for (const step of families.stepDescriptions) {
      expect(step).not.toMatch(/penalt|laiminlyönti/i);
    }
  });

  it('attaches official citations to the post-deadline state', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_PAST_DATE,
    });

    const postDeadline = summary.guidance.datedChecklist.postDeadline;
    expect(postDeadline?.citations.length).toBeGreaterThan(0);
    for (const citation of postDeadline?.citations ?? []) {
      expect(citation.sourceId.length).toBeGreaterThan(0);
      expect(citation.url).toMatch(/^https:\/\/www\.vero\.fi\//);
    }
  });
});

describe('Stage 1 — dated figures and degradation', () => {
  it('marks every date-derived figure ESTIMATED (the date is user-entered)', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });

    const checklist = summary.guidance.datedChecklist;
    expect(checklist.deadlineSemantics).toBe('BEFORE_DISPATCH');
    expect(checklist.returnDueEstimate?.status).toBe('ESTIMATED');
    expect(checklist.returnDueEstimate?.estimatedArrivalDate).toBe(
      STAGE1_FUTURE_DATE,
    );
    expect(checklist.returnDueEstimate?.dueDate).toBe('2099-07-12');
    expect(checklist.returnDueEstimate?.citations.length).toBeGreaterThan(0);
  });

  it('undated degradation: same steps and citations, no deadline and no derived dates', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const undated = await svc.prepareDeclaration(7);
    const dated = await svc.prepareDeclaration(7, {
      plannedDispatchDate: STAGE1_FUTURE_DATE,
    });

    const undatedChecklist = undated.guidance.datedChecklist;
    const datedChecklist = dated.guidance.datedChecklist;

    expect(undatedChecklist.state).toBe('UNDATED');
    expect(undatedChecklist.plannedDate).toBeNull();
    expect(undatedChecklist.deadlineSemantics).toBeNull();
    expect(undatedChecklist.returnDueEstimate).toBeNull();
    expect(undatedChecklist.postDeadline).toBeNull();

    // The steps themselves do not move — only the anchoring degrades.
    expect(undatedChecklist.steps).toHaveLength(datedChecklist.steps.length);
    for (let i = 0; i < undatedChecklist.steps.length; i += 1) {
      expect(undatedChecklist.steps[i].kind).toBe(datedChecklist.steps[i].kind);
      expect(undatedChecklist.steps[i].description).toBe(
        datedChecklist.steps[i].description,
      );
      expect(undatedChecklist.steps[i].citations).toEqual(
        datedChecklist.steps[i].citations,
      );
      expect(undatedChecklist.steps[i].datedFor).toBeNull();
    }
  });

  it('an unparseable supplied date degrades to the undated checklist, never a guessed anchor', async () => {
    const svc = new ExciseDeclarationService(guidanceQueryPort);
    const summary = await svc.prepareDeclaration(7, {
      plannedDispatchDate: '15/06/2099',
    });

    expect(summary.guidance.datedChecklist.state).toBe('UNDATED');
    expect(summary.guidance.datedChecklist.plannedDate).toBeNull();
  });
});
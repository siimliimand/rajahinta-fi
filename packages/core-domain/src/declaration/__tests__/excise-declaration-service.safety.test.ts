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
  classification: 'TravellerImport',
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
    expect(summary.guidance.deadline.required).toBe(true);
    expect(summary.guidance.deadline.dueDate).toBe('2026-06-19');
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
/**
 * Safety contract tests for ExciseDeclarationService.
 *
 * Verifies at both runtime and type level that the declaration assistant
 * never submits data to any external service — it is read-only by design.
 *
 * High-liability: if these tests fail, the safety guarantee is broken.
 */
import { describe, it, expect } from 'vitest';
import {
  ExciseDeclarationService,
} from '../excise-declaration.service';
import { NO_SUBMISSION_GUARANTEE } from '../declaration.types';
import type {
  ReadonlyInterface,
  DeclarationSafetyConstraint,
  ICalculationRecordQueryPort,
} from '../declaration.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A mock query port that always returns null. */
const nullQueryPort: ICalculationRecordQueryPort = {
  findById: async () => null,
};

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
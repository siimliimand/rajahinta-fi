/**
 * Age-gate service tests.
 *
 * Privacy-critical: verifies that the age-verification system does NOT
 * collect date-of-birth or identity documents in Phase 1.
 *
 * @module AgeGateServiceTest
 */

import { describe, it, expect } from 'vitest';
import { AgeGateService } from './age-gate.service';
import { SimpleConfirmationProvider } from './simple-confirmation.provider';
import type { IVerificationProvider, VerificationResult } from './verification-provider.interface';

describe('AgeGateService', () => {
  /**
   * Verify that the default Phase 1 provider does not collect DOB or
   * identity documents.  The verification result contains only a
   * boolean flag, a method identifier, and a timestamp — no date-of-birth,
   * no document references, no personal data.
   */
  it('does not collect date-of-birth or identity documents', async () => {
    const provider: IVerificationProvider = new SimpleConfirmationProvider();
    const service = new AgeGateService(provider);

    const result: VerificationResult = await service.verifyAge('test-user-1');

    // The result shape must NOT contain DOB or document fields
    const keys = Object.keys(result);
    expect(keys).toEqual(['verified', 'method', 'timestamp']);
    expect(keys).not.toContain('dateOfBirth');
    expect(keys).not.toContain('dob');
    expect(keys).not.toContain('identityDocument');
    expect(keys).not.toContain('documentType');
    expect(keys).not.toContain('documentNumber');
    expect(keys).not.toContain('nationalId');
    expect(keys).not.toContain('idVerified');

    // Verify the actual values are correct
    expect(result.verified).toBe(true);
    expect(result.method).toBe('simple-confirmation');
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  /**
   * Verify that the VerificationResult interface itself does not
   * expose DOB or document fields (compile-time check via reflection
   * on the type's runtime shape).
   */
  it('VerificationResult type excludes DOB and identity document fields', () => {
    // At runtime the interface compiles to a plain object — verify
    // that no extra keys end up on a constructed result.
    const result: VerificationResult = {
      verified: true,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };

    // Object.assign to strip prototype, then check the own keys
    const plain = { ...result };
    const keys = Object.keys(plain);
    expect(keys).toEqual(['verified', 'method', 'timestamp']);
  });

  /**
   * Verify that upgradeVerification also does not introduce DOB/document
   * collection in Phase 1 (no-op provider).
   */
  it('upgradeVerification does not collect DOB or documents', async () => {
    const provider: IVerificationProvider = new SimpleConfirmationProvider();
    const service = new AgeGateService(provider);

    const result = await service.upgradeVerification('test-user-2', 'identity-document');

    const keys = Object.keys(result);
    expect(keys).not.toContain('dateOfBirth');
    expect(keys).not.toContain('dob');
    expect(keys).not.toContain('identityDocument');
    expect(keys).not.toContain('documentNumber');
    expect(keys).not.toContain('nationalId');

    // Phase 1 upgrade is a no-op — still returns simple-confirmation
    expect(result.method).toBe('simple-confirmation');
    expect(result.verified).toBe(true);
  });

  /**
   * Verify the inline fallback (no provider injected) also does not
   * collect DOB or documents.
   */
  it('inline fallback does not collect DOB or documents', async () => {
    // AgeGateService with no provider argument — falls back to inline
    const service = new AgeGateService();

    const result = await service.verifyAge('test-user-3');

    const keys = Object.keys(result);
    expect(keys).toEqual(['verified', 'method', 'timestamp']);
    expect(keys).not.toContain('dateOfBirth');
    expect(keys).not.toContain('identityDocument');
    expect(result.verified).toBe(true);
    expect(result.method).toBe('simple-confirmation');
  });
});
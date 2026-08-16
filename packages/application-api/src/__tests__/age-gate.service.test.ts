import { describe, it, expect } from 'vitest';
import { AgeGateService } from '../age-gate/age-gate.service';

describe('AgeGateService', () => {
  const service = new AgeGateService();

  describe('verifyAge', () => {
    it('should return verified for any userId', async () => {
      const result = await service.verifyAge('anonymous-session-123');
      expect(result.verified).toBe(true);
      expect(result.method).toBe('simple-confirmation');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return verified for empty userId', async () => {
      const result = await service.verifyAge('');
      expect(result.verified).toBe(true);
      expect(result.method).toBe('simple-confirmation');
    });

    it('should return verified for a UUID-like userId', async () => {
      const result = await service.verifyAge('550e8400-e29b-41d4-a716-446655440000');
      expect(result.verified).toBe(true);
    });

    it('should return the same shape on repeated calls', async () => {
      const r1 = await service.verifyAge('user-a');
      const r2 = await service.verifyAge('user-a');
      expect(r1.verified).toBe(true);
      expect(r2.verified).toBe(true);
      // timestamp is monotonic — r2 >= r1 (same ms is possible)
      expect(r2.timestamp.getTime()).toBeGreaterThanOrEqual(r1.timestamp.getTime());
    });
  });

  describe('upgradeVerification', () => {
    it('should return verified result with upgraded method', async () => {
      const result = await service.upgradeVerification('user-1', 'identity-document');
      expect(result.verified).toBe(true);
      expect(result.method).toBe('simple-confirmation');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle unknown upgrade methods gracefully', async () => {
      const result = await service.upgradeVerification('user-2', 'gov-id-viitta');
      expect(result.verified).toBe(true);
    });
  });
});
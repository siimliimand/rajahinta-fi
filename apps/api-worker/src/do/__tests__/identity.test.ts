/**
 * Tests for the rate-limit client identity resolver (task 3.3, design D5).
 *
 * Pins the removal of `RATE_LIMIT_TRUST_PROXY`: identity comes from the
 * edge-asserted `CF-Connecting-IP` header only, and X-Forwarded-For is
 * never honored — not even when the legacy env var claims a proxy.
 *
 * @module IdentityTest
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CLIENT_IDENTITY_HEADER, resolveClientIdentity } from '../identity';

function headersWith(init: Record<string, string>): Headers {
  return new Headers(init);
}

const LEGACY_ENV = 'RATE_LIMIT_TRUST_PROXY';

describe('resolveClientIdentity', () => {
  afterEach(() => {
    delete process.env[LEGACY_ENV];
  });

  it('uses CF-Connecting-IP as the client key', () => {
    expect(resolveClientIdentity(headersWith({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveClientIdentity(headersWith({ 'cf-connecting-ip': ' 203.0.113.7 ' }))).toBe('203.0.113.7');
  });

  it('keeps only the first token if values were comma-joined', () => {
    expect(
      resolveClientIdentity(headersWith({ 'cf-connecting-ip': '203.0.113.7, 10.0.0.1' })),
    ).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For — no proxy-trust semantics exist anymore', () => {
    const identity = resolveClientIdentity(headersWith({
      'cf-connecting-ip': '192.168.1.1',
      'x-forwarded-for': '203.0.113.1, 10.0.0.1',
    }));
    expect(identity).toBe('192.168.1.1');
  });

  it('the legacy RATE_LIMIT_TRUST_PROXY env var has no effect', () => {
    process.env[LEGACY_ENV] = 'true';
    const identity = resolveClientIdentity(headersWith({
      'x-forwarded-for': '203.0.113.1',
    }));
    expect(identity).toBe('unknown');
  });

  it('returns unknown when the header is missing (direct workerd traffic)', () => {
    expect(resolveClientIdentity(headersWith({}))).toBe('unknown');
  });

  it('returns unknown for an empty header value', () => {
    expect(resolveClientIdentity(headersWith({ 'cf-connecting-ip': '' }))).toBe('unknown');
    expect(resolveClientIdentity(headersWith({ 'cf-connecting-ip': '   ' }))).toBe('unknown');
  });

  it('exports the canonical header name', () => {
    expect(CLIENT_IDENTITY_HEADER).toBe('CF-Connecting-IP');
  });
});

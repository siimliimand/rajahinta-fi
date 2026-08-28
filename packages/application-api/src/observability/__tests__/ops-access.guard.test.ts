/**
 * OpsAccessGuard tests — the ops dashboard must deny unauthenticated and
 / out-of-allowlist requests without leaking operational data, and fail
 * closed when unconfigured.
 *
 * @module OpsAccessGuardTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OpsAccessGuard, type OpsAccessConfig } from '../ops-access.guard';

function createContext({
  ip = '203.0.113.9',
  token,
}: { ip?: string; token?: string }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: token
          ? { authorization: `Bearer ${token}` }
          : {},
      }),
    }),
  } as never;
}

describe('OpsAccessGuard', () => {
  const ENV_TOKEN = process.env.OPS_BEARER_TOKEN;
  const ENV_ALLOWLIST = process.env.OPS_IP_ALLOWLIST;

  beforeEach(() => {
    delete process.env.OPS_BEARER_TOKEN;
    delete process.env.OPS_IP_ALLOWLIST;
  });

  afterEach(() => {
    if (ENV_TOKEN === undefined) delete process.env.OPS_BEARER_TOKEN;
    else process.env.OPS_BEARER_TOKEN = ENV_TOKEN;
    if (ENV_ALLOWLIST === undefined) delete process.env.OPS_IP_ALLOWLIST;
    else process.env.OPS_IP_ALLOWLIST = ENV_ALLOWLIST;
  });

  it('fails closed when neither token nor allowlist is configured', () => {
    const guard = new OpsAccessGuard();
    expect(() => guard.canActivate(createContext({}))).toThrow(ForbiddenException);
  });

  it('admits a correct bearer token', () => {
    const guard = new OpsAccessGuard({
      bearerToken: 'secret-ops-token',
      allowlist: [],
    });
    expect(
      guard.canActivate(createContext({ token: 'secret-ops-token' })),
    ).toBe(true);
  });

  it('denies a wrong bearer token', () => {
    const guard = new OpsAccessGuard({
      bearerToken: 'secret-ops-token',
      allowlist: [],
    });
    expect(() =>
      guard.canActivate(createContext({ token: 'wrong' })),
    ).toThrow(ForbiddenException);
  });

  it('denies a missing bearer token', () => {
    const guard = new OpsAccessGuard({ bearerToken: 'secret-ops-token', allowlist: [] });
    expect(() => guard.canActivate(createContext({}))).toThrow(ForbiddenException);
  });

  it('denies a non-Bearer authorization header', () => {
    const guard = new OpsAccessGuard({ bearerToken: 'secret-ops-token', allowlist: [] });
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '10.0.0.1',
          headers: { authorization: 'Basic c29tZXRoaW5n' },
        }),
      }),
    } as never;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('admits an allowlisted IP with no token required', () => {
    const guard = new OpsAccessGuard({
      bearerToken: null,
      allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
    });
    expect(guard.canActivate(createContext({ ip: '10.0.0.5' }))).toBe(true);
  });

  it('denies an IP outside the allowlist', () => {
    const guard = new OpsAccessGuard({
      bearerToken: null,
      allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
    });
    expect(() => guard.canActivate(createContext({ ip: '203.0.113.9' }))).toThrow(
      ForbiddenException,
    );
  });

  it('matches IPv4 CIDR entries', () => {
    const guard = new OpsAccessGuard({
      bearerToken: null,
      allowlist: [{ kind: 'cidr', address: (10 << 24) | 1, prefixBits: 24 }], // 10.0.0.1/24
    });
    expect(guard.canActivate(createContext({ ip: '10.0.0.77' }))).toBe(true);
    expect(() => guard.canActivate(createContext({ ip: '10.2.0.77' }))).toThrow(
      ForbiddenException,
    );
  });

  it('matches IPv4 entries against IPv4-mapped IPv6 socket addresses', () => {
    const guard = new OpsAccessGuard({
      bearerToken: null,
      allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
    });
    expect(guard.canActivate(createContext({ ip: '::ffff:10.0.0.5' }))).toBe(true);
  });

  it('requires BOTH controls when both are configured', () => {
    const config: OpsAccessConfig = {
      bearerToken: 'secret-ops-token',
      allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
    };
    const guard = new OpsAccessGuard(config);

    // Right IP, wrong token → denied
    expect(() =>
      guard.canActivate(createContext({ ip: '10.0.0.5', token: 'nope' })),
    ).toThrow(ForbiddenException);
    // Right token, wrong IP → denied
    expect(() =>
      guard.canActivate(createContext({ ip: '203.0.113.9', token: 'secret-ops-token' })),
    ).toThrow(ForbiddenException);
    // Both right → admitted
    expect(
      guard.canActivate(createContext({ ip: '10.0.0.5', token: 'secret-ops-token' })),
    ).toBe(true);
  });

  it('reads configuration from OPS_BEARER_TOKEN / OPS_IP_ALLOWLIST env', () => {
    process.env.OPS_BEARER_TOKEN = 'env-token';
    process.env.OPS_IP_ALLOWLIST = '10.0.0.5, 192.168.16.0/24';
    const guard = new OpsAccessGuard();

    expect(() =>
      guard.canActivate(createContext({ ip: '10.0.0.5', token: 'wrong' })),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(createContext({ ip: '192.168.16.3', token: 'env-token' })),
    ).toBe(true);
  });
});

/**
 * OpsAccessMiddleware — Hono port of OpsAccessGuard
 * (packages/application-api/src/observability/ops-access.guard.ts, Worker
 * port task 3.2).
 *
 * Two independent controls, both configured via environment (no secrets in
 * code or repo):
 *
 *   - `OPS_BEARER_TOKEN`   — operator bearer token (Authorization: Bearer …)
 *   - `OPS_IP_ALLOWLIST`   — comma-separated IPs / IPv4 CIDRs allowed to
 *                            reach the route at all
 *
 * When both are configured, a request must satisfy BOTH (defense in depth:
 * a leaked token is useless from outside the allowlist; an allowlisted
 * host still needs the token). When only one is configured, that one alone
 * gates access. When NEITHER is configured the middleware fails closed —
 * an unconfigured ops surface must never expose operational data
 * (freshness, coverage, incident) to the public internet.
 *
 * The client IP is taken from the `CF-Connecting-IP` header — trustworthy
 * by construction on Cloudflare (design D5). The `X-Forwarded-For` header
 * is deliberately NOT honoured: trusting it without a known proxy in front
 * would let any client spoof allowlist membership (same rationale as the
 * rate-limit proxy-trust rule).
 *
 * Denials are generic 403s with no feedback about which control failed —
 * the Nest guard's parameterless ForbiddenException() body, byte-identical.
 *
 * @module ops-access
 */

import type { MiddlewareHandler } from 'hono';
import { ApiHttpError } from '../errors';
import type { AppEnv } from '../env';
import { createLogger } from '../logger';

/** Parsed middleware configuration (env-derived). */
export interface OpsAccessConfig {
  /** Configured bearer token, or null when token auth is off. */
  readonly bearerToken: string | null;
  /** Configured allowlist entries (IPs and/or IPv4 CIDRs); empty = off. */
  readonly allowlist: readonly AllowlistEntry[];
}

type AllowlistEntry =
  | { kind: 'ip'; value: string }
  | { kind: 'cidr'; address: number; prefixBits: number };

/** Parse `OPS_IP_ALLOWLIST` ("10.0.0.5, 192.168.0.0/24") into entries. */
export function parseAllowlist(raw: string | undefined): AllowlistEntry[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  const entries: AllowlistEntry[] = [];
  for (const part of trimmed.split(',')) {
    const item = part.trim();
    if (!item) continue;
    if (item.includes('/')) {
      const cidr = parseIpv4Cidr(item);
      if (cidr) entries.push({ kind: 'cidr', ...cidr });
    } else {
      entries.push({ kind: 'ip', value: item.toLowerCase() });
    }
  }
  return entries;
}

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function parseIpv4Cidr(item: string): { address: number; prefixBits: number } | null {
  const [address, bits] = item.split('/');
  const addressValue = parseIpv4(address);
  const prefixBits = Number(bits);
  if (addressValue === null || !Number.isInteger(prefixBits) || prefixBits < 0 || prefixBits > 32) {
    return null;
  }
  return { address: addressValue, prefixBits };
}

function matchesEntry(entry: AllowlistEntry, rawIp: string): boolean {
  // Report IPv4 connections on dual-stack sockets as ::ffff:a.b.c.d —
  // normalise so plain IPv4 allowlist entries match.
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice('::ffff:'.length) : rawIp;
  if (entry.kind === 'ip') return entry.value === ip.toLowerCase();
  const candidate = parseIpv4(ip);
  if (candidate === null) return false;
  const mask = entry.prefixBits === 0 ? 0 : (0xffffffff << (32 - entry.prefixBits)) >>> 0;
  return (candidate & mask) === (entry.address & mask);
}

/** Read the ops configuration from the Worker environment (`object` so
 * the Env interface is assignable; the view narrows to the two vars). */
export function opsAccessConfig(env: object): OpsAccessConfig {
  const vars = env as {
    OPS_BEARER_TOKEN?: string;
    OPS_IP_ALLOWLIST?: string;
  };
  return {
    bearerToken: vars.OPS_BEARER_TOKEN?.trim() || null,
    allowlist: parseAllowlist(vars.OPS_IP_ALLOWLIST),
  };
}

/** Constant-time equality over equal-length hex digests. */
function digestsMatch(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** SHA-256 hex digest of a string (WebCrypto — Workers-native). */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time bearer comparison — compare SHA-256 digests of both
 * values, so timing does not leak the expected token (parity with the
 * guard's createHash/timingSafeEqual pair).
 */
async function tokenMatches(expected: string, presented: string): Promise<boolean> {
  const [expectedDigest, presentedDigest] = await Promise.all([
    sha256Hex(expected),
    sha256Hex(presented),
  ]);
  return digestsMatch(expectedDigest, presentedDigest);
}

/**
 * Ops-access middleware. Configuration is read from `env` per request
 * (vars are static per isolate, so the deny decision stays stable for the
 * deployment's lifetime — the Worker equivalent of the guard's
 * construction-time env read; operators rotate config by redeploying).
 */
export function opsAccess(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { bearerToken, allowlist } = opsAccessConfig(c.env);

    // Fail closed: unconfigured = inaccessible.
    if (bearerToken === null && allowlist.length === 0) {
      createLogger(c.env.LOG_LEVEL).warn({
        requestId: c.get('requestId'),
        message: 'Ops route denied: no OPS_BEARER_TOKEN or OPS_IP_ALLOWLIST configured',
      });
      throw new ApiHttpError(403, 'Forbidden');
    }

    if (allowlist.length > 0) {
      // CF-Connecting-IP is the platform-attested client address (design
      // D5) — the Worker replacement for request.ip. No proxy header is
      // consulted.
      const ip = c.req.header('CF-Connecting-IP') ?? '';
      if (!allowlist.some((entry) => matchesEntry(entry, ip))) {
        // Generic denial — no feedback about which control failed.
        throw new ApiHttpError(403, 'Forbidden');
      }
    }

    if (bearerToken !== null) {
      const header = c.req.header('authorization');
      const presented =
        typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice('Bearer '.length).trim()
          : '';
      if (presented.length === 0 || !(await tokenMatches(bearerToken, presented))) {
        throw new ApiHttpError(403, 'Forbidden');
      }
    }

    await next();
  };
}

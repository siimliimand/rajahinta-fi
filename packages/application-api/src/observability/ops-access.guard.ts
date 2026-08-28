/**
 * OpsAccessGuard — protects the ops dashboard route.
 *
 * Two independent controls, both configured via environment (no secrets in
 * code or repo):
 *
 *   - `OPS_BEARER_TOKEN`   — operator bearer token (Authorization: Bearer …)
 *   - `OPS_IP_ALLOWLIST`   — comma-separated IPs / IPv4 CIDRs allowed to
 *                            reach the route at all
 *
 * When both are configured, a request must satisfy BOTH (defense in
 * depth: a leaked token is useless from outside the allowlist; a
 * allowlisted host still needs the token). When only one is configured,
 * that one alone gates access. When NEITHER is configured the guard fails
 * closed — an unconfigured ops dashboard must never expose operational
 * data (freshness, coverage, incident) to the public internet.
 *
 * The client IP is taken from the socket address (`request.ip`). The
 * `X-Forwarded-For` header is deliberately NOT honoured: trusting it here
 * without a known proxy in front would let any client spoof allowlist
 * membership (same rationale as the rate-limit proxy-trust rule).
 *
 * Replaceability: this guard is an interim barrier until session-based
 * auth exists (design D3 groundwork). It implements CanActivate with no
 * state beyond env config — swap it for a session guard by changing the
 * `@UseGuards` reference on OpsDashboardController only.
 *
 * @module OpsAccessGuard
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Parsed guard configuration (env-derived, immutable at runtime). */
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
function parseAllowlist(raw: string | undefined): AllowlistEntry[] {
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
  // Node reports IPv4 connections on dual-stack sockets as ::ffff:a.b.c.d —
  // normalise so plain IPv4 allowlist entries match.
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice('::ffff:'.length) : rawIp;
  if (entry.kind === 'ip') return entry.value === ip.toLowerCase();
  const candidate = parseIpv4(ip);
  if (candidate === null) return false;
  const mask = entry.prefixBits === 0 ? 0 : (0xffffffff << (32 - entry.prefixBits)) >>> 0;
  return (candidate & mask) === (entry.address & mask);
}

/** Constant-time bearer comparison — compare SHA-256 digests, not lengths. */
function tokenMatches(expected: string, presented: string): boolean {
  const expectedDigest = createHash('sha256').update(expected).digest();
  const presentedDigest = createHash('sha256').update(presented).digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

@Injectable()
export class OpsAccessGuard implements CanActivate {
  private readonly logger = new Logger(OpsAccessGuard.name);
  private readonly config: OpsAccessConfig;

  constructor(@Optional() config?: OpsAccessConfig) {
    // Reading env at construction (not per request) keeps the deny decision
    // stable for the process lifetime; operators restart to rotate config.
    this.config =
      config ?? {
        bearerToken: process.env.OPS_BEARER_TOKEN?.trim() || null,
        allowlist: parseAllowlist(process.env.OPS_IP_ALLOWLIST),
      };
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const { bearerToken, allowlist } = this.config;

    // Fail closed: unconfigured = inaccessible.
    if (bearerToken === null && allowlist.length === 0) {
      this.logger.warn('Ops route denied: no OPS_BEARER_TOKEN or OPS_IP_ALLOWLIST configured');
      throw new ForbiddenException();
    }

    if (allowlist.length > 0) {
      const ip = request.ip ?? '';
      if (!allowlist.some((entry) => matchesEntry(entry, ip))) {
        // Generic denial — no feedback about which control failed.
        throw new ForbiddenException();
      }
    }

    if (bearerToken !== null) {
      const header = request.headers?.['authorization'];
      const presented =
        typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice('Bearer '.length).trim()
          : '';
      if (presented.length === 0 || !tokenMatches(bearerToken, presented)) {
        throw new ForbiddenException();
      }
    }

    return true;
  }
}

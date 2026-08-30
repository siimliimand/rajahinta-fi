/**
 * Client identity for rate limiting — `CF-Connecting-IP` only (design D5).
 *
 * Replaces `RateLimitingService.extractKey`, whose X-Forwarded-For trust
 * hinge (`RATE_LIMIT_TRUST_PROXY`) existed because a self-hosted origin
 * could not tell proxy-set headers from client-spoofed ones. On Workers
 * the platform overwrites `CF-Connecting-IP` with the real client address
 * at the edge, so the header is trustworthy by construction — there is
 * nothing left to configure, and the old env var has no effect by design.
 * X-Forwarded-For is never read (pinned by test, even when the legacy env
 * var is set).
 *
 * @module Identity
 */

/** The only client-identity header: set (and overwritten) by Cloudflare's edge. */
export const CLIENT_IDENTITY_HEADER = 'CF-Connecting-IP';

/**
 * Resolve the rate-limit client key from request headers.
 *
 * Returns the edge-asserted client IP, or `'unknown'` when the header is
 * absent (direct workerd/dev traffic) — the same fallback shape as the
 * legacy extractor.
 */
export function resolveClientIdentity(headers: Headers): string {
  const value = headers.get(CLIENT_IDENTITY_HEADER);
  // Defensive first-token split: the fetch spec combines repeated header
  // values with commas, and we must never key on a client-appended tail.
  const ip = value?.split(',')[0]?.trim();
  return ip ? ip : 'unknown';
}

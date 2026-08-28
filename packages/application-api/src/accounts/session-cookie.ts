/**
 * Session cookie plumbing for server-issued session tokens (task 2.2,
 * change technical-assessment-remediation; design D3).
 *
 * The opaque token travels in an httpOnly cookie named `rajahinta_session`
 * so client-side JavaScript can never read it — unlike the retired
 * `x-user-id` header, whose value WAS the identity and was readable by any
 * script on the page. Parsing reads `request.cookies` when a cookie parser
 * is wired and falls back to the raw `Cookie` header otherwise (same
 * convention as the age gate), so the guard works in every host setup.
 *
 * @module session-cookie
 */

/** Cookie carrying the opaque session token (httpOnly, SameSite=Lax). */
export const SESSION_COOKIE_NAME = 'rajahinta_session';

/** Shape of the response object controllers use to set the cookie. */
export interface CookieResponse {
  header: (name: string, value: string) => unknown;
}

/**
 * Extract the session token from a request — parsed cookie jar first, then
 * the raw `Cookie` header.
 */
export function extractSessionToken(request: {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}): string | undefined {
  const fromJar = request.cookies?.[SESSION_COOKIE_NAME];
  if (typeof fromJar === 'string' && fromJar.length > 0) {
    return fromJar;
  }

  const rawCookie = request.headers?.cookie;
  if (typeof rawCookie !== 'string' || rawCookie.length === 0) {
    return undefined;
  }
  const match = rawCookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) {
    return undefined;
  }
  const value = match.slice(SESSION_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

/**
 * Build the `Set-Cookie` value for a freshly issued/rotated token. Expires
 * with the session row so cookie and database agree on lifetime.
 *
 * `Secure` is added only outside local development (the API is served over
 * plain HTTP there; browsers drop Secure cookies on http).
 */
export function buildSessionCookie(token: string, expiresAt: Date): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return (
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAgeSeconds}; Expires=${expiresAt.toUTCString()}${secure}`
  );
}

/** Build the `Set-Cookie` value that clears the session cookie (logout). */
export function buildSessionCookieClear(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return (
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
  );
}

/**
 * Set a `Set-Cookie` header on the (passthrough) response. No-ops when the
 * response object is absent (direct unit-test calls) so controllers stay
 * constructible without a full HTTP context.
 */
export function setSessionCookie(
  res: CookieResponse | undefined,
  cookieValue: string,
): void {
  res?.header('Set-Cookie', cookieValue);
}

/**
 * Email-verification groundwork (task 2.4, change
 * technical-assessment-remediation; design D5).
 *
 * The account row's `email` column IS the verified-email column (see
 * data-platform schema.ts — "Verified email address"). Anonymous accounts
 * are created with a placeholder address; replacing the placeholder with a
 * real address is the persisted verification state. No separate flag or
 * timestamp exists, so "verified" is derived: placeholder ⇒ anonymous and
 * disposable, anything else ⇒ verified.
 *
 * Until an account is verified, its data is DISPOSABLE and clearly not
 * protected by identity guarantees: the technical assessment treats
 * client-UUID anonymous accounts as throwaway, D3 declines to migrate
 * them, and retention may prune them without notice. Real email delivery
 * and an OIDC provider are explicit non-goals of this change — this module
 * is the groundwork they will plug into.
 *
 * @module email-verification
 */

/** Placeholder domain used for anonymous account rows. */
export const PLACEHOLDER_EMAIL_SUFFIX = '@placeholder.local';

/** RFC 5321 practical maximum email length. */
const MAX_EMAIL_LENGTH = 320;

/** True when the address is the anonymous placeholder, i.e. unverified. */
export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(PLACEHOLDER_EMAIL_SUFFIX);
}

/**
 * Derive the persisted verification state from an account row's email.
 * Placeholder ⇒ anonymous/unverified (data disposable); verified address on
 * the row ⇒ verified.
 */
export function isAccountVerified(email: string): boolean {
  return email.length > 0 && !isPlaceholderEmail(email);
}

/**
 * Conservative syntactic check for the upgrade endpoint — a real
 * verification flow (deliverability challenge, provider round-trip) is the
 * later work this groundwork anticipates.
 */
export function isValidEmailFormat(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const [local, domain] = [email.slice(0, at), email.slice(at + 1)];
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes('.')) return false;
  return true;
}

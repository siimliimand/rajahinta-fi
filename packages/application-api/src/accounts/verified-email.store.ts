/**
 * VerifiedEmailStore — narrow write port for the email-verification
 * upgrade path (task 2.4, change technical-assessment-remediation; D5).
 *
 * Persisting a verified email is an UPDATE on the account row's `email`
 * column (the documented verified-email column). The data-platform
 * `AccountRepository` abstract currently exposes no email-update method —
 * anonymize() is the only email-writing operation — so this port is the
 * seam the application layer depends on. Binding it to a real write is a
 * one-method data-platform addition (tracked for the lead); until then the
 * default binding in AccountModule fails explicitly instead of silently
 * losing the verification.
 *
 * @module VerifiedEmailStore
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Persists a verified email on an account row (replaces the placeholder). */
export abstract class VerifiedEmailStore {
  abstract setVerifiedEmail(userId: string, email: string): Promise<void>;
}

/**
 * Default binding: no durable write path exists yet (see module doc).
 * Fails with an explicit, operator-actionable error rather than pretending
 * the verification succeeded.
 */
@Injectable()
export class UnboundVerifiedEmailStore extends VerifiedEmailStore {
  async setVerifiedEmail(_userId: string, _email: string): Promise<void> {
    throw new ServiceUnavailableException(
      'Email verification persistence is not wired: the data-platform ' +
        'AccountRepository does not yet expose an email update. Bind ' +
        'VerifiedEmailStore once it does.',
    );
  }
}

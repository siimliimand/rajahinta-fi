/**
 * Email-token flows (task 2.3, change email-password-auth) — the
 * application logic behind POST /api/v1/account/verify-email/* and
 * /api/v1/account/password/*: single-use hashed tokens (design D3) and
 * dispatch through the email Worker's secret-protected
 * `/internal/email/send` contract (design D4, the freshness-alert cron's
 * client pattern).
 *
 * Security invariants pinned here:
 * - The raw token exists ONLY in the emailed link; the store keeps the
 *   SHA-256 hash. Consumption is the repository's single atomic UPDATE,
 *   so replay/expiry/wrong-purpose all fail closed.
 * - A confirmed verification or completed reset invalidates every
 *   outstanding same-purpose token of the account (design D3).
 * - Mail failures are LOGGED and swallowed — a broken email path never
 *   fails registration or a resend (design D4); the unverified state and
 *   the resend flow keep the account honest.
 * - Password policy gates BEFORE hashing on the reset path (task-2.1
 *   invariant: never run 600k PBKDF2 iterations on policy-rejected input).
 *
 * @module EmailTokenService
 */

import { isValidPassword, hashPassword } from '../auth/password';
import { D1EmailTokenStore } from '../adapters/email-token-store';
import { D1AccountStore, type AccountRow } from '../adapters/account-store';
import { recordSecurityEvent } from '../routes/auth.helpers';
import { createLogger, type Logger } from '../logger';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** Verification-token horizon (design D3). */
export const VERIFY_EMAIL_TOKEN_TTL_MS = 24 * 3_600_000;

/** Password-reset-token horizon (design D3). */
export const PASSWORD_RESET_TOKEN_TTL_MS = 3_600_000;

/** Send-contract path on the email Worker (parity with the alert crons). */
const EMAIL_SEND_PATH = '/internal/email/send';

/**
 * Shared-secret header — byte-parity with SEND_SECRET_HEADER in
 * apps/email-worker/src/app.ts (duplicated there for the same reason the
 * alert crons duplicate it: one string is not worth the bundle).
 */
const EMAIL_SEND_SECRET_HEADER = 'x-email-send-secret';

/** The structured email the send contract accepts (text + html). */
export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Per-deployment configuration (from the Worker env via the routes). */
export interface EmailTokenServiceConfig {
  /** Frontend origin the email links point at (/account/verify, /account/reset). */
  readonly frontendOrigin: string;
  readonly emailWorkerUrl?: string;
  readonly emailSendSecret?: string;
}

/** Injection seams — defaults are the real D1 stores and global fetch. */
export interface EmailTokenServiceDeps {
  readonly d1: D1DatabaseLike;
  readonly config: EmailTokenServiceConfig;
  readonly tokens?: D1EmailTokenStore;
  readonly accounts?: D1AccountStore;
  readonly log?: Logger;
  /** Test seam — defaults to the email-worker send contract. */
  readonly sendMail?: (mail: OutgoingEmail) => Promise<void>;
}

/** Outcome of a token-consuming flow. */
export type TokenFlowResult =
  | { readonly ok: true; readonly userId: string; readonly email: string }
  | { readonly ok: false; readonly reason: 'invalid_token' | 'invalid_password' };

// ---------------------------------------------------------------------------
// Mail bodies — FI (default) + EN, plain-text + HTML (design D4)
// ---------------------------------------------------------------------------

/** Render the verification mail. The raw token appears ONLY inside the link. */
export function buildVerificationEmail(
  to: string,
  token: string,
  frontendOrigin: string,
): OutgoingEmail {
  const link = `${frontendOrigin.replace(/\/+$/, '')}/account/verify?token=${token}`;
  return {
    to,
    subject: 'Vahvista sähköpostiosoite / Confirm your email — rajahinta',
    text: [
      'Hei!',
      '',
      'Vahvista sähköpostiosoitteesi avaamalla seuraava linkki (voimassa 24 tuntia):',
      link,
      '',
      'Jos et luonut tiliä rajahintaan, voit jättää tämän viestin huomiotta.',
      '',
      '---',
      '',
      'Hello!',
      '',
      'Confirm your email address by opening the link below (valid for 24 hours):',
      link,
      '',
      'If you did not create a rajahinta account, you can ignore this message.',
      '',
      '-- rajahinta.fi',
      '',
    ].join('\n'),
    html: [
      '<p>Hei!</p>',
      `<p>Vahvista sähköpostiosoitteesi avaamalla <a href="${link}">tämä linkki</a> (voimassa 24 tuntia).</p>`,
      '<p>Jos et luonut tiliä rajahintaan, voit jättää tämän viestin huomiotta.</p>',
      '<hr>',
      '<p>Hello!</p>',
      `<p>Confirm your email address by opening <a href="${link}">this link</a> (valid for 24 hours).</p>`,
      '<p>If you did not create a rajahinta account, you can ignore this message.</p>',
      '<p>— rajahinta.fi</p>',
    ].join('\n'),
  };
}

/** Render the password-reset mail (the reset logs out every session). */
export function buildPasswordResetEmail(
  to: string,
  token: string,
  frontendOrigin: string,
): OutgoingEmail {
  const link = `${frontendOrigin.replace(/\/+$/, '')}/account/reset?token=${token}`;
  return {
    to,
    subject: 'Vaihda salasana / Reset your password — rajahinta',
    text: [
      'Hei!',
      '',
      'Aseta uusi salasana avaamalla seuraava linkki (voimassa 1 tunti):',
      link,
      '',
      'Kun vaihdat salasanan, kaikki istuntosi kirjataan ulos.',
      'Jos et pyytänyt salasanan vaihtoa, voit jättää tämän viestin huomiotta.',
      '',
      '---',
      '',
      'Hello!',
      '',
      'Set a new password by opening the link below (valid for 1 hour):',
      link,
      '',
      'When you change your password, all your sessions are logged out.',
      'If you did not request a password reset, you can ignore this message.',
      '',
      '-- rajahinta.fi',
      '',
    ].join('\n'),
    html: [
      '<p>Hei!</p>',
      `<p>Aseta uusi salasana avaamalla <a href="${link}">tämä linkki</a> (voimassa 1 tunti).</p>`,
      '<p>Kun vaihdat salasanan, kaikki istuntosi kirjataan ulos.</p>',
      '<p>Jos et pyytänyt salasanan vaihtoa, voit jättää tämän viestin huomiotta.</p>',
      '<hr>',
      '<p>Hello!</p>',
      `<p>Set a new password by opening <a href="${link}">this link</a> (valid for 1 hour).</p>`,
      '<p>When you change your password, all your sessions are logged out.</p>',
      '<p>If you did not request a password reset, you can ignore this message.</p>',
      '<p>— rajahinta.fi</p>',
    ].join('\n'),
  };
}

/**
 * POST one mail to the email Worker's internal send contract — throws on
 * transport or rejection; the CALLER owns the log-only-never-throw policy
 * (sendAlertEmail parity).
 */
export async function sendMailViaEmailWorker(
  config: EmailTokenServiceConfig,
  mail: OutgoingEmail,
): Promise<void> {
  if (!config.emailWorkerUrl || !config.emailSendSecret) {
    throw new Error('email worker is not configured (EMAIL_WORKER_URL / EMAIL_SEND_SECRET)');
  }
  const url = `${config.emailWorkerUrl.replace(/\/+$/, '')}${EMAIL_SEND_PATH}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [EMAIL_SEND_SECRET_HEADER]: config.emailSendSecret,
    },
    body: JSON.stringify({
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!response.ok) {
    throw new Error(`email worker rejected the send: HTTP ${response.status}`);
  }
}

export class EmailTokenService {
  private readonly d1: D1DatabaseLike;
  private readonly config: EmailTokenServiceConfig;
  private readonly tokens: D1EmailTokenStore;
  private readonly accounts: D1AccountStore;
  private readonly log: Logger;
  private readonly sendMail: (mail: OutgoingEmail) => Promise<void>;

  constructor(deps: EmailTokenServiceDeps) {
    this.d1 = deps.d1;
    this.config = deps.config;
    this.tokens = deps.tokens ?? new D1EmailTokenStore(deps.d1);
    this.accounts = deps.accounts ?? new D1AccountStore(deps.d1);
    this.log = deps.log ?? createLogger(undefined);
    // Unconfigured deployments fail the send loudly; the flow methods
    // catch + log so the mail path can never fail its HTTP route.
    this.sendMail =
      deps.sendMail ?? ((mail) => sendMailViaEmailWorker(this.config, mail));
  }

  /** Mail delivery is per-env config; unconfigured = mail off (warn, skip). */
  private mailConfigured(): boolean {
    return Boolean(this.config.emailWorkerUrl && this.config.emailSendSecret);
  }

  /**
   * Mint + store a verify_email token and dispatch the verification mail.
   * NEVER throws: an unconfigured email worker is a warn + skip (parity
   * with the freshness-alert config gate), and a failed store write or
   * dispatch is logged (design D4 — mail failure must not fail
   * registration; the resend flow recovers).
   */
  async sendVerificationEmail(account: AccountRow): Promise<void> {
    if (!this.mailConfigured()) {
      this.log.warn({
        message: 'email worker unconfigured; verification email skipped',
        accountId: account.id,
      });
      return;
    }
    try {
      const issued = await this.tokens.issue(
        account.id,
        'verify_email',
        new Date(Date.now() + VERIFY_EMAIL_TOKEN_TTL_MS),
      );
      await this.sendMail(
        buildVerificationEmail(account.email, issued.token, this.config.frontendOrigin),
      );
    } catch (err) {
      this.log.error({
        message: 'verification email dispatch failed (registration/resend unaffected)',
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Consume a verify_email token and stamp the account's verification
   * instant. Single-use: the atomic consume loses to replay/expiry/wrong
   * purpose, and a confirmed verification retires the account's other
   * outstanding verification tokens (design D3).
   */
  async confirmEmailVerification(rawToken: string): Promise<TokenFlowResult> {
    const record = await this.tokens.findActive(rawToken, 'verify_email');
    if (record === null) {
      return { ok: false, reason: 'invalid_token' };
    }
    if (!(await this.tokens.consume(rawToken, 'verify_email'))) {
      // Lost a consume race (or expired between read and consume) — the
      // winner already redeemed it; this caller sees the uniform failure.
      return { ok: false, reason: 'invalid_token' };
    }

    const account = await this.accounts.findById(record.accountId);
    if (account === null) {
      // FK makes this unreachable; fail closed rather than trust it.
      return { ok: false, reason: 'invalid_token' };
    }

    await this.accounts.setVerifiedEmail(account.userId, new Date());
    await this.tokens.invalidateAllForAccount(account.id, 'verify_email');

    await recordSecurityEvent(this.d1, {
      entityType: 'account',
      entityId: account.userId,
      author: account.userId,
      action: 'updated',
      reason: 'email verified via single-use token',
      newValue: { email: account.email },
    });
    return { ok: true, userId: account.userId, email: account.email };
  }

  /**
   * Mint + store a password_reset token (1 h) and dispatch the reset
   * mail — ONLY when the account exists. Never throws; the route's 202
   * is unconditional, so the send outcome is invisible to the caller.
   */
  async sendPasswordResetEmail(email: string): Promise<void> {
    if (!this.mailConfigured()) {
      this.log.warn({
        message: 'email worker unconfigured; password-reset email skipped',
      });
      return;
    }
    try {
      const account = await this.accounts.findCredentialByEmail(email);
      if (account === null) {
        return;
      }
      const issued = await this.tokens.issue(
        account.id,
        'password_reset',
        new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      );
      await this.sendMail(
        buildPasswordResetEmail(account.email, issued.token, this.config.frontendOrigin),
      );
    } catch (err) {
      this.log.error({
        message: 'password-reset email dispatch failed (reset-request response unaffected)',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Consume a password_reset token, store the rehashed password, revoke
   * ALL of the account's sessions, and retire its outstanding reset
   * tokens (design D2/D3). The consume gate runs BEFORE any expensive
   * work; the password-policy gate runs BEFORE hashing (task-2.1
   * invariant).
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<TokenFlowResult> {
    if (!isValidPassword(newPassword)) {
      return { ok: false, reason: 'invalid_password' };
    }

    const record = await this.tokens.findActive(rawToken, 'password_reset');
    if (record === null) {
      return { ok: false, reason: 'invalid_token' };
    }
    if (!(await this.tokens.consume(rawToken, 'password_reset'))) {
      return { ok: false, reason: 'invalid_token' };
    }

    const account = await this.accounts.findById(record.accountId);
    if (account === null) {
      return { ok: false, reason: 'invalid_token' };
    }

    await this.accounts.setPasswordHash(account.userId, await hashPassword(newPassword));
    const revokedSessions = await this.accounts.revokeAllSessionsForAccount(account.id);
    await this.tokens.invalidateAllForAccount(account.id, 'password_reset');

    await recordSecurityEvent(this.d1, {
      entityType: 'account',
      entityId: account.userId,
      author: account.userId,
      action: 'updated',
      reason: 'password reset via single-use token; all sessions revoked',
      newValue: { revokedSessions },
    });
    return { ok: true, userId: account.userId, email: account.email };
  }
}

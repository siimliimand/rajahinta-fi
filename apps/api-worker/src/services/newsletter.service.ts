/**
 * Newsletter service (task 5.3, change trust-and-reach-roadmap; design
 * D4, spec content-publication) — the double opt-in mechanics and the
 * crash-safe broadcast pipeline behind the newsletter routes.
 *
 * ## Consent is account-independent
 *
 * A subscription does not require an account (different purpose,
 * different audience than the price-alert consent). The subscriber row
 * stores only the SHA-256 digest of a single-use confirmation token
 * (the email_tokens convention): the raw value exists solely in the
 * emailed links. Confirmation consumes PENDING → ACTIVE, but the hash
 * remains the row's lookup key — the SAME token is what later
 * authenticates the one-click unsubscribe link carried by every
 * newsletter email.
 *
 * ## Send pipeline — the alert intent-log pattern
 *
 * The ops notify-subscribers action mirrors the tax-change/price-alert
 * delivery exactly: cooldown check from the latest DELIVERED intent →
 * PENDING intent row → dispatch through the email worker send contract
 * → outcome mark. A retried action re-reads the delivered rows and
 * skips what a previous run already delivered, so a crash mid-batch
 * can never double-send (spec: crash-safe send). The scan set is
 * `findActive()` — a PENDING subscriber is unreachable by construction
 * (unconfirmed addresses are never mailed) and UNSUBSCRIBED is
 * terminal.
 *
 * @module NewsletterService
 */

import { D1NewsletterSubscriberRepository } from '../../../../packages/data-platform/src/repositories/d1/newsletter-subscriber.repository';
import { D1NewsletterNotificationRepository } from '../../../../packages/data-platform/src/repositories/d1/newsletter-notification.repository';
import type { NewsletterSubscriberRecord } from '../../../../packages/data-platform/src/abstracts';
import {
  buildNewsletterBroadcastEmail,
} from '../../../../apps/email-worker/src/templates';
import type { Logger } from '../logger';
import { hashToken, opaqueToken } from '../routes/auth.helpers';

/** Send-contract path on the email Worker (the alert crons' precedent). */
const EMAIL_SEND_PATH = '/internal/email/send';

/**
 * Shared-secret header — byte-parity with SEND_SECRET_HEADER in
 * apps/email-worker/src/app.ts (duplicated for the same reason the
 * alert crons duplicate it: one string is not worth the bundle).
 */
const EMAIL_SEND_SECRET_HEADER = 'x-email-send-secret';

/**
 * Redelivery cooldown (the PRICE_ALERT_COOLDOWN_MS rule applied to the
 * newsletter audience): at most one delivered newsletter per subscriber
 * per 24-hour period, measured from the latest DELIVERED intent row —
 * which is also what makes a retried broadcast skip already-delivered
 * subscribers.
 */
export const NEWSLETTER_NOTIFY_COOLDOWN_MS = 24 * 3_600 * 1_000;

/** The launch locales (schema docblock parity with the blog). */
const NEWSLETTER_LOCALES: ReadonlySet<string> = new Set(['fi', 'en']);

/** Resolve + validate a requested mail-locale (default fi). */
export function resolveNewsletterLocale(raw: unknown): 'fi' | 'en' {
  if (raw === undefined || raw === null || raw === '') return 'fi';
  if (typeof raw === 'string' && NEWSLETTER_LOCALES.has(raw)) {
    return raw as 'fi' | 'en';
  }
  throw new Error('locale must be one of: fi, en');
}

/** Per-deployment configuration (from the Worker env via the routes). */
export interface NewsletterConfig {
  /** Frontend origin the mailed links point at (APP_PUBLIC_URL fallback parity). */
  readonly frontendOrigin: string;
  readonly emailWorkerUrl?: string;
  readonly emailSendSecret?: string;
}

/** The structured email the send contract accepts (the OutgoingEmail shape). */
export interface NewsletterOutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Build this subscriber's confirm + one-click unsubscribe URLs. */
export function buildNewsletterLinks(
  config: NewsletterConfig,
  locale: 'fi' | 'en',
  token: string,
): { confirmUrl: string; unsubscribeUrl: string } {
  const origin = config.frontendOrigin.replace(/\/+$/, '');
  return {
    confirmUrl: `${origin}/${locale}/newsletter/confirm?token=${token}`,
    unsubscribeUrl: `${origin}/${locale}/newsletter/unsubscribe?token=${token}`,
  };
}

/** Mint a confirmation token; returns the raw value + the stored digest. */
export async function mintConfirmationToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const token = opaqueToken();
  return { token, tokenHash: await hashToken(token) };
}

/**
 * POST one mail to the email Worker's internal send contract — throws
 * on transport or rejection; the CALLER owns the log-only-never-throw
 * policy (sendMailViaEmailWorker parity).
 */
export async function sendNewsletterEmail(
  config: NewsletterConfig,
  mail: NewsletterOutgoingEmail,
): Promise<void> {
  if (!config.emailWorkerUrl || !config.emailSendSecret) {
    throw new Error(
      'email worker is not configured (EMAIL_WORKER_URL / EMAIL_SEND_SECRET)',
    );
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

// ---------------------------------------------------------------------------
// Broadcast pipeline — intent log + cooldown + outcome marking
// ---------------------------------------------------------------------------

/** One broadcast run's outcome — the audit entry + route response face. */
export interface NewsletterBroadcastResult {
  /** ACTIVE subscribers in the scan set. */
  readonly total: number;
  /** Sends that completed and were marked delivered. */
  readonly notified: number;
  /** Sends that failed (the pending/failed intent is retried next run). */
  readonly failed: number;
  /** Subscribers skipped by the 24-hour delivered-row cooldown. */
  readonly skipped: number;
}

/** Seam overrides (test doubles; defaults are the real D1/fetch paths). */
export interface NewsletterBroadcastDeps {
  subscribers?: D1NewsletterSubscriberRepository;
  notifications?: D1NewsletterNotificationRepository;
  send?: (mail: NewsletterOutgoingEmail) => Promise<void>;
  now?: () => Date;
}

/** The run-local, mutable twin of the result shape. */
interface MutableBroadcastCounters {
  notified: number;
  failed: number;
  skipped: number;
}

/**
 * Run one notify-subscribers broadcast: scan ACTIVE subscribers, skip
 * anyone inside the cooldown, write the PENDING intent BEFORE dispatch,
 * mark the outcome AFTER. Per-subscriber isolation: a failing send
 * counts failed and never aborts the batch (the alert-sweep rule).
 */
export async function notifyNewsletterSubscribers(
  d1: import('../../../../packages/data-platform/src/d1/executor').D1DatabaseLike,
  config: NewsletterConfig,
  content: { readonly subject: string; readonly bodyFi: string; readonly bodyEn: string },
  log: Logger,
  deps: NewsletterBroadcastDeps = {},
): Promise<NewsletterBroadcastResult> {
  const now = deps.now ?? (() => new Date());
  const subscribers =
    deps.subscribers ?? new D1NewsletterSubscriberRepository(d1);
  const notifications =
    deps.notifications ?? new D1NewsletterNotificationRepository(d1);
  const send =
    deps.send ??
    ((mail: NewsletterOutgoingEmail) => sendNewsletterEmail(config, mail));

  // The scan set is exactly the ACTIVE rows — PENDING is never mailed
  // (repository filter; unconfirmed addresses cannot receive news).
  const audience: NewsletterSubscriberRecord[] = await subscribers.findActive();
  const counters: MutableBroadcastCounters = { notified: 0, failed: 0, skipped: 0 };

  for (const subscriber of audience) {
    try {
      // Cooldown from the latest DELIVERED intent — the same read makes
      // a retried run skip what a previous run already delivered
      // (crash-safe redelivery, spec: crash-safe send).
      const latestDelivered =
        await notifications.findLatestDeliveredBySubscriberId(subscriber.id);
      if (
        latestDelivered !== null &&
        now().getTime() - latestDelivered.createdAt.getTime() <
          NEWSLETTER_NOTIFY_COOLDOWN_MS
      ) {
        counters.skipped++;
        continue;
      }

      // The per-recipient one-click unsubscribe link (spec: EVERY
      // newsletter email carries it). A broadcast cannot embed the raw
      // confirmation token — only its SHA-256 digest is stored — so the
      // standing unsubscribe capability IS the stored digest: knowledge
      // of a preimage-resistant digest grants exactly one power,
      // ending the subscription, and nothing else. The unsubscribe
      // route resolves both forms (raw token or digest; see
      // resolveUnsubscribeTokenHash in newsletter.routes.ts).
      const digestHex = subscriber.confirmationTokenHash;
      const origin = config.frontendOrigin.replace(/\/+$/, '');
      const unsubscribeUrl = `${origin}/fi/newsletter/unsubscribe?token=${digestHex}`;

      const mail = buildNewsletterBroadcastEmail({
        subject: content.subject,
        bodyFi: content.bodyFi,
        bodyEn: content.bodyEn,
        unsubscribeUrl,
      });

      // Intent row MUST exist before any dispatch attempt (spec:
      // delivery intent log).
      const intent = await notifications.createIntent({
        subscriberId: subscriber.id,
        channel: 'email',
      });

      try {
        await send({ to: subscriber.email, ...mail });
      } catch (err) {
        log.error({
          message: `Newsletter broadcast: dispatch to subscriber ${subscriber.id} failed: ${
            err instanceof Error ? err.message : 'unknown error'
          } — the pending intent is retried on the next run`,
          subscriberId: subscriber.id,
        });
        // Best-effort marking; a marking failure leaves the row
        // pending, and the next run's re-attempt is the retry path.
        await notifications
          .markFailed(intent.id)
          .catch((markErr: unknown) => {
            log.error({
              message: `Newsletter broadcast: mark-failed for subscriber ${subscriber.id} failed: ${
                markErr instanceof Error ? markErr.message : 'unknown error'
              }`,
            });
          });
        counters.failed++;
        continue;
      }

      // null would mean the row already left pending (a concurrent
      // marker) — the send itself still succeeded, so it counts notified.
      const marked = await notifications.markDelivered(intent.id);
      if (marked === null) {
        log.warn({
          message: `Newsletter broadcast: intent ${intent.id} was already marked by another writer`,
        });
      }
      counters.notified++;
    } catch (err) {
      counters.failed++;
      log.error({
        message: `Newsletter broadcast: subscriber ${subscriber.id} failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        subscriberId: subscriber.id,
      });
    }
  }

  return { total: audience.length, ...counters };
}

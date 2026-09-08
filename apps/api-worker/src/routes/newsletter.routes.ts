/**
 * Newsletter routes (task 5.3, change trust-and-reach-roadmap; design
 * D4, spec content-publication) — double opt-in, independent of
 * accounts and of price-alert consent.
 *
 *   POST /api/v1/newsletter/subscribe      AUTH rate limit (public)
 *   GET  /api/v1/newsletter/confirm?token= PUBLIC — the token IS the capability
 *   GET  /api/v1/newsletter/unsubscribe    PUBLIC — one-click link target
 *
 * Consent discipline: subscribe stores a PENDING row keyed by the
 * SHA-256 digest of a single-use token and dispatches the confirmation
 * mail best-effort (the register precedent — a mail failure must not
 * fail the request, and the response is uniform regardless). A PENDING
 * row is unreachable by the broadcast scan (`findActive`), so an
 * unconfirmed address is never mailed newsletter content. Unsubscribe
 * is one click (a GET the mail client performs — the only HTTP method a
 * plain link can speak) and takes effect immediately; the transition is
 * guarded and terminal in the repository, so double clicks and stale
 * links converge on the same honest UNSUBSCRIBED response.
 *
 * Capability forms on the token parameter:
 * - the RAW confirmation token (confirmation mail links; hashed before
 *   lookup), or
 * - the STORED DIGEST itself (broadcast unsubscribe links — the
 *   standing one-click capability; see newsletter.service.ts).
 *
 * The confirm route deliberately accepts ONLY the raw token: the
 * digest form is an unsubscribe-only power.
 *
 * @module NewsletterRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { D1NewsletterSubscriberRepository } from '../../../../packages/data-platform/src/repositories/d1/newsletter-subscriber.repository';
import { DuplicateNewsletterSubscriptionError } from '../../../../packages/data-platform/src/abstracts';
import {
  buildNewsletterConfirmationEmail,
} from '../../../../apps/email-worker/src/templates';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { createLogger } from '../logger';
import { parseDto } from './support';
import {
  hashToken,
  isValidEmailFormat,
} from './auth.helpers';
import {
  buildNewsletterLinks,
  mintConfirmationToken,
  resolveNewsletterLocale,
  sendNewsletterEmail,
} from '../services/newsletter.service';

const EMAIL_MESSAGE = '"email" is required and must be a valid email address';
const LOCALE_MESSAGE = 'locale must be one of: fi, en';

const subscribeSchema = z.object({
  email: z
    .string({ required_error: EMAIL_MESSAGE, invalid_type_error: EMAIL_MESSAGE })
    .min(1, EMAIL_MESSAGE),
  locale: z
    .string({ invalid_type_error: LOCALE_MESSAGE })
    .refine((value) => value === 'fi' || value === 'en', LOCALE_MESSAGE)
    .optional(),
});

/** InvalidEmail envelope — accounts.routes register parity. */
function invalidEmailError(): ApiHttpError {
  return new ApiHttpError(400, {
    statusCode: 400,
    message: EMAIL_MESSAGE,
    error: 'InvalidEmail',
  });
}

/** Per-request service config (accounts.routes emailTokenService parity). */
function newsletterConfig(c: Context<AppEnv>) {
  return {
    // Frontend origin the mailed links point at (design D4). Per-env
    // wrangler var; the fallback is the production custom-domain origin.
    frontendOrigin:
      (c.env as { APP_PUBLIC_URL?: string }).APP_PUBLIC_URL ?? 'https://rajahinta.fi',
    emailWorkerUrl: c.env.EMAIL_WORKER_URL,
    emailSendSecret: c.env.EMAIL_SEND_SECRET,
  };
}

/**
 * POST /api/v1/newsletter/subscribe — store PENDING + mail the
 * confirmation token. The 202 is uniform for fresh and already-subscribed
 * addresses (no existence oracle for the bulk-mail surface): a
 * duplicate re-answers without a second mail and without touching the
 * stored row.
 */
async function subscribe(c: Context<AppEnv>): Promise<Response> {
  const body = await parseDto(c, subscribeSchema);
  // The syntactic check is imperative so the rejection carries the
  // InvalidEmail error name (register/login parity), not ValidationError.
  if (!isValidEmailFormat(body.email)) {
    throw invalidEmailError();
  }
  const locale = resolveNewsletterLocale(body.locale);
  const config = newsletterConfig(c);
  const log = createLogger(c.env.LOG_LEVEL);
  const email = body.email.toLowerCase();

  let token: string | null = null;
  try {
    const minted = await mintConfirmationToken();
    token = minted.token;
    await new D1NewsletterSubscriberRepository(c.env.DB).subscribe({
      email,
      confirmationTokenHash: minted.tokenHash,
    });
  } catch (err) {
    if (err instanceof DuplicateNewsletterSubscriptionError) {
      // Uniform 202 — no second mail, no overwrite, no existence leak.
      return c.json({ status: 'PENDING' }, 202);
    }
    throw err;
  }

  // Confirmation mail best-effort (register parity): an unconfigured or
  // failing email worker leaves the row PENDING and logs — the response
  // stays the same so the endpoint cannot be probed for mail health.
  // The raw token appears ONLY in the mailed links.
  if (config.emailWorkerUrl && config.emailSendSecret) {
    try {
      const links = buildNewsletterLinks(config, locale, token);
      const mail = buildNewsletterConfirmationEmail(links);
      await sendNewsletterEmail(config, { to: email, ...mail });
    } catch (err) {
      log.warn({
        message: `Newsletter confirmation mail failed for a new subscriber: ${
          err instanceof Error ? err.message : 'unknown error'
        } — the row stays PENDING`,
      });
    }
  } else {
    log.warn({
      message:
        'email worker unconfigured; newsletter confirmation mail skipped (row stays PENDING)',
    });
  }

  return c.json({ status: 'PENDING' }, 202);
}

/**
 * Resolve the unsubscribe capability: a 64-hex value IS the stored
 * digest (broadcast-link form); anything else is a raw token to hash
 * first (confirmation-link form). Both converge on the same lookup.
 */
async function resolveUnsubscribeTokenHash(
  presented: string,
): Promise<string> {
  if (/^[0-9a-f]{64}$/i.test(presented)) {
    return presented.toLowerCase();
  }
  return hashToken(presented);
}

/** Uniform rejection for a bad/unknown token — no existence feedback. */
function invalidTokenError(): ApiHttpError {
  return new ApiHttpError(400, {
    statusCode: 400,
    message: 'token is invalid or expired',
    error: 'InvalidToken',
  });
}

/**
 * GET /api/v1/newsletter/confirm?token=… — consume the single-use
 * confirmation (PENDING → ACTIVE). Idempotent for an already-active
 * subscriber; an UNSUBSCRIBED row answers honestly (terminal — the
 * consent is gone and does not resurrect via an old link).
 */
async function confirm(c: Context<AppEnv>): Promise<Response> {
  const token = c.req.query('token') ?? '';
  if (token.length === 0) {
    throw invalidTokenError();
  }
  const repo = new D1NewsletterSubscriberRepository(c.env.DB);
  const subscriber = await repo.findByConfirmationTokenHash(
    await hashToken(token),
  );
  if (subscriber === null) {
    throw invalidTokenError();
  }

  if (subscriber.status === 'PENDING') {
    const confirmed = await repo.confirm(
      subscriber.id,
      new Date(),
    );
    if (confirmed !== null) {
      return c.json({ status: confirmed.status });
    }
    // A concurrent writer moved the row first — fall through to the
    // current state below.
    const current = await repo.findById(subscriber.id);
    return c.json({ status: current?.status ?? 'ACTIVE' });
  }
  return c.json({ status: subscriber.status });
}

/**
 * GET /api/v1/newsletter/unsubscribe?token=… — the one-click link
 * target; immediate and terminal. GET is deliberate: the link is
 * clicked from a mail client, which cannot perform other methods, and
 * the capability (token/digest) is what authorizes the state change.
 */
async function unsubscribe(c: Context<AppEnv>): Promise<Response> {
  const token = c.req.query('token') ?? '';
  if (token.length === 0) {
    throw invalidTokenError();
  }
  const repo = new D1NewsletterSubscriberRepository(c.env.DB);
  const subscriber = await repo.findByConfirmationTokenHash(
    await resolveUnsubscribeTokenHash(token),
  );
  if (subscriber === null) {
    throw invalidTokenError();
  }

  // Guarded + terminal in the repository: already-unsubscribed matches
  // no row (null) and re-answers the same honest status.
  const unsubscribed = await repo.unsubscribe(subscriber.id, new Date());
  return c.json({ status: unsubscribed?.status ?? 'UNSUBSCRIBED' });
}

/**
 * Register the newsletter handlers. The subscribe route's AUTH rate
 * limit rides its GUARDED_ROUTES entry; confirm/unsubscribe stay out
 * of the table — the emailed token IS the capability (the
 * verify-email/confirm precedent).
 */
export function registerNewsletterRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post('/api/v1/newsletter/subscribe', subscribe);
  app.get('/api/v1/newsletter/confirm', confirm);
  app.get('/api/v1/newsletter/unsubscribe', unsubscribe);
  return app;
}

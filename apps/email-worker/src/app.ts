/**
 * Hono application for the email Worker (migrate-to-cloudflare task 5.3;
 * HTTP layer: Hono — design D1).
 *
 * `POST /internal/email/send` — the token-authenticated internal send
 * contract (spec: cloudflare-email-service). Requests carry the shared
 * secret in the `X-Email-Send-Secret` header; failures use the unified
 * ApiErrorResponse envelope shared with the public API; success dispatches
 * through the EmailTransport port and returns the delivery outcome. Two
 * payload kinds share the path: the generic subject/body mail and the
 * structured digest payload (recognized by its `digest` field), which is
 * rendered here from the core-domain facts before dispatch.
 *
 * @module app
 */

import { Hono } from 'hono';
import { ApiError, apiErrorEnvelope } from './errors';
import { isValidEmailFormat, parseSendEmailRequest } from './validation';
import { buildMimeMessage, type OutgoingEmail } from './mime';
import { buildPreferenceDigestEmail } from './preference-digest-email';
import { SendEmailBindingTransport, type EmailTransport } from './transport';
import type { WorkerEnv } from './env';

/** Header carrying the shared secret on the internal send contract. */
export const SEND_SECRET_HEADER = 'x-email-send-secret';

/** Fallback origin — the same default the API Worker's link builders use. */
const DEFAULT_PUBLIC_ORIGIN = 'https://rajahinta.fi';

/**
 * Absolute `/onboarding` preferences-editor URL — the digest footer's
 * consent-change link, composed from the same frontend-origin config the
 * confirm/unsubscribe links use (`APP_PUBLIC_URL` with the production
 * fallback). Locale is FI until a per-account locale exists (design open
 * question), and the payload's `locale` drives only the copy.
 */
function onboardingUrl(env: WorkerEnv): string {
  const origin = (env.APP_PUBLIC_URL ?? DEFAULT_PUBLIC_ORIGIN).replace(
    /\/+$/,
    '',
  );
  return `${origin}/onboarding`;
}

/** JSON response with explicit status — identical semantics to Hono's c.json. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

/**
 * Constant-time shared-secret comparison. Both sides are hashed to fixed
 * 32-byte digests first, so the comparison length never leaks information
 * about either value.
 */
export async function secretsMatch(
  provided: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (
    provided === undefined ||
    provided.length === 0 ||
    expected === undefined ||
    expected.length === 0
  ) {
    return false;
  }
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedDigest);
  const b = new Uint8Array(expectedDigest);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export interface CreateEmailWorkerAppOptions {
  readonly env: WorkerEnv;
  /** Transport override for tests — defaults to the send_email binding adapter. */
  readonly transport?: EmailTransport;
}

export function createEmailWorkerApp(
  options: CreateEmailWorkerAppOptions,
): Hono {
  const app = new Hono();
  const env = options.env;
  const transport =
    options.transport ?? new SendEmailBindingTransport(env.EMAIL);

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return jsonResponse(
        apiErrorEnvelope(error.status, error.message, c.req.path, error.error),
        error.status,
      );
    }
    // Unknown error: generic 500, details only in the server log.
    console.error(
      'email-worker: unhandled error',
      error instanceof Error ? error.stack : String(error),
    );
    return jsonResponse(
      apiErrorEnvelope(500, 'Internal server error', c.req.path, 'InternalServerError'),
      500,
    );
  });

  app.notFound((c) =>
    jsonResponse(apiErrorEnvelope(404, 'Not found', c.req.path), 404),
  );

  app.post('/internal/email/send', async (c) => {
    // 1. Shared secret — constant-time; reject before touching the body.
    const authorized = await secretsMatch(
      c.req.header(SEND_SECRET_HEADER),
      env.EMAIL_SEND_SECRET,
    );
    if (!authorized) {
      throw new ApiError(401, 'Missing or invalid send secret');
    }

    // 2. Body parse.
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiError(400, 'Request body must be valid JSON', 'BadRequest');
    }

    // 3. Field validation.
    const parsed = parseSendEmailRequest(raw);
    if (!parsed.ok) {
      throw new ApiError(
        parsed.status,
        parsed.message,
        parsed.status === 413 ? 'PayloadTooLarge' : 'ValidationError',
      );
    }

    // 4. Sender configuration — operator errors, not caller errors.
    if (!env.EMAIL) {
      throw new ApiError(503, 'EMAIL binding is not configured');
    }
    if (!env.EMAIL_FROM || !isValidEmailFormat(env.EMAIL_FROM)) {
      throw new ApiError(503, 'EMAIL_FROM is not a valid verified sender address');
    }

    // 5. Render + build MIME and dispatch through the port. The digest
    // kind renders server-side (apps/email-worker owns digest subject and
    // body); the generic kind carries its subject/body verbatim.
    const request = parsed.value;
    const email: OutgoingEmail =
      'digest' in request
        ? {
            from: env.EMAIL_FROM,
            to: request.to,
            ...buildPreferenceDigestEmail({
              week: request.digest.week,
              facts: request.digest.facts,
              locale: request.locale,
              onboardingUrl: onboardingUrl(env),
            }),
          }
        : { from: env.EMAIL_FROM, ...request };
    const built = buildMimeMessage(email);
    try {
      await transport.send(built);
    } catch (dispatchError) {
      console.error(
        `email-worker: dispatch failed messageId=${built.messageId}`,
        dispatchError instanceof Error ? dispatchError.stack : String(dispatchError),
      );
      throw new ApiError(502, 'Email delivery failed', 'EmailDeliveryError');
    }

    return jsonResponse(
      {
        accepted: true,
        messageId: built.messageId,
        to: request.to,
        status: 'sent',
      },
      202,
    );
  });

  // Every other method on the send path gets the same envelope.
  const nonPostMethods = ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  app.on(nonPostMethods, '/internal/email/send', (c) =>
    jsonResponse(
      apiErrorEnvelope(405, 'Method not allowed', c.req.path),
      405,
    ),
  );

  return app;
}

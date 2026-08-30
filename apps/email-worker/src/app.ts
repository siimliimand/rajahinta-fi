/**
 * Hono application for the email Worker (migrate-to-cloudflare task 5.3;
 * HTTP layer: Hono — design D1).
 *
 * `POST /internal/email/send` — the token-authenticated internal send
 * contract (spec: cloudflare-email-service). Requests carry the shared
 * secret in the `X-Email-Send-Secret` header; failures use the unified
 * ApiErrorResponse envelope shared with the public API; success dispatches
 * through the EmailTransport port and returns the delivery outcome.
 *
 * @module app
 */

import { Hono } from 'hono';
import { ApiError, apiErrorEnvelope } from './errors';
import { isValidEmailFormat, parseSendEmailRequest } from './validation';
import { buildMimeMessage } from './mime';
import { SendEmailBindingTransport, type EmailTransport } from './transport';
import type { WorkerEnv } from './env';

/** Header carrying the shared secret on the internal send contract. */
export const SEND_SECRET_HEADER = 'x-email-send-secret';

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

    // 5. Build MIME and dispatch through the port.
    const built = buildMimeMessage({ from: env.EMAIL_FROM, ...parsed.value });
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
        to: parsed.value.to,
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

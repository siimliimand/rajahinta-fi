/**
 * Route-port shared helpers (tasks 3.5–3.8).
 *
 * The Nest controllers validate imperatively and throw built-in exceptions
 * whose bodies ride the unified envelope; these helpers reproduce those
 * bodies exactly. DTO schemas arrive per route file — this module only
 * carries the parse/throw mechanics and the Nest pipe parity for integer
 * path params.
 *
 * @module RouteSupport
 */

import type { Context } from 'hono';
import type { ZodType, ZodError } from 'zod';
import { ApiHttpError } from '../errors';

/** Nest's ParseIntPipe rejection body (BadRequestException parity). */
const PARSE_INT_MESSAGE = 'Validation failed (numeric string is expected)';

/**
 * Parse and validate the JSON body against a zod schema, throwing the
 * controllers' exact validation envelope:
 *
 *   400 { statusCode: 400, message: <issues joined '; '>,
 *         error: 'ValidationError' }
 *
 * Issue order follows the schema — the controllers validate fields in
 * declaration order and join with '; ', so each schema's custom messages
 * carry the controller's exact strings.
 */
export async function parseDto<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiHttpError(400, 'Request body must be JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

/** Build the 400 ValidationError payload from a zod failure. */
export function validationError(error: ZodError): ApiHttpError {
  const message = error.issues.map((issue) => issue.message).join('; ');
  return new ApiHttpError(400, {
    statusCode: 400,
    message,
    error: 'ValidationError',
  });
}

/**
 * Integer path parameter — ParseIntPipe parity. Non-numeric or
 * non-integer segments reject with the pipe's exact 400 body.
 */
export function parseIntParam(c: Context, name: string): number {
  const raw = c.req.param(name) ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: PARSE_INT_MESSAGE,
      error: 'Bad Request',
    });
  }
  return parsed;
}

/** UUID path parameter — ParseUUIDPipe parity (version-4 shaped). */
export function parseUuidParam(c: Context, name: string): string {
  const raw = c.req.param(name) ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'Validation failed (uuid is expected)',
      error: 'Bad Request',
    });
  }
  return raw;
}

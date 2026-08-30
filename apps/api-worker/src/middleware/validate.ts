/**
 * zod DTO validation layer (task 3.1) — the Workers-side equivalent of the
 * imperative controller validation pattern: on any failure it throws a 400
 * ApiHttpError, so the unified envelope (api-error.filter parity) shapes
 * the response. All zod issues are joined into the single string `message`
 * field, exactly like the filter normalizes array messages. Per-endpoint
 * schemas arrive in tasks 3.5–3.8; this is the mechanism plus one exemplar
 * (src/dto/exemplar.ts).
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { ZodType } from 'zod';
import { ApiHttpError } from '../errors';

/**
 * Parse + validate the JSON body against a zod schema. Throws a 400
 * (envelope-shaped) ApiHttpError on malformed JSON or schema violations;
 * returns the parsed, typed DTO otherwise.
 */
export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiHttpError(400, 'Request body must be JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) =>
        issue.path.length > 0
          ? `${issue.path.join('.')}: ${issue.message}`
          : issue.message,
      )
      .join('; ');
    throw new ApiHttpError(400, message);
  }
  return result.data;
}

/**
 * Middleware form: validates the JSON body and stores the parsed DTO in
 * the context (`c.get('validatedBody')`) for the handler.
 */
export function validateBody<T>(
  schema: ZodType<T>,
): MiddlewareHandler<{ Variables: { validatedBody: T } }> {
  return async (c, next) => {
    c.set('validatedBody', await parseBody(c, schema));
    await next();
  };
}

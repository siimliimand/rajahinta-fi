/**
 * Error-boundary middleware — the net for throws Hono's compose does not
 * deliver to app.onError.
 *
 * Runtime semantics (hono/src/compose.ts): every dispatch frame has its
 * own try/catch, and an `Error` thrown by a handler is handed to
 * app.onError at the innermost frame — outer try/catch middleware never
 * sees it. compose only rethrows when the thrown value is NOT an Error
 * instance; those propagate outward and are caught here, preserving the
 * @Catch() "catch anything" coverage of the original ApiErrorFilter.
 * Both interception points share respondToError (src/errors.ts).
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { respondToError } from '../errors';

export function errorBoundary(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let response: Response | undefined;
    try {
      await next();
    } catch (err) {
      response = respondToError(c, err);
    }
    return response;
  };
}

/**
 * ApiErrorFilter tests (task 3.4, change technical-assessment-remediation).
 *
 * Every error — HttpException (with object or string body) and unknown
 * errors — must come out as the documented ApiErrorResponse shape with
 * `timestamp` and `path` filled in, while preserving domain context fields
 * the throw site added (productId, retryAfterSeconds, …).
 *
 * @module ApiErrorFilterTest
 */

import { describe, it, expect } from 'vitest';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import { ApiErrorFilter } from '../common/api-error.filter';

/** Captured response writes for one catch() invocation. */
interface Captured {
  host: ArgumentsHost;
  statusCode(): number;
  body(): Record<string, unknown>;
}

/** ArgumentsHost double capturing status/json writes. */
function hostDouble(url: string): Captured {
  let statusCode = -1;
  let json: Record<string, unknown> = {};
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (code: number) => {
          statusCode = code;
        },
        json: (b: Record<string, unknown>) => {
          json = b;
        },
      }),
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return {
    host,
    statusCode: () => statusCode,
    body: () => json,
  };
}

describe('ApiErrorFilter', () => {
  const filter = new ApiErrorFilter();

  it('enriches an object-body HttpException into the ApiErrorResponse shape', () => {
    const h = hostDouble('/api/v1/account/baskets');
    filter.catch(
      new NotFoundException({
        statusCode: 404,
        message: 'Basket "x" not found',
        error: 'BasketNotFound',
      }),
      h.host,
    );

    const body = h.body();
    expect(h.statusCode()).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      message: 'Basket "x" not found',
      error: 'BasketNotFound',
    });
    expect(typeof body.timestamp).toBe('string');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.path).toBe('/api/v1/account/baskets');
  });

  it('preserves domain context fields from the thrown body', () => {
    const h = hostDouble('/api/v1/basket/optimize');
    filter.catch(
      new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: 'too many combinations',
          error: 'BasketCombinationLimitExceeded',
          totalCombinations: 11_000_000,
          limit: 1_000_000,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      h.host,
    );

    expect(h.statusCode()).toBe(422);
    expect(h.body()).toMatchObject({
      statusCode: 422,
      error: 'BasketCombinationLimitExceeded',
      totalCombinations: 11_000_000,
      limit: 1_000_000,
      path: '/api/v1/basket/optimize',
    });
  });

  it('string-body exceptions (Nest default) still produce the full envelope', () => {
    const h = hostDouble('/api/v1/outbound/1');
    filter.catch(
      new NotFoundException('Offer 1 not found or has no source URL'),
      h.host,
    );

    const body = h.body();
    expect(body).toMatchObject({
      statusCode: 404,
      message: 'Offer 1 not found or has no source URL',
    });
    expect(typeof body.error).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(body.path).toBe('/api/v1/outbound/1');
  });

  it('missing error field falls back to the status reason phrase', () => {
    const h = hostDouble('/api/v1/x');
    filter.catch(new BadRequestException('bad input'), h.host);

    expect(h.body()).toMatchObject({
      statusCode: 400,
      message: 'bad input',
      error: 'Bad Request',
    });
  });

  it('array messages (validation-pipe style) collapse to a single string', () => {
    const h = hostDouble('/api/v1/x');
    filter.catch(
      new BadRequestException(['field a is wrong', 'field b is wrong']),
      h.host,
    );

    expect(h.body()).toMatchObject({
      statusCode: 400,
      message: 'field a is wrong; field b is wrong',
    });
  });

  it('unknown errors become a generic 500 without leaking internals', () => {
    const h = hostDouble('/api/v1/y');
    filter.catch(
      new Error('secret internal detail: postgres://user:pw@host'),
      h.host,
    );

    expect(h.statusCode()).toBe(500);
    const body = h.body();
    expect(body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
      path: '/api/v1/y',
    });
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });
});

/**
 * What-if simulator API client — POST /api/v1/what-if/excise (task 8.2).
 *
 * Typed fetch plus error classification for the states the UI renders
 * distinctly, following the {@link classifyTripCalcError} precedent.
 * The endpoint sits behind the `EXCISE_WHAT_IF` gate, so a flag flipped
 * off server-side mid-session reaches the client as 403 and must
 * degrade to a friendly "not available" message, never a crash
 * (design R13).
 *
 * Uses the low-level {@link apiFetch} instead of `request()` — the same
 * escape hatch the report exporter uses — for one reason: the
 * CALCULATOR limiter (10/min) answers 429 with a `Retry-After` header
 * that `ApiFetchError` does not carry, and the slider's throttle notice
 * renders a countdown from it. The endpoint is anonymous (no session,
 * no age gate), so the cookie/credentials path `request()` adds is not
 * needed.
 *
 * @module WhatIfClient
 */

import { apiFetch, ApiFetchError } from '@/lib/api';
import type { ApiError } from '@/lib/types';
import type { WhatIfResponse, WhatIfScenarioRequest } from './what-if.types';

/** Used when a 429 arrives without a parseable Retry-After: the limiter's window is one minute. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** A 429 with its Retry-After figure, for the throttle notice's countdown. */
export class WhatIfRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('what-if rate limit exceeded');
    this.name = 'WhatIfRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Parse a Retry-After value. The limiter always sends integer seconds;
 * an HTTP-date form or a missing/invalid value falls back to the
 * one-minute window.
 */
export function parseRetryAfterSeconds(raw: string | null): number {
  if (raw === null || raw.trim() === '') {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classified failure modes of {@link calculateWhatIfExcise}:
 * - `validation`     — 400: out-of-bounds scenario or malformed input
 * - `forbidden`      — 403: EXCISE_WHAT_IF flag off server-side
 * - `rate-limited`   — 429: CALCULATOR limiter tripped (carries retry seconds)
 * - `network`        — fetch itself failed (no HTTP response)
 * - `unknown`        — any other error
 */
export type WhatIfErrorKind =
  | 'validation'
  | 'forbidden'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/**
 * Classify an error thrown by {@link calculateWhatIfExcise} into a typed
 * kind. Never throws. The rate-limited kind carries the Retry-After
 * figure the countdown renders.
 */
export function classifyWhatIfError(err: unknown): {
  kind: WhatIfErrorKind;
  retryAfterSeconds: number | null;
} {
  if (err instanceof WhatIfRateLimitError) {
    return { kind: 'rate-limited', retryAfterSeconds: err.retryAfterSeconds };
  }
  if (err instanceof ApiFetchError) {
    if (err.status === 400) return { kind: 'validation', retryAfterSeconds: null };
    if (err.status === 403) return { kind: 'forbidden', retryAfterSeconds: null };
    if (err.status === 429) {
      return { kind: 'rate-limited', retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS };
    }
    return { kind: 'unknown', retryAfterSeconds: null };
  }
  return { kind: 'network', retryAfterSeconds: null };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Recompute the scenario through the pure what-if endpoint. The 200 body
 * always carries the structural HYPOTHETICAL disclaimer and the share
 * token for the inputs.
 *
 * @throws {@link WhatIfRateLimitError} on 429 (with Retry-After seconds)
 * @throws {@link ApiFetchError} on any other non-2xx — use
 *         {@link classifyWhatIfError} to render the right treatment.
 */
export async function calculateWhatIfExcise(
  input: WhatIfScenarioRequest,
  signal?: AbortSignal,
): Promise<WhatIfResponse> {
  let res: Response;
  try {
    res = await apiFetch('/api/v1/what-if/excise', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
  } catch (err: unknown) {
    // An aborted fetch is a superseded request, not a network failure —
    // rethrow so the latest-wins guard can ignore it silently. Everything
    // else rethrows untranslated: classifyWhatIfError maps a fetch-level
    // rejection (no HTTP response) to the network kind, and an
    // already-classified ApiFetchError keeps its status.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw err;
  }

  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // ignore parse failure
    }
    if (res.status === 429) {
      throw new WhatIfRateLimitError(
        parseRetryAfterSeconds(res.headers.get('Retry-After')),
      );
    }
    throw new ApiFetchError(res.status, body, res.headers.get('x-request-id'));
  }

  return (await res.json()) as WhatIfResponse;
}

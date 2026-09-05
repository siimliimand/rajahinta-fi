/**
 * What-if page constants.
 *
 * Lives outside `page.tsx` because the App Router restricts a page
 * module's exports to Next's Page fields — a bare constant export
 * fails `next build` type validation.
 *
 * @module WhatIfConstants
 */

/**
 * Real-time recalculation vs the CALCULATOR rate limit (10/min) — the
 * deliberate reconciliation (task 8.3):
 *
 *   TRAILING-EDGE DEBOUNCE + EXPLICIT PENDING STATE. The client cannot
 *   interpolate between server results: the baseline excise is resolved
 *   server-side from the active rate dataset, so any client-side
 *   interpolation would reimplement rule resolution and break the
 *   explainability of every figure. Instead the form's edits coalesce —
 *   at most one request per {@link RECALCULATION_DEBOUNCE_MS} of quiet —
 *   and a visible pending line covers both the debounce window and the
 *   in-flight request. The first computation (mount, share-token
 *   prefill) runs immediately; updates to an existing result are
 *   debounced.
 *
 *   429 (CALCULATOR tripped) is a first-class state: the Retry-After
 *   figure drives a visible countdown, no request is sent while it
 *   runs, and when it reaches zero the latest draft is recomputed once
 *   automatically — the stale result never lingers silently and the
 *   user never has to guess when retrying is allowed.
 */
export const RECALCULATION_DEBOUNCE_MS = 800;

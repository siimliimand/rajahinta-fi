/**
 * Embed widget route (task 8.3) — GET /[locale]/what-if/embed?token=…
 *
 * A ROUTE HANDLER, not a page: the [locale] root layout wraps every page
 * in the site chrome, and the embeddable widget must be a self-contained
 * minimal view with no site chrome, suitable for iframe embedding.
 *
 * Flow (spec: excise-what-if-simulator — shareable embed, rate limiting,
 * anonymous access):
 *   1. `EXCISE_WHAT_IF` is checked server-resolved (the same inlined
 *      flag source the layout uses) — flag off renders the closed view.
 *   2. The share token is decoded READ-ONLY against the same bounds the
 *      POST endpoint enforces. There is no scenario storage anywhere —
 *      the token carries the inputs and nothing else.
 *   3. The scenario is RECOMPUTED through the pure what-if endpoint (the
 *      computation itself is ephemeral by design — 8.2). A 429 renders
 *      a calm throttled view whose meta-refresh waits out the limiter's
 *      Retry-After; any other failure renders the unavailable view.
 *   4. The document renders the structural HYPOTHETICAL disclaimer from
 *      the response prominently — the disclaimer travels with the result
 *      even in the embedded rendering.
 *
 * The recompute runs server-side (one origin, no CORS, works without
 * JS in the iframe); embed views are share-landings, so their low
 * frequency keeps the shared per-IP limiter bucket a non-issue — the
 * high-frequency interactive path (the slider) runs per-visitor in the
 * browser on the main page.
 *
 * @module WhatIfEmbedRoute
 */

import { routing } from '@/i18n/routing';
import { getServerFeatureFlags } from '@/lib/api';
import { isWhatIfFlagEnabled } from '../what-if-flag';
import { decodeWhatIfShareToken } from '../share-token';
import { calculateWhatIfExcise, classifyWhatIfError } from '../what-if.client';
import { renderEmbedHtml, type EmbedLocale, type EmbedOutcome } from './view';

export const dynamic = 'force-dynamic';

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale: rawLocale } = await params;
  // Mirror the layout's locale validation — unknown segments are not
  // pages, so they are not embeds either.
  if (!(routing.locales as readonly string[]).includes(rawLocale)) {
    return new Response('Not found', { status: 404 });
  }
  const locale = rawLocale as EmbedLocale;

  // Flag gate — the same server-resolved payload the layout inlines
  // (revalidate-bounded; a flipped-off flag closes the embed within it).
  const flags = await getServerFeatureFlags();
  if (!isWhatIfFlagEnabled(flags)) {
    return htmlResponse(renderEmbedHtml(locale, { kind: 'closed' }));
  }

  // Read-only decode of the share token.
  const token = new URL(request.url).searchParams.get('token');
  if (token === null) {
    return htmlResponse(renderEmbedHtml(locale, { kind: 'invalid' }));
  }
  let outcome: EmbedOutcome;
  try {
    const scenario = decodeWhatIfShareToken(token);
    // Recompute through the pure endpoint — nothing is stored anywhere.
    outcome = { kind: 'result', result: await calculateWhatIfExcise(scenario) };
  } catch (err: unknown) {
    const { kind, retryAfterSeconds } = classifyWhatIfError(err);
    if (kind === 'rate-limited') {
      outcome = { kind: 'throttled', retryAfterSeconds: retryAfterSeconds ?? 60 };
    } else if (err instanceof Error && err.name === 'WhatIfShareTokenError') {
      outcome = { kind: 'invalid' };
    } else {
      outcome = { kind: 'unavailable' };
    }
  }
  return htmlResponse(renderEmbedHtml(locale, outcome));
}

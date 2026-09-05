/**
 * Embed widget HTML view (task 8.3) — pure rendering, no I/O.
 *
 * The embed is a ROUTE HANDLER, not a page: the [locale] root layout
 * wraps every page in the site chrome (header, age gate, footer), and a
 * route handler is the only way to emit a truly chrome-less document —
 * a self-contained minimal view suitable for iframe embedding.
 *
 * READ-ONLY by spec: this module never writes anything — it renders the
 * outcome the route handler produced (flag closed / invalid token /
 * recompute result). The result variant renders the structural
 * HYPOTHETICAL disclaimer from the API response prominently at the
 * top — it travels with the result even in the embedded rendering
 * (spec: disclaimer travels with the result).
 *
 * Copy comes from the SAME message catalogs the pages use (fi/en full
 * parity, enforced by the catalog tests); the lookup is a plain dotted
 * path with {param} interpolation because route handlers have no React
 * context. Values are interpolated first and the finished string is
 * escaped, so user-derived text (product ids, dataset versions) can
 * never break out of the document.
 *
 * @module WhatIfEmbedView
 */

import en from '@/messages/en.json';
import fi from '@/messages/fi.json';
import { SITE_URL } from '@/lib/api';
import type { WhatIfResponse } from '../what-if.types';

export type EmbedLocale = 'fi' | 'en';

const CATALOGS: Record<EmbedLocale, unknown> = { fi, en };

/** One outcome the route handler can render. */
export type EmbedOutcome =
  | { readonly kind: 'closed' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'throttled'; readonly retryAfterSeconds: number }
  | { readonly kind: 'result'; readonly result: WhatIfResponse };

/** Dotted-path lookup into the locale catalogs; falls back to the key. */
export function embedMessage(locale: EmbedLocale, key: string): string {
  let node: unknown = CATALOGS[locale];
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in (node as Record<string, unknown>))) {
      return key;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}

/** {@link embedMessage} with `{name}` interpolation, then HTML-escaped. */
export function embedMessageHtml(locale: EmbedLocale, key: string, params?: Record<string, string | number>): string {
  let text = embedMessage(locale, key);
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return escapeHtml(text);
}

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cents → euro string — the same formatting convention as the pages. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Signed euro string — the payload's gap sign convention stays visible. */
function formatSignedEur(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${formatEur(Math.abs(cents))}`;
}

// ---------------------------------------------------------------------------
// Outcome bodies
// ---------------------------------------------------------------------------

function noticeBody(locale: EmbedLocale, titleKey: string, bodyKey: string, params?: Record<string, string | number>): string {
  return [
    `<h1>${embedMessageHtml(locale, titleKey)}</h1>`,
    `<p class="wi-meta">${embedMessageHtml(locale, bodyKey, params)}</p>`,
  ].join('\n');
}

function resultBody(locale: EmbedLocale, result: WhatIfResponse): string {
  const m = (key: string, params?: Record<string, string | number>) =>
    embedMessageHtml(locale, `WhatIfPage.${key}`, params);

  const totalsRows = [
    ['result.totalsBaselineExcise', formatEur(result.totals.baselineExciseCents)],
    ['result.totalsHypotheticalExcise', formatEur(result.totals.hypotheticalExciseCents)],
    ['result.totalsGapBaseline', formatSignedEur(result.totals.gapBaselineCents)],
    ['result.totalsGapHypothetical', formatSignedEur(result.totals.gapHypotheticalCents)],
  ]
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${m(key)}</th><td class="num">${value}</td></tr>`,
    )
    .join('\n');

  const lineRows = result.lines
    .map((line) => {
      const provenance = `${m(`category.${line.category}`)} · ${escapeHtml(
        line.baseline.taxDatasetVersion,
      )}`;
      return [
        '<tr>',
        `<td>${escapeHtml(line.id)}<br><small>${provenance}</small></td>`,
        `<td class="num">${formatEur(line.importTotalBaselineCents)}<br><small>${formatSignedEur(
          line.gapBaselineCents,
        )}</small></td>`,
        `<td class="num">${formatEur(line.importTotalHypotheticalCents)}<br><small>${formatSignedEur(
          line.gapHypotheticalCents,
        )}</small></td>`,
        `<td class="num"><strong>${formatSignedEur(line.gapDeltaCents)}</strong></td>`,
        '</tr>',
      ].join('\n');
    })
    .join('\n');

  return [
    `<h1>${m('result.heading')}</h1>`,
    `<div class="wi-disclaimer" role="note">${escapeHtml(result.disclaimer.text)}<br><small>v${escapeHtml(
      result.disclaimer.version,
    )} · ${embedMessageHtml(locale, `DisclaimerBanner.languageName.${result.disclaimer.language}`)}</small></div>`,
    `<p class="wi-meta">${m('result.scenarioRate', { rate: String(result.hypotheticalRate) })} · ${m(
      'result.scenarioBaselineVersion',
      { version: result.baselineTaxDatasetVersion },
    )}</p>`,
    `<h2>${m('result.totalsHeading')}</h2>`,
    '<table><tbody>',
    totalsRows,
    '</tbody></table>',
    `<h2>${m('result.linesHeading')}</h2>`,
    '<table>',
    '<thead><tr>',
    `<th scope="col">${m('result.columnProduct')}</th>`,
    `<th scope="col" class="num">${m('result.columnBaseline')}</th>`,
    `<th scope="col" class="num">${m('result.columnHypothetical')}</th>`,
    `<th scope="col" class="num">${m('result.columnDelta')}</th>`,
    '</tr></thead>',
    '<tbody>',
    lineRows,
    '</tbody></table>',
    `<p class="wi-legend">${m('result.gapLegend')}</p>`,
    `<p class="wi-source"><a href="${SITE_URL}" target="_blank" rel="noopener">rajahinta.fi</a></p>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/** Minimal inline stylesheet — token-adjacent grays, no external assets. */
const EMBED_CSS = [
  ':root { color-scheme: light; }',
  '* { box-sizing: border-box; }',
  'body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;',
  '  font-size: 14px; line-height: 1.5; color: #111827; background: #ffffff; }',
  'h1 { font-size: 16px; margin: 0 0 8px; }',
  'h2 { font-size: 14px; margin: 16px 0 6px; }',
  '.wi-disclaimer { border: 1px solid #b45309; background: #fef3c7; color: #78350f;',
  '  border-radius: 6px; padding: 10px 12px; margin: 0 0 12px; font-weight: 500; }',
  '.wi-disclaimer small { font-weight: 400; }',
  'table { width: 100%; border-collapse: collapse; margin: 6px 0; }',
  'th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }',
  'th { font-weight: 500; font-size: 12px; color: #374151; }',
  'td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }',
  'small { color: #6b7280; font-size: 11px; }',
  '.wi-meta { color: #6b7280; font-size: 12px; margin: 4px 0 10px; }',
  '.wi-legend { color: #6b7280; font-size: 11px; margin-top: 10px; }',
  '.wi-source { margin-top: 14px; font-size: 12px; }',
  '.wi-source a { color: #4b5563; }',
].join(' ');

/** Render the self-contained embed document for an outcome. */
export function renderEmbedHtml(locale: EmbedLocale, outcome: EmbedOutcome): string {
  let body: string;
  let refresh = '';
  switch (outcome.kind) {
    case 'closed':
      body = noticeBody(locale, 'WhatIfPage.embed.closedTitle', 'WhatIfPage.embed.closedBody');
      break;
    case 'invalid':
      body = noticeBody(locale, 'WhatIfPage.embed.invalidTitle', 'WhatIfPage.embed.invalidBody');
      break;
    case 'unavailable':
      body = noticeBody(
        locale,
        'WhatIfPage.embed.unavailableTitle',
        'WhatIfPage.embed.unavailableBody',
      );
      break;
    case 'throttled': {
      // The limiter's window is per minute; clamp the meta-refresh to a
      // sane range so a pathological header can never pin the iframe.
      const seconds = Math.min(300, Math.max(1, Math.round(outcome.retryAfterSeconds)));
      refresh = `<meta http-equiv="refresh" content="${seconds}">`;
      body = noticeBody(
        locale,
        'WhatIfPage.embed.throttledTitle',
        'WhatIfPage.embed.throttledBody',
        { seconds },
      );
      break;
    }
    case 'result':
      body = resultBody(locale, outcome.result);
      break;
  }

  return [
    '<!DOCTYPE html>',
    `<html lang="${locale}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    ...(refresh !== '' ? [refresh] : []),
    `<title>${embedMessageHtml(locale, 'WhatIfPage.embed.title')}</title>`,
    `<style>${EMBED_CSS}</style>`,
    '</head>',
    '<body data-embed="what-if">',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

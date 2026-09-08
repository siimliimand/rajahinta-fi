/**
 * Embed calculator view (task 6.3) — pure rendering, no I/O.
 *
 * The embed is a ROUTE HANDLER, not a page: the [locale] root layout
 * wraps every page in the site chrome (header, footer), and a route
 * handler is the only way to emit a truly chrome-less document — a
 * self-contained minimal view suitable for iframe embedding (the
 * what-if/embed precedent, task 8.3).
 *
 * The widget is interactive but works WITHOUT JavaScript: every state is
 * a server-rendered document and the search → quantity → calculate flow
 * advances through plain GET forms. Each submission is re-handled by the
 * route handler, which calls the SAME API endpoints the main calculator
 * page uses, so the API's age gate, rate limits, and idempotency apply
 * unchanged (spec: embed is not a calculation bypass).
 *
 * The age gate is structural: the route renders the gate prompt whenever
 * no confirmation token is available, and the token travels as the
 * `x-age-confirmed` header on every API call the route makes — the same
 * cookie/header pair the main app presents (age-gate.guard.ts).
 *
 * Copy comes from the SAME message catalogs the pages use (fi/en full
 * parity, enforced by the catalog tests) via a dotted-path lookup, plus
 * a small inline catalog for embed-only strings — no messages-file
 * changes are needed. Values are interpolated first and the finished
 * string is escaped, so user-derived text (search queries, product
 * names) can never break out of the document.
 *
 * @module EmbedCalculatorView
 */

import en from '@/messages/en.json';
import fi from '@/messages/fi.json';
import { SITE_URL } from '@/lib/api';
import type { CalculatorResult, ProductSearchItem } from '@/lib/types';

export type EmbedLocale = 'fi' | 'en';

const CATALOGS: Record<EmbedLocale, unknown> = { fi, en };

/** Quantity bounds — the same clamp the page's QuantitySelector applies. */
export const EMBED_MIN_QUANTITY = 1;
export const EMBED_MAX_QUANTITY = 99;

/** Minimum query length before a search fires — mirrors the main page. */
export const EMBED_MIN_QUERY_LENGTH = 2;

/**
 * Embed-only copy. Everything that already exists in the shared catalogs
 * is looked up there; these strings have no page equivalent because the
 * embed adds states the in-app flow never renders (standalone throttle /
 * unavailability notices, the restart link).
 */
const EMBED_COPY: Record<EmbedLocale, Record<string, string>> = {
  fi: {
    'embed.documentTitleSuffix': ' · rajahinta.fi',
    'embed.throttledTitle': 'Odota hetki',
    'embed.throttledBody':
      'Laskenta on rajattu odotusajalla. Yritä uudelleen {seconds} sekunnin kuluttua.',
    'embed.retry': 'Yritä uudelleen',
    'embed.unavailableTitle': 'Laskelma ei ole nyt saatavilla',
    'embed.unavailableBody':
      'Palvelu ei vastannut odotetusti. Yritä hetken kuluttua uudelleen.',
    'embed.newCalculation': 'Uusi laskenta',
  },
  en: {
    'embed.documentTitleSuffix': ' · rajahinta.fi',
    'embed.throttledTitle': 'Please wait',
    'embed.throttledBody':
      'The calculation is rate-limited right now. Try again in {seconds} seconds.',
    'embed.retry': 'Try again',
    'embed.unavailableTitle': 'The calculation is not available right now',
    'embed.unavailableBody':
      'The service did not respond as expected. Please try again in a moment.',
    'embed.newCalculation': 'New calculation',
  },
};

/** One state the route handler can render. */
export type EmbedOutcome =
  | { readonly kind: 'age-gate' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'search'; readonly query: string; readonly items: readonly ProductSearchItem[] }
  | { readonly kind: 'no-results'; readonly query: string }
  | { readonly kind: 'result'; readonly result: CalculatorResult }
  | {
      readonly kind: 'throttled';
      readonly retryAfterSeconds: number;
      /** Same-origin retry target (path + query of the rejected request). */
      readonly retryPath: string;
    }
  | { readonly kind: 'unavailable' };

/** Dotted-path lookup into the locale catalogs; falls back to the key. */
export function embedMessage(locale: EmbedLocale, key: string): string {
  // Embed-only copy first, then the shared page catalogs.
  const inline = EMBED_COPY[locale][key];
  if (inline !== undefined) return inline;
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

/** Country display name for a destination code, falling back to the code. */
function countryName(locale: EmbedLocale, code: string): string {
  const name = embedMessage(locale, `Common.countries.${code}`);
  return name === `Common.countries.${code}` ? code : name;
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/**
 * Hidden field that carries the gate attestation through subsequent form
 * submissions. Normally the `age_confirmed` cookie set on confirm does
 * this; the field keeps the attestation alive inside iframes where the
 * browser partitions or blocks third-party cookies. It never fabricates
 * a confirmation — the value only exists after the gate was answered.
 */
const CONFIRM_FIELD = '<input type="hidden" name="confirm" value="1">';

/** The search form — plain GET, works without JavaScript. */
function searchForm(locale: EmbedLocale, query: string): string {
  return [
    '<form method="get" class="ec-search">',
    CONFIRM_FIELD,
    `<label class="ec-label" for="ec-q">${embedMessageHtml(locale, 'ProductSearch.placeholder')}</label>`,
    `<input id="ec-q" type="search" name="q" value="${escapeHtml(query)}" minlength="${EMBED_MIN_QUERY_LENGTH}" autocomplete="off">`,
    `<button type="submit">${embedMessageHtml(locale, 'ProductSearch.search')}</button>`,
    '</form>',
  ].join('\n');
}

/** Quantity + calculate form for one search result. */
function resultForm(locale: EmbedLocale, item: ProductSearchItem): string {
  const range = embedMessageHtml(locale, 'QuantitySelector.range', {
    max: EMBED_MAX_QUANTITY,
  });
  const facts = [
    escapeHtml(item.brand),
    escapeHtml(item.category),
    item.alcoholByVolume !== null
      ? embedMessageHtml(locale, 'Common.abvValue', {
          value: item.alcoholByVolume,
        })
      : null,
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
  return [
    '<li class="ec-product">',
    `<form method="get">`,
    CONFIRM_FIELD,
    `<input type="hidden" name="product" value="${item.id}">`,
    `<span class="ec-product-name">${escapeHtml(item.name)}</span>`,
    `<small>${facts}</small>`,
    `<label class="ec-label" for="ec-qty-${item.id}">${embedMessageHtml(locale, 'QuantitySelector.label')} ${range}</label>`,
    `<input id="ec-qty-${item.id}" type="number" name="quantity" value="${EMBED_MIN_QUANTITY}" min="${EMBED_MIN_QUANTITY}" max="${EMBED_MAX_QUANTITY}" step="1">`,
    `<button type="submit">${embedMessageHtml(locale, 'Calculator.calculate')}</button>`,
    '</form>',
    '</li>',
  ].join('\n');
}

function sourceLink(): string {
  return `<p class="ec-source"><a href="${SITE_URL}" target="_blank" rel="noopener">rajahinta.fi</a></p>`;
}

// ---------------------------------------------------------------------------
// Outcome bodies
// ---------------------------------------------------------------------------

function ageGateBody(locale: EmbedLocale): string {
  return [
    `<h1>${embedMessageHtml(locale, 'AgeGate.title')}</h1>`,
    `<p>${embedMessageHtml(locale, 'AgeGate.body')}</p>`,
    '<div class="ec-actions">',
    `<a class="ec-button" href="?confirm=1">${embedMessageHtml(locale, 'AgeGate.confirm')}</a>`,
    `<a class="ec-button ec-secondary" href="?declined=1">${embedMessageHtml(locale, 'AgeGate.deny')}</a>`,
    '</div>',
    `<p class="ec-note"><small>${embedMessageHtml(locale, 'AgeGate.note')}</small></p>`,
  ].join('\n');
}

function declinedBody(locale: EmbedLocale): string {
  return [
    `<h1>${embedMessageHtml(locale, 'AgeGateDeclined.title')}</h1>`,
    `<p>${embedMessageHtml(locale, 'AgeGateDeclined.body')}</p>`,
    sourceLink(),
  ].join('\n');
}

function searchBody(locale: EmbedLocale, query: string, items: readonly ProductSearchItem[]): string {
  return [
    `<h1>${embedMessageHtml(locale, 'Calculator.title')}</h1>`,
    `<p class="ec-meta">${embedMessageHtml(locale, 'Calculator.subtitle')}</p>`,
    searchForm(locale, query),
    // The results section only exists once a search actually ran.
    ...(items.length > 0
      ? [
          `<h2>${embedMessageHtml(locale, 'Calculator.searchResults')}</h2>`,
          '<ul class="ec-products">',
          items.map((item) => resultForm(locale, item)).join('\n'),
          '</ul>',
        ]
      : []),
    sourceLink(),
  ].join('\n');
}

function noResultsBody(locale: EmbedLocale, query: string): string {
  return [
    `<h1>${embedMessageHtml(locale, 'Calculator.title')}</h1>`,
    searchForm(locale, query),
    `<h2>${embedMessageHtml(locale, 'Calculator.searchNoResultsTitle')}</h2>`,
    `<p class="ec-meta">${embedMessageHtml(locale, 'Calculator.searchNoResultsDescription', { query })}</p>`,
    sourceLink(),
  ].join('\n');
}

function resultBody(locale: EmbedLocale, result: CalculatorResult): string {
  const m = (key: string, params?: Record<string, string | number>) =>
    embedMessageHtml(locale, key, params);

  const destination = result.metadata.input.destination;
  const costRows = result.itemizedCosts
    .map(
      (cost) =>
        `<tr><th scope="row">${m(`CalculatorResult.category.${cost.category}`)}<br><small>${m(
          `Common.reliability.${cost.reliability}`,
        )}</small></th><td class="num">${formatEur(cost.cents)}</td></tr>`,
    )
    .join('\n');

  return [
    `<h1>${escapeHtml(result.metadata.productName)}</h1>`,
    `<p class="ec-meta">${result.metadata.quantity} × ${escapeHtml(countryName(locale, destination))} · ${m(
      `Common.confidence.${result.confidence}`,
    )}</p>`,
    // The structural disclaimer travels with the result and stays
    // prominent above the figures (spec: disclaimers intact in the embed).
    `<div class="ec-disclaimer" role="note">${escapeHtml(result.disclaimer.text)}<br><small>v${escapeHtml(
      result.disclaimer.version,
    )} · ${m(`DisclaimerBanner.languageName.${result.disclaimer.language}`)}</small></div>`,
    '<table><tbody>',
    costRows,
    `<tr><th scope="row">${m('CalculatorResult.total')}</th><td class="num"><strong>${formatEur(
      result.totalCents,
    )}</strong></td></tr>`,
    '</tbody></table>',
    `<p class="ec-meta">${m('CalculatorResult.taxRateDataset', {
      versions: result.metadata.datasetVersions.join(', '),
    })}</p>`,
    `<p class="ec-restart"><a href="?confirm=1">${m('embed.newCalculation')}</a></p>`,
    sourceLink(),
  ].join('\n');
}

function throttledBody(locale: EmbedLocale, seconds: number, retryPath: string): string {
  return [
    `<h1>${embedMessageHtml(locale, 'embed.throttledTitle')}</h1>`,
    `<p class="ec-meta">${embedMessageHtml(locale, 'embed.throttledBody', { seconds })}</p>`,
    `<p><a class="ec-button" href="${escapeHtml(retryPath)}">${embedMessageHtml(locale, 'embed.retry')}</a></p>`,
  ].join('\n');
}

function unavailableBody(locale: EmbedLocale): string {
  return [
    `<h1>${embedMessageHtml(locale, 'embed.unavailableTitle')}</h1>`,
    `<p class="ec-meta">${embedMessageHtml(locale, 'embed.unavailableBody')}</p>`,
    sourceLink(),
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
  'p { margin: 6px 0; }',
  '.ec-meta { color: #6b7280; font-size: 12px; margin: 4px 0 10px; }',
  '.ec-note { color: #6b7280; font-size: 11px; margin-top: 10px; }',
  '.ec-disclaimer { border: 1px solid #b45309; background: #fef3c7; color: #78350f;',
  '  border-radius: 6px; padding: 10px 12px; margin: 0 0 12px; font-weight: 500; }',
  '.ec-disclaimer small { font-weight: 400; }',
  'form { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin: 8px 0; }',
  '.ec-label { display: block; font-size: 11px; color: #374151; }',
  'input[type="search"], input[type="number"] { padding: 7px 9px; border: 1px solid #d1d5db;',
  '  border-radius: 6px; font: inherit; }',
  'input[type="number"] { width: 5.5em; }',
  'button, .ec-button { display: inline-block; padding: 7px 12px; border: 0; border-radius: 6px;',
  '  background: #4d7c0f; color: #ffffff; font: inherit; font-size: 13px; font-weight: 500;',
  '  text-decoration: none; cursor: pointer; }',
  '.ec-secondary { background: #e5e7eb; color: #374151; }',
  'ul.ec-products { list-style: none; margin: 0; padding: 0; }',
  'li.ec-product { border-bottom: 1px solid #e5e7eb; padding: 8px 0; }',
  '.ec-product-name { display: block; font-weight: 500; }',
  'li.ec-product small { display: block; color: #6b7280; font-size: 11px; margin-bottom: 4px; }',
  'table { width: 100%; border-collapse: collapse; margin: 6px 0; }',
  'th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }',
  'th { font-weight: 500; font-size: 12px; color: #374151; }',
  'td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }',
  'small { color: #6b7280; font-size: 11px; }',
  '.ec-restart { margin-top: 12px; font-size: 12px; }',
  '.ec-restart a { color: #4b5563; }',
  '.ec-source { margin-top: 14px; font-size: 12px; }',
  '.ec-source a { color: #4b5563; }',
].join(' ');

/** Render the self-contained embed document for an outcome. */
export function renderEmbedCalculatorHtml(locale: EmbedLocale, outcome: EmbedOutcome): string {
  let body: string;
  switch (outcome.kind) {
    case 'age-gate':
      body = ageGateBody(locale);
      break;
    case 'declined':
      body = declinedBody(locale);
      break;
    case 'search':
      body = searchBody(locale, outcome.query, outcome.items);
      break;
    case 'no-results':
      body = noResultsBody(locale, outcome.query);
      break;
    case 'result':
      body = resultBody(locale, outcome.result);
      break;
    case 'throttled': {
      // The limiter's window is per minute; clamp to a sane range so a
      // pathological figure can never misstate the wait. A manual retry
      // link (not a meta refresh) keeps a throttled iframe from
      // re-submitting the same request in a loop.
      const seconds = Math.min(300, Math.max(1, Math.round(outcome.retryAfterSeconds)));
      body = throttledBody(locale, seconds, outcome.retryPath);
      break;
    }
    case 'unavailable':
      body = unavailableBody(locale);
      break;
  }

  return [
    '<!DOCTYPE html>',
    `<html lang="${locale}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${embedMessageHtml(locale, 'Calculator.title')}${embedMessageHtml(locale, 'embed.documentTitleSuffix')}</title>`,
    `<style>${EMBED_CSS}</style>`,
    '</head>',
    '<body data-embed="calculator">',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

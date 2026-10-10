/**
 * Preference-digest email builder (task 4.3, change
 * add-onboarding-preferences; design D3) — renders the weekly factual
 * digest mail from the core-domain digest facts (task 4.1). Rendering
 * only: the builder computes nothing, sorts nothing, persists nothing —
 * facts arrive already computed and ordered (category asc, price asc)
 * and are echoed verbatim in input order.
 *
 * ## Locale handling
 *
 * Per-call `locale` (`'fi' | 'en'`), the same vocabulary
 * `resolveNewsletterLocale` accepts. FI is the site's primary language
 * and the copy is written FI-first; EN is the secondary rendering. The
 * account model stores no locale (design D2, minimal fields), so the
 * digest cron passes the deployment's locale until a per-account choice
 * exists.
 *
 * ## Copy rules (design D3 — non-negotiable)
 *
 * Factual sentences only: the category's minimum shelf price and the
 * notable new low, each citing product and merchant and the day the
 * bucket was observed. No promotional vocabulary, no urgency, no
 * exclamation-mark marketing voice. The compliance suite (task 6.1,
 * `tests/compliance/preference-digest-neutrality.test.ts`) runs
 * `isCompliant()` over rendered copy in CI; the builder's own tests
 * mirror that check over fixture facts.
 *
 * ## Footer
 *
 * Every digest links the `/onboarding` preferences editor, where digest
 * consent and followed categories are changed. The absolute URL is a
 * required input (the caller composes it from the frontend origin, the
 * same trade as the newsletter builders' confirm/unsubscribe URLs) and
 * an empty URL is rejected, so a digest without the consent-change link
 * cannot be rendered by accident (the newsletter builders' reject-empty
 * pattern).
 *
 * Category labels mirror the established FI/EN vocabulary of
 * `apps/frontend/src/app/[locale]/products/category-labels.ts` as a
 * local constant — this module stays dependency-free (no frontend, no
 * Hono, no env types) so the digest cron can import the builder without
 * dragging either application in (the templates.ts trade). The label
 * record is exhaustive over `DigestCategory`, so a category added to
 * the canonical set fails this module's typecheck until labeled.
 *
 * @module preference-digest-email
 */

import type { DigestCategory, DigestFact } from '../../../packages/core-domain/src/digest/digest.types';
import { escapeHtml } from './templates';

/** Locales the digest renders (the newsletter locales). */
export type DigestEmailLocale = 'fi' | 'en';

/** Rendered mail body the email Worker send contract accepts (`to` is the caller's to add). */
export interface PreferenceDigestEmailBody {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Input of the digest rendering — the week key plus the computed facts. */
export interface PreferenceDigestEmailInput {
  /** The ISO calendar-week key the digest covers, e.g. `2026-W41` (design D5). */
  readonly week: string;
  /** The computed, ordered facts — echoed verbatim, never re-sorted. */
  readonly facts: readonly DigestFact[];
  /** Rendering locale; FI is the primary copy, EN the secondary. */
  readonly locale: DigestEmailLocale;
  /** Absolute `/onboarding` preferences-editor URL (the consent-change link). */
  readonly onboardingUrl: string;
}

/** Strip trailing CR/LF from every interpolated line value (header-injection hygiene, as in templates.ts). */
function sanitizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Strip line breaks + trim — the send contract rejects subjects carrying line breaks. */
function sanitizeSubject(value: string): string {
  return sanitizeLine(value);
}

/** Strip line breaks + trim + cap — merchant names are user-facing data. */
function sanitizeMerchant(merchant: string): string {
  return sanitizeLine(merchant).slice(0, 100);
}

/** Euro cents → `12,34 €` — the Finnish convention the FI copy uses. */
function euroFi(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** Euro cents → `€12.34` — the same label the alert email bodies use. */
function euroEn(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * The established FI/EN category labels — mirrors
 * `CATEGORY_LABELS` in apps/frontend category-labels.ts verbatim so the
 * same canonical value carries the same label in the mail as on the
 * site. Exhaustive over the canonical set by construction.
 */
const CATEGORY_LABELS: Record<DigestCategory, Record<DigestEmailLocale, string>> = {
  beer: { fi: 'Olut', en: 'Beer' },
  wine_still: { fi: 'Makuuviini', en: 'Still wine' },
  wine_sparkling: { fi: 'Kuohuviini', en: 'Sparkling wine' },
  intermediate_products: {
    fi: 'Välituotteet (esim. vermutti)',
    en: 'Intermediate products (e.g. vermouth)',
  },
  other_fermented: { fi: 'Siideri ja pitkäjuoma', en: 'Cider and long drink' },
  spirits: { fi: 'Väkevät alkoholijuomat', en: 'Spirits' },
};

/** Localized per-locale copy fragments (factual phrasing only). */
const COPY: Record<
  DigestEmailLocale,
  {
    greeting: string;
    intro: (week: string) => string;
    minimum: (label: string, week: string, price: string, citation: string, day: string) => string;
    newLow: (label: string, price: string, citation: string, day: string) => string;
    dataStatement: string;
    footer: (url: string) => string;
    footerLinkLabel: string;
    signOff: string;
    subject: (week: string) => string;
  }
> = {
  fi: {
    greeting: 'Hei!',
    intro: (week) => `Viikon ${week} hintakatsaus seuratuillesi kategorioille.`,
    minimum: (label, week, price, citation, day) =>
      `${label}: alin hinta viikolla ${week} ${price} (${citation}), havaittu ${day}.`,
    newLow: (label, price, citation, day) =>
      `${label}: uusi alin hinta ${price} (${citation}), havaittu ${day}.`,
    dataStatement:
      'Hinnat ovat toteutuneita hyllyhintoja materialisoiduista päiväyhteenvedoista, eivät reaaliaikaisia hintoja.',
    footer: (url) =>
      `Voit muuttaa seurattavia kategorioitasi tai digisuostumuksesi osoitteessa: ${url}`,
    footerLinkLabel: 'Asetukset ja digisuostumus',
    signOff: '— rajahinta.fi',
    subject: (week) => `[rajahinta] Viikon ${week} hintakatsaus`,
  },
  en: {
    greeting: 'Hello!',
    intro: (week) => `Price digest for week ${week}, your followed categories.`,
    minimum: (label, week, price, citation, day) =>
      `${label}: minimum shelf price in week ${week} ${price} (${citation}), observed ${day}.`,
    newLow: (label, price, citation, day) =>
      `${label}: new minimum shelf price ${price} (${citation}), observed ${day}.`,
    dataStatement:
      'The prices are realized shelf prices from materialized daily summaries, not live quotes.',
    footer: (url) =>
      `You can change your followed categories or digest consent at: ${url}`,
    footerLinkLabel: 'Preferences and digest consent',
    signOff: '— rajahinta.fi',
    subject: (week) => `[rajahinta] Price digest, week ${week}`,
  },
};

/**
 * The fact's product + merchant citation. `DigestFact` carries the
 * product id (no product name field exists on the summary-derived
 * fact), so the citation is `Tuote #<id>` / `Product #<id>` — the alert
 * builders' null-name fallback — plus the merchant when the tripping
 * row named one (`null` = product-wide bucket, cited without merchant).
 */
function citationFor(
  fact: DigestFact,
  locale: DigestEmailLocale,
): string {
  const product = locale === 'fi' ? `Tuote #${fact.productId}` : `Product #${fact.productId}`;
  return fact.merchant === null
    ? product
    : `${product}, ${sanitizeMerchant(fact.merchant)}`;
}

/** Render one fact into its one-line factual sentence. */
function factLine(fact: DigestFact, input: PreferenceDigestEmailInput): string {
  const copy = COPY[input.locale];
  const label = CATEGORY_LABELS[fact.category][input.locale];
  const price = input.locale === 'fi' ? euroFi(fact.priceCloseCents) : euroEn(fact.priceCloseCents);
  const citation = citationFor(fact, input.locale);
  const day = sanitizeLine(fact.periodStart);
  switch (fact.kind) {
    case 'CATEGORY_MINIMUM':
      return copy.minimum(label, input.week, price, citation, day);
    case 'NOTABLE_NEW_LOW':
      return copy.newLow(label, price, citation, day);
    default: {
      // A value outside the closed kind union is a caller contract
      // violation — fail loudly instead of rendering a wrong sentence.
      throw new Error(`unknown digest fact kind: ${String(fact.kind)}`);
    }
  }
}

/**
 * Render the weekly preference-digest email. Fails loudly on an empty
 * fact set — the cron never sends an empty digest (spec
 * preference-digest: a digest with no reportable categories is not sent
 * and writes no intent row) — and on an empty `/onboarding` URL, so a
 * digest without the consent-change link cannot be rendered by accident.
 */
export function buildPreferenceDigestEmail(
  input: PreferenceDigestEmailInput,
): PreferenceDigestEmailBody {
  if (input.facts.length === 0) {
    // The caller never calls this with no facts (spec: no empty digests).
    throw new Error(
      'preference digest requires at least one fact — an empty digest is never sent',
    );
  }
  const onboardingUrl = sanitizeLine(input.onboardingUrl);
  if (onboardingUrl.length === 0) {
    throw new Error('preference digest requires an onboarding URL');
  }
  const week = sanitizeLine(input.week);
  const copy = COPY[input.locale];
  const lines = input.facts.map((fact) => factLine(fact, input));

  const text = [
    copy.greeting,
    '',
    copy.intro(week),
    '',
    ...lines,
    '',
    copy.dataStatement,
    '',
    copy.footer(onboardingUrl),
    '',
    copy.signOff,
    '',
  ].join('\n');

  const html = [
    `<p>${copy.greeting}</p>`,
    `<p>${escapeHtml(copy.intro(week))}</p>`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>${escapeHtml(copy.dataStatement)}</p>`,
    `<p style="font-size:12px;color:#666"><a href="${escapeHtml(onboardingUrl)}">${escapeHtml(copy.footerLinkLabel)}</a></p>`,
    `<p style="font-size:12px;color:#666">${escapeHtml(copy.signOff)}</p>`,
  ].join('\n');

  return {
    subject: sanitizeSubject(copy.subject(week)),
    text,
    html,
  };
}

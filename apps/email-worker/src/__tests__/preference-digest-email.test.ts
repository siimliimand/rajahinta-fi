/**
 * Tests for the preference-digest email builder (task 4.3, change
 * add-onboarding-preferences) — fixture facts pinning the factual copy
 * (design D3), locale rendering (FI primary, EN secondary), the
 * `/onboarding` consent-change footer, and the never-empty-digest
 * contract. Mirrors the alert email builders' test discipline
 * (price-alert-evaluation.test.ts): every cited field pinned to its
 * input value, hygiene asserted on the subject.
 *
 * ## Vocabulary compliance
 *
 * The spec's CI gate for digest copy is the cross-package compliance
 * suite (task 6.1, tests/compliance/preference-digest-neutrality.test.ts,
 * same layer as the existing neutrality suites). That suite resolves
 * the shared content policy through the `@rajahinta/frontend` vitest
 * alias, which this package's vitest config does not carry, so these
 * tests import the SAME pure module by relative path — the app→app
 * relative import is this repo's established cross-tree trade
 * (api-worker → email-worker templates) — and run `isCompliant()` over
 * every rendered fragment as a local self-check mirroring the gate.
 *
 * @module preference-digest-email-test
 */

import { describe, expect, it } from 'vitest';
import { buildPreferenceDigestEmail } from '../preference-digest-email';
import type { DigestFact } from '../../../../packages/core-domain/src/digest/digest.types';
import { DIGEST_CATEGORY_VALUES } from '../../../../packages/core-domain/src/digest/digest.types';
import { isCompliant } from '../../../../apps/frontend/src/lib/content-policy';

const ONBOARDING_URL = 'https://rajahinta.fi/onboarding';

/** Fixture facts covering both fact kinds and both citation shapes. */
const FACTS: DigestFact[] = [
  {
    category: 'beer',
    kind: 'CATEGORY_MINIMUM',
    priceCloseCents: 1234,
    productId: 42,
    merchant: null,
    periodStart: '2026-10-05',
  },
  {
    category: 'beer',
    kind: 'NOTABLE_NEW_LOW',
    priceCloseCents: 1220,
    productId: 43,
    merchant: 'Alko',
    periodStart: '2026-10-07',
  },
];

describe('buildPreferenceDigestEmail — FI rendering (primary locale)', () => {
  it('renders the week, cited facts, data statement and onboarding footer', () => {
    const email = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: FACTS,
      locale: 'fi',
      onboardingUrl: ONBOARDING_URL,
    });

    expect(email.subject).toBe('[rajahinta] Viikon 2026-W41 hintakatsaus');
    // Every fact is cited verbatim: category label, price, product id,
    // merchant (absent when the bucket was product-wide) and bucket day.
    expect(email.text).toContain(
      'Olut: alin hinta viikolla 2026-W41 12,34 € (Tuote #42), havaittu 2026-10-05.',
    );
    expect(email.text).toContain(
      'Olut: uusi alin hinta 12,20 € (Tuote #43, Alko), havaittu 2026-10-07.',
    );
    expect(email.text).toContain(
      'Hinnat ovat toteutuneita hyllyhintoja materialisoiduista päiväyhteenvedoista, eivät reaaliaikaisia hintoja.',
    );
    expect(email.text).toContain(
      `Voit muuttaa seurattavia kategorioitasi tai digisuostumuksesi osoitteessa: ${ONBOARDING_URL}`,
    );
    expect(email.text).toContain('— rajahinta.fi');
  });

  it('renders the same facts into the HTML part with the footer link', () => {
    const email = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: FACTS,
      locale: 'fi',
      onboardingUrl: ONBOARDING_URL,
    });

    expect(email.html).toContain('<p>Hei!</p>');
    expect(email.html).toContain(
      'Olut: alin hinta viikolla 2026-W41 12,34 € (Tuote #42), havaittu 2026-10-05.',
    );
    expect(email.html).toContain(
      `<a href="${ONBOARDING_URL}">Asetukset ja digisuostumus</a>`,
    );
  });
});

describe('buildPreferenceDigestEmail — EN rendering (secondary locale)', () => {
  it('renders the same facts under the EN copy and euro convention', () => {
    const email = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: FACTS,
      locale: 'en',
      onboardingUrl: ONBOARDING_URL,
    });

    expect(email.subject).toBe('[rajahinta] Price digest, week 2026-W41');
    expect(email.text).toContain(
      'Beer: minimum shelf price in week 2026-W41 €12.34 (Product #42), observed 2026-10-05.',
    );
    expect(email.text).toContain(
      'Beer: new minimum shelf price €12.20 (Product #43, Alko), observed 2026-10-07.',
    );
    expect(email.text).toContain(
      `You can change your followed categories or digest consent at: ${ONBOARDING_URL}`,
    );
  });

  it('locale changes the rendering, never the cited facts', () => {
    const fi = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: FACTS,
      locale: 'fi',
      onboardingUrl: ONBOARDING_URL,
    });
    const en = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: FACTS,
      locale: 'en',
      onboardingUrl: ONBOARDING_URL,
    });

    expect(en.subject).not.toBe(fi.subject);
    expect(en.text).not.toBe(fi.text);
    // The citations themselves are locale-independent: the product
    // number, the merchant, and the bucket day survive translation.
    for (const email of [fi, en]) {
      expect(email.text).toContain('#42');
      expect(email.text).toContain('Alko');
      expect(email.text).toContain('2026-10-05');
    }
  });
});

describe('buildPreferenceDigestEmail — vocabulary compliance (design D3)', () => {
  /**
   * Fixture spread: every canonical category, both fact kinds, and
   * merchant shapes from absent to long — the copy must survive the
   * shared checkContent vocabulary in every rendering.
   */
  const COMPLIANCE_FACTS: DigestFact[] = DIGEST_CATEGORY_VALUES.flatMap(
    (category, i) =>
      [
        {
          category,
          kind: 'CATEGORY_MINIMUM',
          priceCloseCents: 100 + i,
          productId: 1000 + i,
          merchant: i % 2 === 0 ? null : 'Esimerkki-Kauppias Oy (verkkokauppa)',
          periodStart: '2026-10-06',
        },
        {
          category,
          kind: 'NOTABLE_NEW_LOW',
          priceCloseCents: 99 + i,
          productId: 2000 + i,
          merchant: 'Alko',
          periodStart: '2026-10-08',
        },
      ] satisfies DigestFact[],
  );

  it('every rendered fragment passes isCompliant() in both locales', () => {
    for (const locale of ['fi', 'en'] as const) {
      const email = buildPreferenceDigestEmail({
        week: '2026-W41',
        facts: COMPLIANCE_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      // No promotional adjectives, no urgency, no advice phrasing —
      // the shared content-policy vocabulary over subject, text, html.
      expect(isCompliant(email.subject), `subject (${locale})`).toBe(true);
      expect(isCompliant(email.text), `text (${locale})`).toBe(true);
      expect(isCompliant(email.html), `html (${locale})`).toBe(true);
    }
  });

  it('labels every canonical category in both locales (label exhaustiveness)', () => {
    for (const locale of ['fi', 'en'] as const) {
      const email = buildPreferenceDigestEmail({
        week: '2026-W41',
        facts: COMPLIANCE_FACTS.filter(
          (fact) => fact.kind === 'CATEGORY_MINIMUM',
        ),
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      for (const category of DIGEST_CATEGORY_VALUES) {
        // The raw canonical key never leaks into the rendered mail.
        expect(email.text).not.toContain(category);
      }
    }
  });
});

describe('buildPreferenceDigestEmail — contracts', () => {
  it('rejects an empty fact set — an empty digest is never sent (spec)', () => {
    expect(() =>
      buildPreferenceDigestEmail({
        week: '2026-W41',
        facts: [],
        locale: 'fi',
        onboardingUrl: ONBOARDING_URL,
      }),
    ).toThrow(/at least one fact/);
  });

  it('rejects an empty onboarding URL — the consent-change link is mandatory', () => {
    for (const url of ['', '   ']) {
      expect(() =>
        buildPreferenceDigestEmail({
          week: '2026-W41',
          facts: FACTS,
          locale: 'fi',
          onboardingUrl: url,
        }),
      ).toThrow(/onboarding URL/);
    }
  });

  it('strips CR/LF from interpolated values — subject stays one line', () => {
    // The merchant cap (100 chars, the alert builders' emailProductName
    // trade) cuts a header-injection payload smuggled past a line break.
    const email = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: [
        {
          category: 'beer',
          kind: 'CATEGORY_MINIMUM',
          priceCloseCents: 500,
          productId: 42,
          merchant: `${'k'.repeat(120)}\r\nBCC: victim@example.com`,
          periodStart: '2026-10-05',
        },
      ],
      locale: 'fi',
      onboardingUrl: `${ONBOARDING_URL}\r\nX-Evil: 1`,
    });

    // No raw CR survives interpolation into any part (the body text is
    // multi-line by design; line breaks in VALUES collapse to spaces).
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(255);
    expect(email.text).not.toContain('\r');
    expect(email.html).not.toContain('\r');
    // The capped citation cut the smuggled payload.
    expect(email.text).not.toContain('BCC');
    expect(email.html).not.toContain('BCC');
  });

  it('echoes the input fact order — rendering never re-sorts', () => {
    // Deliberately NOT price-ascending: ordering is the compute module's
    // contract; the builder echoes verbatim.
    const email = buildPreferenceDigestEmail({
      week: '2026-W41',
      facts: [
        FACTS[1]!, // beer new low, 1220
        FACTS[0]!, // beer minimum, 1234
      ],
      locale: 'fi',
      onboardingUrl: ONBOARDING_URL,
    });

    const first = email.text.indexOf('uusi alin hinta');
    const second = email.text.indexOf('alin hinta viikolla');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  it('fails loudly on a fact kind outside the closed union', () => {
    expect(() =>
      buildPreferenceDigestEmail({
        week: '2026-W41',
        facts: [
          {
            ...FACTS[0]!,
            kind: 'SUPERLATIVE' as DigestFact['kind'],
          },
        ],
        locale: 'fi',
        onboardingUrl: ONBOARDING_URL,
      }),
    ).toThrow(/unknown digest fact kind/);
  });
});

/**
 * Embed calculator view tests (task 6.3) — the self-contained document
 * the embed route emits: the age gate and declined states render from
 * the shared catalogs, the structural disclaimer travels with the
 * result, user-derived text is escaped, and the document is
 * chrome-less and noindexed.
 *
 * @module EmbedCalculatorViewTest
 */

import { describe, it, expect } from 'vitest';
import {
  renderEmbedCalculatorHtml,
  escapeHtml,
  embedMessage,
  EMBED_MAX_QUANTITY,
  type EmbedOutcome,
} from './view';
import type { CalculatorResult } from '@/lib/types';

const DISCLAIMER = {
  text: 'Estimoitu hinta: laskelma ei ole tarjous, takuu eikä virallinen ilmoitus.',
  language: 'fi' as const,
  version: '1.0',
};

const RESULT: CalculatorResult = {
  itemizedCosts: [
    {
      label: 'Foreign retail price',
      category: 'foreignRetailPrice',
      cents: 1298,
      reliability: 'VERIFIED',
    },
    {
      label: 'Alcohol excise estimate',
      category: 'alcoholExciseEstimate',
      cents: 170,
      reliability: 'ESTIMATED',
    },
  ],
  excludedOffers: [],
  foreignRetailPrice: 12.98,
  transportCost: 0,
  alcoholExciseEstimate: 1.7,
  containerDutyEstimate: 0,
  totalCents: 1468,
  currency: 'EUR',
  confidence: 'MEDIUM',
  confidenceBreakdown: [],
  disclaimer: DISCLAIMER,
  classification: {
    classification: 'DistanceBuying',
    confidence: 'HIGH',
    evidence: [],
    evidenceSummary: 'Evidence summary.',
  },
  metadata: {
    input: { productId: 12, quantity: 2, destination: 'FI' },
    calculationTimestamp: '2026-09-08T10:00:00.000Z',
    productMasterId: 12,
    retailOfferIds: [1],
    quantity: 2,
    destination: 'FI',
    productName: 'Beer 0,5 l',
    volumeLitres: 1,
    alcoholByVolume: 4.7,
    category: 'beer',
    datasetVersions: ['v3.0-2026'],
    transportOfferId: null,
  },
  calculationRecordId: 42,
};

function outcome(partial: Partial<EmbedOutcome> & { kind: EmbedOutcome['kind'] }): EmbedOutcome {
  return { ...partial } as EmbedOutcome;
}

describe('renderEmbedCalculatorHtml — document shape', () => {
  it('renders a self-contained document: no site chrome, noindex, locale lang', () => {
    const html = renderEmbedCalculatorHtml('fi', outcome({ kind: 'age-gate' }));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="fi">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('site-header');
    expect(html).not.toContain('site-footer');
    expect(html).toContain('data-embed="calculator"');
  });

  it('renders the English locale from the same catalogs', () => {
    const html = renderEmbedCalculatorHtml('en', outcome({ kind: 'result', result: RESULT }));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Landed-cost calculator');
    expect(html).toContain('Total');
    expect(html).toContain('Foreign retail price');
  });
});

describe('renderEmbedCalculatorHtml — age gate and declined', () => {
  it('renders the gate prompt with confirm/deny actions and no calculation form', () => {
    const html = renderEmbedCalculatorHtml('fi', outcome({ kind: 'age-gate' }));
    expect(html).toContain('Ikätarkistus');
    expect(html).toContain('Oletko vähintään 18-vuotias?');
    expect(html).toContain('href="?confirm=1"');
    expect(html).toContain('href="?declined=1"');
    expect(html).toContain('Olen 18 vuotta täyttänyt');
    expect(html).toContain('Henkilötietoja ei kerätä');
    // No path to a calculation while the gate is up.
    expect(html).not.toContain('name="q"');
    expect(html).not.toContain('name="product"');
  });

  it('renders the declined state from the declined catalog', () => {
    const html = renderEmbedCalculatorHtml('en', outcome({ kind: 'declined' }));
    expect(html).toContain('Access restricted');
    expect(html).toContain('You indicated that you are under 18.');
  });
});

describe('renderEmbedCalculatorHtml — search states', () => {
  it('renders the search form without a results section before any search', () => {
    const html = renderEmbedCalculatorHtml('fi', outcome({ kind: 'search', query: '', items: [] }));
    expect(html).toContain('name="q"');
    expect(html).toContain('name="confirm"');
    expect(html).not.toContain('Hakutulokset');
  });

  it('renders one quantity + calculate form per search result', () => {
    const html = renderEmbedCalculatorHtml('fi', {
      kind: 'search',
      query: 'beer',
      items: [
        {
          id: 12,
          name: 'Beer 0,5 l',
          brand: 'Brand',
          category: 'beer',
          alcoholByVolume: 4.7,
          unitVolume: '0,5 l',
          containerType: 'CAN',
          lowestPriceCents: 1298,
          merchantCount: 3,
        },
      ],
    });
    expect(html).toContain('Hakutulokset');
    expect(html).toContain('name="product" value="12"');
    expect(html).toContain(`type="number" name="quantity" value="1" min="1" max="${EMBED_MAX_QUANTITY}"`);
    expect(html).toContain('Laske kokonaiskustannus');
    expect(html).toContain('4.7 til-%');
  });

  it('renders the no-results state with the query interpolated and escaped', () => {
    const html = renderEmbedCalculatorHtml('fi', {
      kind: 'no-results',
      query: '"><script>alert(1)</script>',
    });
    expect(html).toContain('Ei hakutuloksia');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('renderEmbedCalculatorHtml — result outcome', () => {
  it('renders the structural disclaimer from the response before the figures', () => {
    const html = renderEmbedCalculatorHtml('fi', { kind: 'result', result: RESULT });
    expect(html).toContain(`role="note">${DISCLAIMER.text}`);
    expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf('Yhteensä'));
    expect(html).toContain('v1.0');
  });

  it('renders the itemized costs, total, quantity, and confidence', () => {
    const html = renderEmbedCalculatorHtml('fi', { kind: 'result', result: RESULT });
    expect(html).toContain('Ulkomainen vähittäishinta');
    expect(html).toContain('Arvio alkoholin valmisteverosta');
    expect(html).toContain('€12.98');
    expect(html).toContain('<strong>€14.68</strong>');
    expect(html).toContain('2 × Suomi');
    expect(html).toContain('Kohtalainen luotettavuus');
    expect(html).toContain('Vahvistettu');
    expect(html).toContain('Verokanta-aineisto: v3.0-2026');
  });

  it('escapes hostile product names and dataset versions', () => {
    const hostile: CalculatorResult = {
      ...RESULT,
      metadata: {
        ...RESULT.metadata,
        productName: '<script>alert(1)</script>&quot;',
        datasetVersions: ['v3.0-2026<script>'],
      },
    };
    const html = renderEmbedCalculatorHtml('fi', { kind: 'result', result: hostile });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;quot;');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('v3.0-2026&lt;script&gt;');
  });
});

describe('renderEmbedCalculatorHtml — non-result outcomes', () => {
  it('renders the throttled view with a same-origin retry link', () => {
    const html = renderEmbedCalculatorHtml('fi', {
      kind: 'throttled',
      retryAfterSeconds: 30,
      retryPath: '/embed/calculator?confirm=1&q=beer',
    });
    expect(html).toContain('Yritä uudelleen 30 sekunnin kuluttua.');
    expect(html).toContain('href="/embed/calculator?confirm=1&amp;q=beer"');
    // No auto-refresh: a throttled iframe must not resubmit in a loop.
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('clamps the retry wait into a sane range', () => {
    const html = renderEmbedCalculatorHtml('fi', {
      kind: 'throttled',
      retryAfterSeconds: 5000,
      retryPath: '/embed/calculator',
    });
    expect(html).toContain('300 sekunnin kuluttua.');
  });

  it('renders the unavailable view', () => {
    const html = renderEmbedCalculatorHtml('fi', { kind: 'unavailable' });
    expect(html).toContain('Laskelma ei ole nyt saatavilla');
  });
});

describe('helpers', () => {
  it('escapeHtml neutralizes markup characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
    );
  });

  it('embedMessage falls back to the key for missing paths', () => {
    expect(embedMessage('fi', 'Calculator.title')).toBe('Kokonaiskustannuslaskuri');
    expect(embedMessage('fi', 'Calculator.does.not.exist')).toBe('Calculator.does.not.exist');
  });
});

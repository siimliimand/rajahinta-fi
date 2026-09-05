/**
 * Embed widget view tests (task 8.3) — the self-contained document the
 * embed route emits: the structural disclaimer travels with the result,
 * user-derived text is escaped, the document is chrome-less and
 * noindexed, and the throttled outcome waits out the Retry-After.
 *
 * @module WhatIfEmbedViewTest
 */

import { describe, it, expect } from 'vitest';
import { renderEmbedHtml, escapeHtml, embedMessage, type EmbedOutcome } from './view';
import type { WhatIfResponse } from '../what-if.types';

const DISCLAIMER = {
  text: 'Hypoteettinen laskelma: laskelma ei ole ennuste, arvio tulevaisuuden hinnoista eikä virallinen ilmoitus.',
  language: 'fi' as const,
  version: '1.0',
};

const RESULT: WhatIfResponse = {
  hypotheticalRate: 18.1,
  baselineTaxDatasetVersion: 'v3.0-2026',
  disclaimer: DISCLAIMER,
  lines: [
    {
      id: 'beer-05',
      category: 'beer',
      importTotalBaselineCents: 259,
      importTotalHypotheticalCents: 174,
      gapBaselineCents: -1039,
      gapHypotheticalCents: -1124,
      gapDeltaCents: -85,
      baseline: {
        formulaRef: 'PER_CENTILITRE_ETHANOL',
        rateApplied: 36.2 * 0.047,
        taxCents: 170,
        taxDatasetVersion: 'v3.0-2026',
        ruleId: 101,
        reliability: 'VERIFIED',
      },
      hypothetical: {
        formulaRef: 'PER_CENTILITRE_ETHANOL',
        rate: 18.1,
        rateApplied: 18.1 * 0.047,
        taxCents: 85,
      },
    },
  ],
  totals: {
    baselineExciseCents: 170,
    hypotheticalExciseCents: 85,
    gapBaselineCents: -1039,
    gapHypotheticalCents: -1124,
  },
  shareToken: 'wi1.test-vector.a',
};

function resultOutcome(result: WhatIfResponse = RESULT): EmbedOutcome {
  return { kind: 'result', result };
}

describe('renderEmbedHtml — document shape', () => {
  it('renders a self-contained document: no site chrome, noindex, locale lang', () => {
    const html = renderEmbedHtml('fi', resultOutcome());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="fi">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('site-header');
    expect(html).not.toContain('site-footer');
    expect(html).toContain('data-embed="what-if"');
  });

  it('renders the English locale from the same catalogs', () => {
    const html = renderEmbedHtml('en', resultOutcome());
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Hypothetical excise rate: 18.1 € per formula unit');
  });
});

describe('renderEmbedHtml — result outcome', () => {
  it('renders the structural disclaimer from the response before the figures', () => {
    const html = renderEmbedHtml('fi', resultOutcome());
    expect(html).toContain(`role="note">${DISCLAIMER.text}`);
    // Prominent: the disclaimer appears before the totals table.
    expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf('Yhteenveto'));
    expect(html).toContain('v1.0');
  });

  it('renders the gap figures with the payload sign convention', () => {
    const html = renderEmbedHtml('fi', resultOutcome());
    expect(html).toContain('€2.59');
    expect(html).toContain('€1.74');
    expect(html).toContain('-€10.39');
    expect(html).toContain('-€11.24');
    expect(html).toContain('<strong>-€0.85</strong>');
  });

  it('escapes hostile product ids and dataset versions', () => {
    const hostile: WhatIfResponse = {
      ...RESULT,
      baselineTaxDatasetVersion: 'v3.0-2026<script>',
      lines: [
        {
          ...RESULT.lines[0]!,
          id: '<script>alert(1)</script>&quot;',
        },
      ],
    };
    const html = renderEmbedHtml('fi', { kind: 'result', result: hostile });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;quot;');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('v3.0-2026<script>');
    expect(html).toContain('v3.0-2026&lt;script&gt;');
  });
});

describe('renderEmbedHtml — non-result outcomes', () => {
  it('renders the closed view when the flag is off', () => {
    const html = renderEmbedHtml('fi', { kind: 'closed' });
    expect(html).toContain('Mitä jos -laskuri ei ole käytettävissä');
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('renders the invalid-token view', () => {
    const html = renderEmbedHtml('fi', { kind: 'invalid' });
    expect(html).toContain('Linkkiä ei voitu lukea');
  });

  it('renders the unavailable view', () => {
    const html = renderEmbedHtml('fi', { kind: 'unavailable' });
    expect(html).toContain('Laskelma ei ole nyt saatavilla');
  });

  it('renders the throttled view with a meta refresh waiting out the Retry-After', () => {
    const html = renderEmbedHtml('fi', { kind: 'throttled', retryAfterSeconds: 30 });
    expect(html).toContain('<meta http-equiv="refresh" content="30">');
    expect(html).toContain('Näkymä päivittyy automaattisesti 30 sekunnin kuluttua.');
  });

  it('clamps the meta refresh into a sane range', () => {
    const html = renderEmbedHtml('fi', { kind: 'throttled', retryAfterSeconds: 5000 });
    expect(html).toContain('<meta http-equiv="refresh" content="300">');
  });
});

describe('helpers', () => {
  it('escapeHtml neutralizes markup characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
    );
  });

  it('embedMessage falls back to the key for missing paths', () => {
    expect(embedMessage('fi', 'WhatIfPage.title')).toBe('Mitä jos -laskuri');
    expect(embedMessage('fi', 'WhatIfPage.does.not.exist')).toBe('WhatIfPage.does.not.exist');
  });
});

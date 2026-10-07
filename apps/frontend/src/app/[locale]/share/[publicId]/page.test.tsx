/**
 * Share page tests (trust-and-reach-roadmap task 6.2, spec
 * share-permalinks "Public read-only share page").
 *
 * Renders the REAL async server component (Next server plumbing mocked
 * — the curated-list page test precedent), pinning:
 *
 *   1. An ok snapshot renders the product name, the estimated total,
 *      the itemized lines, the frozen-copy note, and the accuracy-stat
 *      cross-link to /ranking#accuracy.
 *   2. The snapshot's own structural disclaimer drives the
 *      DisclaimerBanner; a corrupt disclaimer degrades to the fallback
 *      copy — never a crash.
 *   3. Unknown AND malformed ids are the same notFound() — no
 *      identifier-existence leakage, and the generic 404 carries no
 *      identifier echo.
 *   4. generateMetadata builds the OG card from the snapshot fields
 *      (product name, quantity, destination, total) and the fallback
 *      card carries no identifier echo.
 *   5. The import-VAT line localizes through the canonical catalog;
 *      a snapshot without the line renders no VAT row at all.
 *   6. Coded breakdown lines (task 2.3, fi-locale-surface-hardening)
 *      localize through the basket-result catalog — the same path the
 *      basket result renders from — while unknown codes and pre-code
 *      lines fall back verbatim / to the canonical category.
 *   7. The empirical margin (hedge-dedup-confidence-meter 4.2, design
 *      D6): a snapshot frozen WITH the margin renders the meter beside
 *      the total; a legacy snapshot without the key renders exactly as
 *      before, and a corrupt margin degrades byte-identically to the
 *      legacy output — never a crash, never a fabricated figure.
 *
 * @module SharePageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SharePage, { generateMetadata } from './page';
import { request } from '@/lib/api';
import type { ApiError } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    const lookup = (key: string): string => {
      // Walk dotted subkeys within the namespace (tCommon('confidence.MEDIUM')).
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          table[ns],
        );
      return typeof value === 'string' ? value : `__MISSING_${ns}.${key}__`;
    };
    const interpolate = (
      template: string,
      values?: Record<string, unknown>,
    ): string =>
      values === undefined
        ? template
        : template.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    return Object.assign((key: string, values?: Record<string, unknown>) => interpolate(lookup(key), values), {
      rich: (
        key: string,
        values: Record<string, unknown> & { link?: (chunks: string) => unknown },
      ) => {
        const template = lookup(key);
        const inner = /<link>([\s\S]*?)<\/link>/.exec(template)?.[1] ?? '';
        const [before, after] = template.split(/<link>[\s\S]*?<\/link>/);
        if (values.link === undefined) return interpolate(template, values);
        return [before, values.link(inner), after];
      },
    });
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<
      string,
      unknown
    >,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement(
      'a',
      { ...rest, href: String(href ?? '') },
      children,
    );
  },
}));

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

// The DisclaimerBanner is a client component (useTranslations); the
// server-render of this test has no provider. The banner's contract on
// this page is "render the snapshot's own disclaimer text" — a stub
// that echoes the prop pins exactly that.
vi.mock('../../calculator/components/DisclaimerBanner', () => ({
  default: ({ disclaimer }: { disclaimer: { text: string } }) =>
    React.createElement(
      'div',
      { 'data-testid': 'disclaimer-banner-stub' },
      disclaimer.text,
    ),
}));

// The ConfidenceMeter is a client component too — same stub precedent.
// The stub mirrors the real component's render-nothing contract
// (absent margin → null) so the page's pass-through of the parsed
// margin is exactly what the assertions observe.
vi.mock('../../components/ConfidenceMeter', () => ({
  default: ({
    margin,
    totalCents,
  }: {
    margin?: { quantile: number; sampleCount: number } | undefined;
    totalCents: number;
  }) =>
    margin === undefined
      ? null
      : React.createElement(
          'p',
          { 'data-testid': 'confidence-meter' },
          `meter q=${margin.quantile} n=${margin.sampleCount} total=${totalCents}`,
        ),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBLIC_ID = 'abc123def456ghi789jklm';

const SNAPSHOT_OK = {
  publicId: PUBLIC_ID,
  createdAt: '2026-09-08T12:00:00.000Z',
  snapshot: {
    type: 'landed-cost-snapshot',
    product: { name: 'Harbour Lager', brand: 'Brauerei Example', category: 'beer' },
    quantity: 2,
    totalCents: 4560,
    currency: 'EUR',
    breakdown: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 2400, reliability: 'VERIFIED' },
      { label: 'Transport', category: 'transportCost', cents: 500, reliability: 'ESTIMATED' },
      { label: 'Excise', category: 'alcoholExciseEstimate', cents: 1660, reliability: 'ESTIMATED' },
    ],
    confidence: 'MEDIUM',
    destination: 'FI',
    disclaimer: {
      text: 'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
      language: 'fi',
      version: '1.0',
    },
    calculatedAt: '2026-09-08T11:55:00.000Z',
  },
};

const SNAPSHOT_WITH_IMPORT_VAT = {
  ...SNAPSHOT_OK,
  snapshot: {
    ...SNAPSHOT_OK.snapshot,
    totalCents: 5280,
    breakdown: [
      ...SNAPSHOT_OK.snapshot.breakdown,
      {
        label: 'Import VAT',
        category: 'importVatEstimate',
        cents: 720,
        reliability: 'ESTIMATED',
      },
    ],
  },
};

// Task 2.3 (fi-locale-surface-hardening): snapshots frozen after the
// closed-set `code` landed carry it per line and localize along the same
// path the basket result uses; unknown codes and pre-code lines fall
// back exactly like the basket result does.
const SNAPSHOT_WITH_CODE = {
  ...SNAPSHOT_OK,
  snapshot: {
    ...SNAPSHOT_OK.snapshot,
    breakdown: [
      {
        label: 'Import VAT (estimated)',
        code: 'import_vat',
        category: 'importVatEstimate',
        cents: 720,
        reliability: 'ESTIMATED',
      },
      {
        // Unknown code AND no canonical category — both fallbacks miss,
        // so the verbatim stored label renders (never blank).
        label: 'Future line',
        code: 'future_line',
        category: 'somethingNew',
        cents: 100,
        reliability: 'VERIFIED',
      },
      {
        label: 'Legacy transport',
        category: 'transportCost',
        cents: 500,
        reliability: 'VERIFIED',
      },
    ],
  },
};

// Task 4.2 (hedge-dedup-confidence-meter, design D6): snapshots frozen
// after the margin joined the digest carry it additively; legacy
// snapshots lack the key entirely (render-nothing, never null).
const MARGIN = {
  quantile: 0.05,
  sampleCount: 16,
  cell: { dimension: 'global', key: 'global' },
  asOf: '2026-09-28T12:00:00.000Z',
};

const SNAPSHOT_WITH_MARGIN = {
  ...SNAPSHOT_OK,
  snapshot: {
    ...SNAPSHOT_OK.snapshot,
    empiricalMargin: MARGIN,
  },
};

function apiError(status: number): ApiError {
  return {
    statusCode: status,
    message: 'error',
    error: 'Error',
    timestamp: '2026-09-08T12:00:00.000Z',
    path: `/api/v1/share/${PUBLIC_ID}`,
  };
}

async function renderPage(): Promise<string> {
  const element = await SharePage({
    params: Promise.resolve({ locale: 'fi', publicId: PUBLIC_ID }),
  });
  return renderToString(element);
}

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

describe('SharePage', () => {
  it('renders the snapshot fields, itemized lines, and accuracy cross-link', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_OK);

    const html = await renderPage();

    expect(html).toContain('Harbour Lager');
    expect(html).toContain('Brauerei Example');
    expect(html).toContain('45,60 €');
    // Itemized lines localize through the canonical category labels.
    expect(html).toContain('Ulkomainen vähittäishinta');
    expect(html).toContain('24,00 €');
    // The frozen-copy note and provenance.
    expect(html).toContain('jäädytetyn kopion');
    expect(html).toContain('Kopio luotu');
    // The accuracy-stat cross-link anchors to the methodology section.
    expect(html).toContain('href="/ranking#accuracy"');
    // Confidence renders through the canonical label.
    expect(html).toContain('Kohtalainen luotettavuus');
  });

  it('drives the DisclaimerBanner from the snapshot disclaimer', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_OK);
    const html = await renderPage();
    expect(html).toContain('Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.');
  });

  it('localizes the import-VAT line through the canonical catalog', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_WITH_IMPORT_VAT);

    const html = await renderPage();

    expect(html).toContain('Tuonnin arvonlisävero');
    expect(html).toContain('7,20 €');
    // The stored label is the fallback for non-canonical lines only — a
    // whitelisted category must never surface the raw stored copy.
    expect(html).not.toContain('Import VAT');
  });

  it('localizes coded lines through the basket-result catalog and falls back like the basket result', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_WITH_CODE);

    const html = await renderPage();

    // Known code → the basket-result catalog label (the same path the
    // basket result renders from), stored label suppressed. The plain
    // label carries no estimate qualifier (hedge-dedup-confidence-meter
    // 3.2, design D2 — the catalog drives this shared path).
    expect(html).toContain('Tuonnin arvonlisävero');
    expect(html).not.toContain('Tuonnin arvonlisävero (arvio)');
    expect(html).not.toContain('Import VAT (estimated)');
    // Unknown code → the verbatim stored label.
    expect(html).toContain('Future line');
    // Pre-code line → the canonical category label (legacy path intact).
    expect(html).toContain('Kuljetuskustannus');
    expect(html).not.toContain('Legacy transport');
  });

  it('renders no VAT row for a snapshot without the import-VAT line', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_OK);

    const html = await renderPage();

    expect(html).not.toContain('Tuonnin arvonlisävero');
    expect(html).not.toContain('importVatEstimate');
  });

  // Task 4.2 (hedge-dedup-confidence-meter, design D6): the meter joins
  // the share page's frozen total.
  it('renders the confidence meter beside the total when the snapshot froze a margin', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_WITH_MARGIN);

    const html = await renderPage();

    // The meter renders and receives the parsed frozen margin verbatim.
    expect(html).toContain('data-testid="confidence-meter"');
    expect(html).toContain('meter q=0.05 n=16 total=4560');
    // Beside the total: same section as the share-total figure.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meter = doc.querySelector('[data-testid="confidence-meter"]');
    expect(
      meter?.closest('section')?.querySelector('[data-testid="share-total"]'),
    ).not.toBeNull();
    // The frozen total itself is untouched by the margin.
    expect(html).toContain('45,60 €');
  });

  it('renders a legacy snapshot exactly as before — no meter, pinned unchanged parts', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_OK);

    const html = await renderPage();

    // No meter anywhere — the render-nothing state for the absent key.
    expect(html).not.toContain('confidence-meter');
    // The unchanged parts, pinned: total, single disclaimer render,
    // currency line, breakdown, confidence label, frozen-copy note,
    // and the accuracy cross-link.
    expect(html).toContain('data-testid="share-total"');
    expect(html).toContain('45,60 €');
    expect(html.split('Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.')).toHaveLength(2);
    expect(html).toContain('Ulkomainen vähittäishinta');
    expect(html).toContain('Kohtalainen luotettavuus');
    expect(html).toContain('jäädytetyn kopion');
    expect(html).toContain('href="/ranking#accuracy"');
    // Structure unchanged: the currency line directly follows the
    // total — no meter element inserted between them.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const next = doc.querySelector('[data-testid="share-total"]')?.nextElementSibling;
    expect(next?.tagName).toBe('P');
    expect(next?.textContent).toContain('EUR');
  });

  it('degrades a corrupt margin byte-identically to the legacy output', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_OK);
    const legacyHtml = await renderPage();

    // Wrong-typed fields (stored JSON is untrusted) must parse to null
    // and render EXACTLY the legacy DOM — never a crash, never a
    // fabricated figure.
    mockedRequest.mockResolvedValue({
      ...SNAPSHOT_OK,
      snapshot: {
        ...SNAPSHOT_OK.snapshot,
        empiricalMargin: {
          quantile: '5 %',
          sampleCount: 'sixteen',
          cell: { dimension: 3, key: null },
          asOf: 12345,
        },
      },
    });
    const corruptHtml = await renderPage();

    expect(corruptHtml).toBe(legacyHtml);
    expect(corruptHtml).not.toContain('confidence-meter');
  });

  it('degrades to the fallback disclaimer copy on a corrupt disclaimer', async () => {
    mockedRequest.mockResolvedValue({
      ...SNAPSHOT_OK,
      snapshot: {
        ...SNAPSHOT_OK.snapshot,
        disclaimer: 'plain text, not the object',
      },
    });
    const html = await renderPage();
    expect(html).toContain('Arvioitu kokonaishinta Suomessa on arvio, ei lopullinen verovelka.');
  });

  it('answers the same not-found for unknown ids, echoing nothing', async () => {
    const { notFound } = await import('next/navigation');
    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(404, apiError(404), null),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(vi.mocked(notFound)).toHaveBeenCalled();
  });

  it('renders the unavailable state on a backend failure', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));
    const html = await renderPage();
    expect(html).toContain('Jaettu kokonaishinta-arvio');
    // The unavailable state never echoes the identifier.
    expect(html).not.toContain(PUBLIC_ID);
  });
});

// ---------------------------------------------------------------------------
// Metadata (OG card)
// ---------------------------------------------------------------------------

describe('SharePage generateMetadata', () => {
  it('derives the OG card from the snapshot fields', async () => {
    mockedRequest.mockResolvedValue(SNAPSHOT_OK);

    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', publicId: PUBLIC_ID }),
    });

    expect(meta.title).toContain('Harbour Lager');
    expect(meta.description).toContain('2');
    expect(meta.description).toContain('FI');
    expect(meta.description).toContain('45,60 €');
    expect(meta.openGraph?.title).toContain('Harbour Lager');
    expect(meta.openGraph?.description).toBe(meta.description);
  });

  it('falls back to generic metadata when the snapshot is missing', async () => {
    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(404, apiError(404), null),
    );

    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', publicId: PUBLIC_ID }),
    });

    // No identifier echo in the fallback card either.
    expect(JSON.stringify(meta)).not.toContain(PUBLIC_ID);
    expect(meta.title).toBe('Jaettu kokonaishinta-arvio');
  });
});

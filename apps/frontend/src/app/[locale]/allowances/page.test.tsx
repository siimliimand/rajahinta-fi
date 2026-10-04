/**
 * Allowances page tests (consumer-clarity-and-discovery 5.1 + 5.2).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would — the page is awaited first, then the resolved element tree goes
 * through Testing Library (catalog page test precedent). Pinned contract:
 *
 *   1. Each category row shows a concise Finnish summary line (category
 *      name + cap), never the ~300-character citation inline.
 *   2. Container-equivalent helper lines (5.2): static per-category
 *      conversions of the volume cap into common container counts,
 *      phrased as display-only arithmetic ("≈"); a quantity-only cap
 *      gets no conversion.
 *   3. The per-category stored citations appear inside the collapsed
 *      evidence disclosure exactly as stored — unmodified text, the
 *      extracted URL only as the evidence link href. A citation without
 *      a URL stays verbatim as plain text.
 *   4. The dataset-level citation stays verbatim and inline, outside the
 *      disclosure, as does each version-history citation.
 *
 * @module AllowancesPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AllowancesPage from './page';
import {
  getServerAllowances,
  getServerAllowanceVersions,
  type AllowancesOutcome,
  type AllowanceVersionsOutcome,
} from './allowances.server';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved from the locale's
// catalog with dotted-path lookup and {slot} substitution (catalog page test
// precedent), plus the `t.has` probe the page's unknown-category fallback
// uses. ./allowances.server keeps its real resolveRequestedDate; the two
// fetchers are mocked to the declared outcomes.
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const locale = typeof opts === 'string' ? 'fi' : (opts?.locale ?? 'fi');
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (
      await import(
        locale === 'en' ? '@/messages/en.json' : '@/messages/fi.json',
      )
    ).default as Record<string, unknown>;
    const resolve = (path: string): unknown =>
      path.split('.').reduce<unknown>((node, part) => {
        if (node !== null && typeof node === 'object') {
          return (node as Record<string, unknown>)[part];
        }
        return undefined;
      }, table);
    const translate = (key: string, values?: Record<string, unknown>) => {
      const value = resolve(`${ns}.${key}`);
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      if (values === undefined) return value;
      return value.replace(/\{(\w+)\}/g, (_, k: string) => {
        const replacement = values[k];
        return replacement === undefined ? `{${k}}` : String(replacement);
      });
    };
    return Object.assign(translate, {
      has: (key: string) => typeof resolve(`${ns}.${key}`) === 'string',
    });
  },
}));

vi.mock('./allowances.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./allowances.server')>();
  return {
    ...actual,
    getServerAllowances: vi.fn(),
    getServerAllowanceVersions: vi.fn(),
  };
});

const mockedGetServerAllowances = vi.mocked(getServerAllowances);
const mockedGetServerAllowanceVersions = vi.mocked(getServerAllowanceVersions);

// ---------------------------------------------------------------------------
// Fixtures — citations written to the exact stored shape (prose + URL, or
// prose without a URL) so the verbatim assertions are byte-exact.
// ---------------------------------------------------------------------------

const DATASET_CITATION =
  'Neuvoston direktiivi (EY) 2020/1151 … viimeisin muutos: https://eur-lex.europa.eu/eli/dir_dec/2020/1151/oj';
const BEER_CITATION =
  'Valtuutus direktiivin 2020/1151 soveltamisesta, https://eur-lex.europa.eu/legal-content/FI/TXT/?uri=CELEX:32020D1151 (katsottu 1.1.2026)';
const SPIRITS_CITATION =
  'Tullin ohje: matkustajan tuomat alkoholijuomat, voimaan 1.1.2026.';

const OK_OUTCOME: AllowancesOutcome = {
  kind: 'ok',
  payload: {
    date: '2026-10-04',
    dataset: {
      versionLabel: 'allowances-2026.1',
      sourceCitation: DATASET_CITATION,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    limits: [
      {
        category: 'beer',
        volumeCapLitres: 10,
        quantityCap: null,
        sourceCitation: BEER_CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      {
        category: 'intermediate_products',
        volumeCapLitres: 4,
        quantityCap: 16,
        sourceCitation: BEER_CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      {
        category: 'spirits',
        volumeCapLitres: null,
        quantityCap: 1,
        sourceCitation: SPIRITS_CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  },
};

const VERSIONS_OUTCOME: AllowanceVersionsOutcome = {
  kind: 'ok',
  versions: [
    {
      versionLabel: 'allowances-2026.1',
      sourceCitation: DATASET_CITATION,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      limits: [],
    },
  ],
};

async function renderAllowancesPage(
  allowances: AllowancesOutcome = OK_OUTCOME,
  versions: AllowanceVersionsOutcome = VERSIONS_OUTCOME,
): Promise<void> {
  mockedGetServerAllowances.mockResolvedValueOnce(allowances);
  mockedGetServerAllowanceVersions.mockResolvedValueOnce(versions);
  render(
    <NextIntlClientProvider
      locale="fi"
      messages={(await import('@/messages/fi.json')).default}
    >
      {await AllowancesPage({
        params: Promise.resolve({ locale: 'fi' }),
        searchParams: Promise.resolve({}),
      })}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mockedGetServerAllowances.mockReset();
  mockedGetServerAllowanceVersions.mockReset();
});

// ---------------------------------------------------------------------------
// Summary lines (5.1)
// ---------------------------------------------------------------------------

describe('AllowancesPage category summary lines', () => {
  it('renders a concise Finnish summary line (category + cap) per row, without the citation', async () => {
    await renderAllowancesPage();

    const beer = screen.getByTestId('allowances-limit-beer');
    expect(within(beer).getByText('Olut')).toBeInTheDocument();
    expect(within(beer).getByText('Enintään 10 l')).toBeInTheDocument();
    // The stored citation never repeats inline on the row.
    expect(within(beer).queryByText(BEER_CITATION)).not.toBeInTheDocument();

    expect(
      within(screen.getByTestId('allowances-limit-spirits')).getByText(
        'Väkevät alkoholijuomat',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Enintään 1 kpl')).toBeInTheDocument();
    // Volume and quantity caps state both bounds.
    expect(screen.getByText('Enintään 4 l / 16 kpl')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Container-equivalent helpers (5.2)
// ---------------------------------------------------------------------------

describe('AllowancesPage container equivalents', () => {
  it('states the static cap → common-container conversion as display-only arithmetic', async () => {
    await renderAllowancesPage();

    // 10 l / 0,5 l = 20 purkkia; 4 l / 0,75 l ≈ 5 pulloa (rounded, "≈").
    expect(
      within(screen.getByTestId('allowances-limit-beer')).getByText(
        '≈ 20 × 0,5 l purkkia',
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId('allowances-limit-intermediate_products'),
      ).getByText('≈ 5 × 0,75 l pulloa'),
    ).toBeInTheDocument();
  });

  it('omits the conversion for a quantity-only cap', async () => {
    await renderAllowancesPage();

    const spirits = screen.getByTestId('allowances-limit-spirits');
    expect(within(spirits).getByText('Enintään 1 kpl')).toBeInTheDocument();
    expect(within(spirits).queryByText(/×/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Evidence disclosure (5.1): verbatim citations, one click away
// ---------------------------------------------------------------------------

describe('AllowancesPage evidence disclosure', () => {
  it('collapses by default and holds each stored citation unmodified, evidence-linked', async () => {
    await renderAllowancesPage();

    const disclosure = screen.getByTestId('allowances-evidence-disclosure');
    expect(disclosure).not.toHaveAttribute('open');
    expect(disclosure).toHaveTextContent(
      'Lähdeviitteet (alkuperäiset tekstit)',
    );

    // Byte-exact: the rendered citation text equals the stored string, and
    // the extracted URL is only the href — nothing paraphrased or cut.
    const beerEvidence = within(
      screen.getByTestId('allowances-evidence-beer'),
    );
    const link = beerEvidence.getByText(BEER_CITATION);
    expect(link.textContent).toBe(BEER_CITATION);
    expect(link).toHaveAttribute(
      'href',
      'https://eur-lex.europa.eu/legal-content/FI/TXT/?uri=CELEX:32020D1151',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders a citation without a URL verbatim as plain text', async () => {
    await renderAllowancesPage();

    const spiritsEvidence = within(
      screen.getByTestId('allowances-evidence-spirits'),
    );
    const plain = spiritsEvidence.getByText(SPIRITS_CITATION);
    expect(plain.textContent).toBe(SPIRITS_CITATION);
    expect(plain.closest('a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dataset-level citations stay verbatim and inline
// ---------------------------------------------------------------------------

describe('AllowancesPage dataset citations', () => {
  it('keeps the resolved dataset citation inline, outside the disclosure', async () => {
    await renderAllowancesPage();

    const disclosure = screen.getByTestId('allowances-evidence-disclosure');
    const citation = within(screen.getByTestId('allowances-caps')).getByText(
      DATASET_CITATION,
    );
    expect(citation.textContent).toBe(DATASET_CITATION);
    expect(citation).toHaveAttribute(
      'href',
      'https://eur-lex.europa.eu/eli/dir_dec/2020/1151/oj',
    );
    expect(disclosure.contains(citation)).toBe(false);
  });

  it('keeps each version-history citation verbatim and inline', async () => {
    await renderAllowancesPage();

    const versions = screen.getByTestId('allowances-versions');
    expect(versions).toHaveTextContent('allowances-2026.1');
    const citation = within(versions).getByText(DATASET_CITATION);
    expect(citation.textContent).toBe(DATASET_CITATION);
    expect(
      citation.closest('a')?.getAttribute('href'),
    ).toBe('https://eur-lex.europa.eu/eli/dir_dec/2020/1151/oj');
  });
});

// ---------------------------------------------------------------------------
// Honest states stay calm (regression guard for the restructured section)
// ---------------------------------------------------------------------------

describe('AllowancesPage honest states', () => {
  it('renders the not-found empty state without the caps section', async () => {
    await renderAllowancesPage({ kind: 'not-found' });

    expect(
      screen.getByText('Ei julkaistua versiota tälle päivälle'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('allowances-evidence-disclosure'),
    ).not.toBeInTheDocument();
  });

  it('renders the unavailable error state without the caps section', async () => {
    await renderAllowancesPage({ kind: 'unavailable' });

    expect(
      screen.getByText('Tietoja ei ole nyt saatavilla'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('allowances-evidence-disclosure'),
    ).not.toBeInTheDocument();
  });
});

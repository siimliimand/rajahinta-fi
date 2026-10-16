/**
 * llms.txt route tests (machine-readable-surfaces task 2.3, change
 * seo-aeo-agent-surfaces).
 *
 * Pins the agent-readable contract of `/llms.txt`
 * (`app/llms.txt/route.ts`): text/plain with an explicit charset, the
 * canonical header block (site name + the site metadata description
 * verbatim), the exact public-surface list — every URL absolute and
 * SITE_URL-rooted, the fi URLs in the localized routing vocabulary,
 * the /en variants of the main entries after the fi list — markdown
 * link shape, content-lint-clean copy, and a copy body free of
 * volatile figures (no digits, currency, or percent signs outside
 * URLs — the artifact must not drift with the 300 s price windows).
 *
 * @module LlmsTxtTest
 */

import { describe, expect, it } from 'vitest';
import { GET } from './llms.txt/route';
import { SITE_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';
import { checkContent } from '@/lib/content-policy';

/** The purpose line the route must reuse verbatim (fi Metadata.description). */
const PURPOSE =
  'Laske alkoholin todellinen kokonaishinta ulkomailta Suomeen: ' +
  'vähittäishinta, kuljetus ja valmistevero yhdessä. ' +
  'Puolueeton, läpinäkyvä ja ilmainen.';

/**
 * The full expected surface list, in document order: the fi catalog
 * with its six canonical category views first, then the calculator
 * family and the data/editorial surfaces, and the /en variants of the
 * main entries last (fi primary).
 */
const EXPECTED_URLS = [
  `${SITE_URL}/tuotteet`,
  `${SITE_URL}/tuotteet?category=beer`,
  `${SITE_URL}/tuotteet?category=wine_still`,
  `${SITE_URL}/tuotteet?category=wine_sparkling`,
  `${SITE_URL}/tuotteet?category=intermediate_products`,
  `${SITE_URL}/tuotteet?category=other_fermented`,
  `${SITE_URL}/tuotteet?category=spirits`,
  `${SITE_URL}/laskuri`,
  `${SITE_URL}/vertailu`,
  `${SITE_URL}/ostoskori`,
  `${SITE_URL}/matka`,
  `${SITE_URL}/tilaisuus`,
  `${SITE_URL}/skenaario`,
  `${SITE_URL}/grammahinta`,
  `${SITE_URL}/tullivapaat`,
  `${SITE_URL}/saastolista`,
  `${SITE_URL}/jarjestys`,
  `${SITE_URL}/oppaat`,
  `${SITE_URL}/blogi`,
  `${SITE_URL}/tietoja`,
  `${SITE_URL}/yhteystiedot`,
  `${SITE_URL}/ryhmatilaus`,
  `${SITE_URL}/en/products`,
  `${SITE_URL}/en/calculator`,
  `${SITE_URL}/en/guides`,
  `${SITE_URL}/en/about`,
];

/** The document's only non-link lines: the title, the purpose, the en header. */
const EXPECTED_COPY_LINES = ['# Rajahinta.fi', `> ${PURPOSE}`, '## English'];

/** One markdown link line: `- [label](url)`. */
const LINK_LINE = /^- \[([^\]]+)\]\((\S+)\)$/;

/** Split the document into its structural copy lines and its links. */
function parseLines(text: string): {
  copyLines: string[];
  links: Array<{ label: string; url: string }>;
} {
  const copyLines: string[] = [];
  const links: Array<{ label: string; url: string }> = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const match = LINK_LINE.exec(line);
    if (match) links.push({ label: match[1], url: match[2] });
    else copyLines.push(line);
  }
  return { copyLines, links };
}

/** The bare-fi pathnames the routing vocabulary serves. */
const FI_PATHNAMES = new Set<string>(
  Object.values(routing.pathnames).map((entry) =>
    typeof entry === 'string' ? entry : entry.fi,
  ),
);

describe('llms.txt route (task 2.3)', () => {
  it('serves 200 text/plain; charset=utf-8', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    await expect(res.text()).resolves.toContain('# Rajahinta.fi');
  });

  it('opens with the site name and the canonical fi purpose line, verbatim', async () => {
    const text = await GET().text();
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Rajahinta.fi');
    expect(lines[2]).toBe(`> ${PURPOSE}`);
  });

  it('lists exactly the public surfaces, fi first, /en main entries last', async () => {
    const { links } = parseLines(await GET().text());

    // Exact sequence: no extras, no duplicates, fi primary ordering.
    expect(links.map((link) => link.url)).toEqual(EXPECTED_URLS);
  });

  it('every URL is absolute and rooted at SITE_URL', async () => {
    const { links } = parseLines(await GET().text());
    expect(links.length).toBeGreaterThan(0);

    for (const { url } of links) {
      const parsed = new URL(url);
      expect(parsed.protocol, `${url} is https`).toBe('https:');
      expect(parsed.origin, `${url} sits on SITE_URL`).toBe(SITE_URL);
    }
  });

  it('every fi URL serves in the localized routing vocabulary — no bare internal route names', async () => {
    const { links } = parseLines(await GET().text());

    for (const { url } of links) {
      const { pathname } = new URL(url);
      if (pathname.startsWith('/en/')) continue;
      expect(
        FI_PATHNAMES.has(pathname),
        `${url} uses the localized fi segment`,
      ).toBe(true);
    }
  });

  it('every entry is a markdown link; the only other lines are the header block', async () => {
    const text = await GET().text();
    const { copyLines } = parseLines(text);

    expect([...copyLines].sort()).toEqual([...EXPECTED_COPY_LINES].sort());
  });

  it('the copy passes the content policy — no banned or advice vocabulary', async () => {
    const text = await GET().text();
    const { links } = parseLines(text);

    expect(checkContent(text), 'the document lints clean').toEqual([]);
    for (const { label } of links) {
      expect(checkContent(label), `label ${label} lints clean`).toEqual([]);
    }
  });

  it('no volatile figures: the copy carries no digits, currency, or percent signs', async () => {
    const { copyLines, links } = parseLines(await GET().text());

    // Long-lived artifact: no prices, percentages, dates, or counts —
    // nothing digit-bearing outside the URLs themselves.
    for (const line of copyLines) {
      expect(line, `copy line carries no figures: ${line}`).not.toMatch(
        /[\d€%]/,
      );
    }
    for (const { label } of links) {
      expect(label, `label carries no figures: ${label}`).not.toMatch(/[\d€%]/);
    }
  });
});

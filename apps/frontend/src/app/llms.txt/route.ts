/**
 * `/llms.txt` route (machine-readable-surfaces task 2.3, change
 * seo-aeo-agent-surfaces) — a plain-text index of the public surfaces
 * for answer engines and agents, in the llms.txt convention: the site
 * name, a one-line purpose, then a markdown-style link list with
 * absolute URLs.
 *
 * Content contract (spec: llms.txt index of public surfaces):
 *  - every URL is absolute, composed from SITE_URL over the localized
 *    routing vocabulary — fi serves the localized segments bare, the
 *    listed /en variants keep the internal route names;
 *  - the copy reuses the existing vocabulary verbatim — the site
 *    metadata description as the purpose line, the header/footer link
 *    labels, and the canonical category labels; no new phrasing;
 *  - no volatile figures: no prices, percentages, dates, or counts —
 *    the artifact is long-lived and must not drift with the 300 s
 *    price windows;
 *  - the copy passes the content lint (no advice phrasing, no
 *    promotional vocabulary) — pinned by the route tests.
 *
 * A pure static template: no data reads, nothing that can drift, so
 * the route needs no ISR window — Next prerenders it at build time.
 *
 * @module LlmsTxtRoute
 */

import { SITE_URL } from '@/lib/api';

/** One listed surface: the established display label and its path in
 *  the URL space of its section (fi vocabulary bare, or /en-prefixed). */
type Surface = readonly [label: string, path: string];

/**
 * The public fi surfaces, in the catalog-first order of the change
 * task: the products catalog with its six canonical category views,
 * the calculator family, then the data and editorial surfaces. The
 * labels are the header/footer link vocabulary and the canonical
 * category labels, verbatim.
 */
const FI_SURFACES: readonly Surface[] = [
  ['Tuotteet', '/tuotteet'],
  ['Olut', '/tuotteet?category=beer'],
  ['Makuuviini', '/tuotteet?category=wine_still'],
  ['Kuohuviini', '/tuotteet?category=wine_sparkling'],
  ['Välituotteet (esim. vermutti)', '/tuotteet?category=intermediate_products'],
  ['Siideri ja pitkäjuoma', '/tuotteet?category=other_fermented'],
  ['Väkevät alkoholijuomat', '/tuotteet?category=spirits'],
  ['Laskuri', '/laskuri'],
  ['Vertailu', '/vertailu'],
  ['Ostoskori', '/ostoskori'],
  ['Matkalaskuri', '/matka'],
  ['Tilaisuuslaskuri', '/tilaisuus'],
  ['Skenaariolaskuri', '/skenaario'],
  ['Etanolin grammahinta (snt/g)', '/grammahinta'],
  ['Tullivapaat määrät', '/tullivapaat'],
  ['Säästölista', '/saastolista'],
  ['Järjestysperiaatteet', '/jarjestys'],
  ['Oppaat', '/oppaat'],
  ['Blogi', '/blogi'],
  ['Tietoja Rajahinta.fi:stä', '/tietoja'],
  ['Yhteystiedot', '/yhteystiedot'],
  ['Ryhmätilaus', '/ryhmatilaus'],
];

/**
 * The /en variants of the main entries — the surfaces the change spec
 * names for the index. fi stays primary: the English list follows the
 * Finnish one.
 */
const EN_MAIN_SURFACES: readonly Surface[] = [
  ['Products', '/en/products'],
  ['Calculator', '/en/calculator'],
  ['Guides', '/en/guides'],
  ['About Rajahinta.fi', '/en/about'],
];

/** The canonical one-line purpose — the site metadata description,
 *  verbatim (the fi Metadata.description in messages/fi.json). */
const PURPOSE =
  'Laske alkoholin todellinen kokonaishinta ulkomailta Suomeen: ' +
  'vähittäishinta, kuljetus ja valmistevero yhdessä. ' +
  'Puolueeton, läpinäkyvä ja ilmainen.';

/** One markdown link line with an absolute URL. */
function link([label, path]: Surface): string {
  return `- [${label}](${SITE_URL}${path})`;
}

/** The document: site name, purpose, the fi list, the en main entries. */
const LLMS_TXT = [
  '# Rajahinta.fi',
  '',
  `> ${PURPOSE}`,
  '',
  ...FI_SURFACES.map(link),
  '',
  '## English',
  '',
  ...EN_MAIN_SURFACES.map(link),
  '',
].join('\n');

export function GET(): Response {
  return new Response(LLMS_TXT, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

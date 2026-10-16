/**
 * Product FAQPage structured-data builder (seo-aeo-agent-surfaces 2.2).
 *
 * Pure, typed function over the panel's already-composed Q&A pairs —
 * no fetches, no translator, no locale resolution — so the graph is a
 * STRUCTURAL MIRROR of the visible block, never a DOM scrape: the
 * caller passes exactly the array `composeProductFaqPairs` returned
 * (ProductFaqPanel.tsx, task 2.1's seam), and the builder maps each
 * pair to one schema.org Question/Answer, in order. The schema can
 * therefore never exceed the visible content — no invisible or extra
 * schema content is representable through this seam.
 *
 * The absence principle at the graph level: zero pairs → `null`, the
 * typed "no FAQPage node" outcome. The spec allows the FAQPage graph
 * ONLY when a Q&A block is rendered, so an empty block has no graph at
 * all — never an empty mainEntity shell for a crawler to quote.
 *
 * There is deliberately no `url`/`datePublished`/`headline` dressing:
 * every property here traces one-to-one to a rendered string, and
 * nothing else (the house "no property fabricated to fill the graph"
 * rule). The panel renders the graph inside its own Suspense boundary
 * (design D2), beside the visible block, so the schema streams with
 * the pairs it mirrors and both route adapters inherit it through the
 * shared product-page module.
 *
 * @module LibSeoProductFaqStructuredData
 */

/**
 * One rendered question/answer pair — the structural shape of the
 * panel's exported `ProductFaqPair` (task 2.1's seam currency), kept
 * structurally identical here so lib/seo stays decoupled from the app
 * tree while TypeScript still pins the seam.
 */
export interface FaqPair {
  readonly question: string;
  readonly answer: string;
}

/** One schema.org Question with its single accepted Answer. */
export interface JsonLdQuestion {
  readonly '@type': 'Question';
  readonly name: string;
  readonly acceptedAnswer: { readonly '@type': 'Answer'; readonly text: string };
}

/** The FAQPage graph — the pair list and nothing else. */
export interface FaqPageJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'FAQPage';
  readonly mainEntity: readonly JsonLdQuestion[];
}

/**
 * Map the composed pairs onto the FAQPage graph one-to-one, in the
 * same order. `null` when the block is empty — the caller renders no
 * `application/ld+json` script at all (absent, never an empty shell).
 */
export function buildProductFaqJsonLd(
  pairs: readonly FaqPair[],
): FaqPageJsonLd | null {
  if (pairs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((pair) => ({
      '@type': 'Question',
      name: pair.question,
      acceptedAnswer: { '@type': 'Answer', text: pair.answer },
    })),
  };
}

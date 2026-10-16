/**
 * FAQPage structured-data builder tests (seo-aeo-agent-surfaces 2.2).
 *
 * Pure unit tests over the lib/seo builder — the graph-level contract:
 * one Question per composed pair, one-to-one and in order, and the
 * absence principle at the graph level (zero pairs → null, the typed
 * "no FAQPage node" outcome — never an empty mainEntity shell). The
 * exact-key assertions pin "no invisible or extra schema content":
 * the graph carries the pairs and nothing else.
 *
 * The one-to-one equality against the RENDERED block (the spec
 * scenario) is pinned at the surface level in ProductFaqPanel.test.tsx,
 * where the same composed array is both rendered and mirrored.
 *
 * @module ProductFaqStructuredDataTest
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildProductFaqJsonLd,
  type FaqPageJsonLd,
} from '../product-faq-structured-data';

const FI_PAIRS = [
  {
    question: 'Paljonko Kotikalja 0.5 l maksaa?',
    answer: 'Matalin nykyinen myyntihinta on 19,99\u00a0€.',
  },
  {
    question: 'Kuinka paljon alkoholia Kotikalja 0.5 l sisältää?',
    answer: 'Alkoholipitoisuus on 4.7 %.',
  },
  {
    question: 'Minkäkokoinen pakkaus tuotteella on?',
    answer: 'Pakkauskoko on 50 cl.',
  },
] as const;

describe('buildProductFaqJsonLd', () => {
  it('maps the composed pairs one-to-one onto Question/Answer nodes, in the same order', () => {
    const graph = buildProductFaqJsonLd(FI_PAIRS);

    expect(graph).not.toBeNull();
    expect(graph?.['@context']).toBe('https://schema.org');
    expect(graph?.['@type']).toBe('FAQPage');
    expect(graph?.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'Paljonko Kotikalja 0.5 l maksaa?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Matalin nykyinen myyntihinta on 19,99\u00a0€.',
        },
      },
      {
        '@type': 'Question',
        name: 'Kuinka paljon alkoholia Kotikalja 0.5 l sisältää?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Alkoholipitoisuus on 4.7 %.',
        },
      },
      {
        '@type': 'Question',
        name: 'Minkäkokoinen pakkaus tuotteella on?',
        acceptedAnswer: { '@type': 'Answer', text: 'Pakkauskoko on 50 cl.' },
      },
    ]);
    // Order is the mirror: index i of the graph is index i of the block.
    expect(graph?.mainEntity.map((q) => q.name)).toEqual(
      FI_PAIRS.map((pair) => pair.question),
    );
  });

  it('carries the pairs and NOTHING else — no invisible or extra schema content', () => {
    const graph = buildProductFaqJsonLd(FI_PAIRS);
    expect(graph).not.toBeNull();

    expect(Object.keys(graph as object).sort()).toEqual([
      '@context',
      '@type',
      'mainEntity',
    ]);
    for (const question of (graph as FaqPageJsonLd).mainEntity) {
      expect(Object.keys(question).sort()).toEqual([
        '@type',
        'acceptedAnswer',
        'name',
      ]);
      expect(Object.keys(question.acceptedAnswer).sort()).toEqual([
        '@type',
        'text',
      ]);
    }
  });

  it('returns null for zero pairs — no FAQPage node, never an empty shell', () => {
    expect(buildProductFaqJsonLd([])).toBeNull();
  });

  it('mirrors a single pair (the minimum rendered block) without dressing', () => {
    const graph = buildProductFaqJsonLd([
      { question: 'Minkäkokoinen pakkaus tuotteella on?', answer: 'Pakkauskoko on 50 cl.' },
    ]);
    expect(graph).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Minkäkokoinen pakkaus tuotteella on?',
          acceptedAnswer: { '@type': 'Answer', text: 'Pakkauskoko on 50 cl.' },
        },
      ],
    });
  });

  it('is deterministic — identical pairs build an identical graph', () => {
    expect(buildProductFaqJsonLd(FI_PAIRS)).toEqual(
      buildProductFaqJsonLd(FI_PAIRS),
    );
  });
});

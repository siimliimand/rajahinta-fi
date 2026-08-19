'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RankingMethodology, SortOrder } from '@/lib/types';
import { getRankingMethodology } from '@/lib/api';
import {
  SORT_ORDER_DESCRIPTIONS,
  SORT_LABEL,
} from '@/lib/ranking-descriptions';

// ---------------------------------------------------------------------------
// Neutrality enforcement explanation
// ---------------------------------------------------------------------------

/**
 * Plain-language description of the neutrality enforcement,
 * matching `RankingService.getRankingMethodology()`.
 */
const NEUTRALITY_STATEMENT =
  'Rajahinta uses only objective, non-commercial factors to sort ' +
  "products. No merchant payment, promotional flag, or manual boost " +
  "can affect any product's position.";

const TIEBREAKER_STATEMENT =
  'All sort orders use the product name as a tiebreaker when the ' +
  'primary sort values are equal. Rankings are deterministic: the ' +
  'same data always produces the same order.';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Public ranking methodology page.
 *
 * Documents how product sorting works in plain language, generated from
 * descriptions that are kept in lockstep with the Ranking & Sorting module.
 * Explains that all rankings are objective and no paid placement exists.
 */
export default function RankingPage() {
  const [apiData, setApiData] = useState<RankingMethodology | null>(null);
  const [apiLoaded, setApiLoaded] = useState(false);

  // Try to fetch from API; fall back to embedded data
  useEffect(() => {
    async function fetchMethodology() {
      const data = await getRankingMethodology();
      setApiData(data);
      setApiLoaded(true);
    }
    fetchMethodology();
  }, []);

  // Decide whether to show API data or embedded data
  const showApi = apiLoaded && apiData !== null && apiData.sortOrders.length > 0;

  const sortOrders: Array<{ name: SortOrder; label: string; description: string }> = (
    showApi
      ? apiData!.sortOrders.map((s) => ({
          name: s.name,
          label: s.name.replace(/_/g, ' ').toLowerCase(),
          description: s.description,
        }))
      : (Object.keys(SORT_ORDER_DESCRIPTIONS) as SortOrder[]).map((key) => ({
          name: key,
          label: SORT_LABEL[key],
          description: SORT_ORDER_DESCRIPTIONS[key],
        }))
  );

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Navigation ── */}
      <nav className="mb-6">
        <Link
          href="/"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; Home
        </Link>
      </nav>

      {/* ── Title ── */}
      <h1 className="mb-2 text-2xl font-bold text-primary-700">
        How ranking works
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        Objective, transparent, and free of commercial influence.
      </p>

      {/* ── Neutrality statement ── */}
      <section className="mb-8 rounded-lg border border-green-200 bg-green-50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-green-800">
          Neutrality guarantee
        </h2>
        <p className="text-sm leading-relaxed text-green-700">
          {showApi
            ? apiData!.introduction
            : NEUTRALITY_STATEMENT}
        </p>
      </section>

      {/* ── Sort orders ── */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Available sort orders
        </h2>

        {!apiLoaded && (
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="mb-1 h-4 w-1/3 rounded bg-gray-200" />
                <div className="h-3 w-5/6 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        )}

        {apiLoaded && (
          <div className="space-y-3">
            {sortOrders.map((order) => (
              <article
                key={order.name}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <h3 className="text-sm font-medium text-gray-900">
                  {order.label}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                  {order.description}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Tiebreaker and determinism ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          Tiebreaker &amp; determinism
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {showApi && apiData!.tiebreaker
            ? apiData!.tiebreaker
            : TIEBREAKER_STATEMENT}
        </p>
        {showApi && (
          <p className="mt-2 text-xs text-gray-400">
            Deterministic: {apiData!.deterministic ? 'Yes' : 'No'}
          </p>
        )}
      </section>

      {/* ── Technical enforcement ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          How neutrality is enforced
        </h2>
        <div className="space-y-3 text-xs leading-relaxed text-gray-600">
          <p>
            The ranking module accepts only a tight input type called
            <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
              NeutralSortInput
            </code>
            which contains no field for paid placement, promotional boost,
            merchant scoring, or any form of manual curation.
          </p>
          <p>
            Three enforcement layers protect this guarantee:
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              <strong className="text-gray-700">Type-system boundary</strong>
              &mdash; the sort function only accepts
              <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono">
                NeutralSortInput
              </code>
              , a tight interface with only the fields needed for sorting.
            </li>
            <li>
              <strong className="text-gray-700">Compile-time assertion</strong>
              &mdash; a type-level test proves that an object with a
              <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono">
                paidBoost
              </code>
              field is not assignable to NeutralSortInput.
            </li>
            <li>
              <strong className="text-gray-700">Runtime guard</strong>
              &mdash; the sort function rejects any input object with
              properties not declared on NeutralSortInput, catching
              accidental data leakage at runtime.
            </li>
          </ol>
        </div>
      </section>

      {/* ── Footer ── */}
      <nav className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/calculator"
          className="inline-flex items-center rounded-md bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          Open calculator
        </Link>
        <Link
          href="/compare"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Compare products
        </Link>
      </nav>
    </main>
  );
}
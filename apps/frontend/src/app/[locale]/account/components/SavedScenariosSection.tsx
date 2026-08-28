'use client';

/**
 * SavedScenariosSection — the user's saved scenario list for the account
 * page (task 4.1, change phase2-advanced-features).
 *
 * Behaviour:
 *  - `enable_advanced_features` off ⇒ the section renders nothing and the
 *    scenario list request is never fired. The flag state arrives with
 *    the initial HTML payload, so the section's visibility is correct on
 *    the first render — no late appearance.
 *  - Scenarios are listed factually: name, resolved product (name or ID),
 *    quantity, destination, and last-updated timestamp. Loading happens on
 *    the calculator page, so no load action is offered here.
 *  - Product names are resolved with a single by-IDs search request; a
 *    scenario whose product no longer resolves degrades to showing its
 *    product ID (the calculator surfaces not-found on load).
 *
 * @module SavedScenariosSection
 */

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { SavedScenario } from '@/lib/types';
import { fetchProductsByIds, listScenarios } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';

/** Render an ISO timestamp with the fi-FI locale conventions used elsewhere. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('fi-FI', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export default function SavedScenariosSection() {
  const t = useTranslations('SavedScenarios');
  // Flag state is inlined with the initial HTML payload (task 9.4).
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.ADVANCED_FEATURES;
  const [scenarios, setScenarios] = useState<readonly SavedScenario[]>([]);
  const [productNames, setProductNames] = useState<
    Readonly<Record<number, string>>
  >({});

  // ── Load the scenario list when the flag is on ──
  useEffect(() => {
    if (!flagEnabled) return;
    let cancelled = false;

    (async () => {
      try {
        const rows = await listScenarios();
        if (cancelled) return;
        setScenarios(rows);

        // Resolve product names for display in one request; unresolved
        // IDs fall back to "#<id>" below.
        const ids = [...new Set(rows.map((s) => s.inputs.productId))];
        if (ids.length > 0) {
          const search = await fetchProductsByIds(ids);
          if (cancelled) return;
          const names: Record<number, string> = {};
          for (const item of search.items) {
            names[item.id] = item.name;
          }
          setProductNames(names);
        }
      } catch {
        // The list is non-critical; render the empty state.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flagEnabled]);

  // ── Hidden state: flag off in the inlined payload ──
  if (!flagEnabled) {
    return null;
  }

  return (
    <section
      id="saved-scenarios"
      className="mb-8 scroll-mt-16 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      data-testid="saved-scenarios-section"
    >
      <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('body')}</p>

      {scenarios.length === 0 ? (
        <div className="mt-6 rounded-md bg-gray-50 p-4 text-center text-sm text-gray-500">
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="mt-1">
            {t.rich('emptyBody', {
              link: (chunks) => (
                <Link
                  href="/calculator"
                  className="text-primary-600 hover:text-primary-800"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {scenarios.map((scenario) => (
            <li
              key={scenario.id}
              className="flex items-center justify-between py-3"
              data-testid="saved-scenario-row"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {scenario.name}
                </p>
                <p className="text-xs text-gray-500">
                  {productNames[scenario.inputs.productId] ??
                    t('product', { id: scenario.inputs.productId })}
                  {' · '}
                  {t('unitCount', { count: scenario.inputs.quantity })}
                  {' · '}
                  {scenario.inputs.destination}
                </p>
                <p className="text-xs text-gray-400">
                  {t('updated', { date: formatTimestamp(scenario.updatedAt) })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

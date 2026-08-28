'use client';

/**
 * DeclarationGuidancePanel — collapsible declaration guidance for the
 * calculator result detail page (task 4.4, change phase2-advanced-features).
 *
 * Behaviour:
 *  - `enable_advanced_features` off ⇒ the panel renders nothing and the
 *    declaration request is never fired (guard-before-fetch, same pattern
 *    as ProductHistoryPanel). A failed flag lookup also degrades to hidden.
 *  - Fed by GET /api/v1/declaration/:recordId. A response without the
 *    `guidance` field (flag flipped off server-side) renders nothing.
 *  - Checklist and caveat strings are rendered verbatim — the observed
 *    pattern phrasing from the API is never reworded client-side.
 *  - A PREMIUM entitlement failure (403 error 'InsufficientEntitlement')
 *    surfaces a controlled-vocabulary message instead of a crash; other
 *    failures hide the panel (informational, read-only).
 *  - The standing disclaimer from the response is visible inside the panel
 *    (structural, never presentation-only).
 *
 * @module DeclarationGuidancePanel
 */

import React, { useEffect, useState } from 'react';
import type {
  DeclarationAppliedRateDetail,
  DeclarationSummaryResponse,
} from '@/lib/types';
import {
  ApiFetchError,
  classifyReportError,
  getDeclarationSummary,
  getFeatureFlags,
} from '@/lib/api';
import DisclaimerBanner from './DisclaimerBanner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_KIND_LABEL: Record<DeclarationAppliedRateDetail['kind'], string> = {
  alcoholExcise: 'Alcohol excise',
  containerDuty: 'Container duty',
};

type FlagState = 'checking' | 'enabled' | 'disabled';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format euro-cents as a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Format an applied rate (EUR per unit) with its unit, e.g. "€0.52 per litre of product". */
function formatRate(ratePerUnit: number, rateUnit: string): string {
  return `€${ratePerUnit} per ${rateUnit}`;
}

/** Format an ISO timestamp with the fi-FI locale conventions used elsewhere. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('fi-FI');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** One applied-duty line of the derivation walkthrough. */
function AppliedRateLine({ rate }: { rate: DeclarationAppliedRateDetail }) {
  const provenance: string[] = [];
  if (rate.ratePerUnit !== null && rate.rateUnit !== null) {
    provenance.push(formatRate(rate.ratePerUnit, rate.rateUnit));
  }
  if (rate.ruleVersionLabel !== null) {
    provenance.push(`Rule version ${rate.ruleVersionLabel}`);
  }
  if (rate.formulaExpression !== null) {
    provenance.push(rate.formulaExpression);
  }

  return (
    <li className="py-1.5" data-testid="guidance-applied-rate">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-700">
          {RATE_KIND_LABEL[rate.kind]}
        </span>
        <span className="text-sm tabular-nums text-gray-600">
          {formatEur(rate.amountCents)}
        </span>
      </div>
      {provenance.length > 0 && (
        <p className="mt-0.5 text-xs text-gray-400">
          {provenance.join(' · ')}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DeclarationGuidancePanelProps {
  /** Persisted calculation record the guidance is derived from. */
  readonly recordId: number;
}

export default function DeclarationGuidancePanel({
  recordId,
}: DeclarationGuidancePanelProps) {
  const [flag, setFlag] = useState<FlagState>('checking');
  const [summary, setSummary] = useState<DeclarationSummaryResponse | null>(
    null,
  );
  const [needsSubscription, setNeedsSubscription] = useState(false);

  // ── Feature flag: hide and skip the declaration request when off ──
  useEffect(() => {
    let cancelled = false;
    getFeatureFlags()
      .then((res) => {
        if (cancelled) return;
        setFlag(res.flags.ADVANCED_FEATURES ? 'enabled' : 'disabled');
      })
      .catch(() => {
        // Flag state unreachable — degrade as if disabled.
        if (!cancelled) setFlag('disabled');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Declaration fetch — guarded by the flag, never fired when disabled ──
  useEffect(() => {
    if (flag !== 'enabled') return;
    let cancelled = false;

    getDeclarationSummary(recordId)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An entitlement rejection (403 InsufficientEntitlement) gets the
        // controlled-vocabulary message; everything else hides the panel.
        if (
          err instanceof ApiFetchError &&
          classifyReportError(err).kind === 'entitlement'
        ) {
          setNeedsSubscription(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [flag, recordId]);

  // ── Hidden states: flag off/checking, hidden failures, or no guidance ──
  if (flag !== 'enabled') {
    return null;
  }

  if (needsSubscription) {
    return (
      <section
        className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        data-testid="declaration-guidance-locked"
      >
        <h2 className="text-sm font-semibold text-gray-700">
          Declaration guidance
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Declaration guidance requires an upgraded subscription.
        </p>
      </section>
    );
  }

  if (summary === null || summary.guidance === undefined) {
    return null;
  }

  const { derivation, deadline, checklist, caveats, officialSources } =
    summary.guidance;

  return (
    <section
      className="mt-6 rounded-lg border border-gray-200 bg-white shadow-sm"
      data-testid="declaration-guidance-panel"
    >
      <details className="group">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-gray-700 marker:hidden">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">
            &rsaquo;
          </span>
          Declaration guidance
        </summary>

        <div className="space-y-5 border-t border-gray-100 px-5 py-4">
          {/* ── Derivation walkthrough ── */}
          <div data-testid="guidance-derivation">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              How the estimate was derived
            </h3>
            <dl className="space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Category</dt>
                <dd>{derivation.category}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Alcohol by volume</dt>
                <dd className="tabular-nums">{derivation.abvPercent}%</dd>
              </div>
              <div className="flex justify-between">
                <dt>Volume per unit</dt>
                <dd className="tabular-nums">
                  {derivation.volumePerUnitLitres.toFixed(3)} L
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Quantity</dt>
                <dd className="tabular-nums">
                  {derivation.quantity}{' '}
                  {derivation.quantity === 1 ? 'unit' : 'units'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Total volume</dt>
                <dd className="tabular-nums">
                  {derivation.totalVolumeLitres.toFixed(3)} L
                </dd>
              </div>
            </dl>
            <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-100 px-3 py-1">
              {derivation.appliedRates.map((rate, i) => (
                <AppliedRateLine
                  key={`${rate.kind}-${i}`}
                  rate={rate}
                />
              ))}
            </ul>
          </div>

          {/* ── Advance-notice deadline ── */}
          <div data-testid="guidance-deadline">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Advance-notice deadline
            </h3>
            {deadline.required ? (
              <div className="space-y-1 text-xs text-gray-500">
                <p>
                  Advance notice to customs is required for this
                  classification.
                </p>
                <p>
                  {deadline.dueDate !== null
                    ? `Due ${deadline.dueDate}`
                    : 'Due date could not be determined from the calculation timestamp.'}
                  {deadline.deadlineDays !== null
                    ? ` — ${deadline.deadlineDays} days from ${formatTimestamp(deadline.calculatedFrom)}`
                    : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Advance notice is not required for this classification.
              </p>
            )}
          </div>

          {/* ── MyTax entry checklist — API phrasing verbatim ── */}
          <div data-testid="guidance-checklist">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Checklist
            </h3>
            <ol className="list-inside list-decimal space-y-1 text-xs text-gray-600">
              {checklist.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          </div>

          {/* ── Caveats — API phrasing verbatim ── */}
          {caveats.length > 0 && (
            <div data-testid="guidance-caveats">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Caveats
              </h3>
              <ul className="list-inside list-disc space-y-1 text-xs text-gray-600">
                {caveats.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Official sources ── */}
          {officialSources.length > 0 && (
            <div data-testid="guidance-sources">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Official sources
              </h3>
              <ul className="space-y-1 text-xs">
                {officialSources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 underline hover:text-primary-800"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Standing disclaimer — structural, always visible in the panel ── */}
          <DisclaimerBanner disclaimer={summary.disclaimer} />
        </div>
      </details>
    </section>
  );
}

'use client';

/**
 * DeclarationGuidancePanel — collapsible declaration guidance for the
 * calculator result detail page (task 4.4, change phase2-advanced-features;
 * dated walkthrough added by import-filing-assistant task 2.4).
 *
 * Behaviour:
 *  - Fed by GET /api/v1/declaration/:recordId. A response without the
 *    `guidance` field renders nothing.
 *  - Checklist and caveat strings are rendered verbatim — the observed
 *    pattern phrasing from the API is never reworded client-side.
 *  - An entitlement failure (403 error 'InsufficientEntitlement')
 *    surfaces a controlled-vocabulary message instead of a crash; other
 *    failures hide the panel (informational, read-only).
 *  - The standing disclaimer from the response is visible inside the panel
 *    (structural, never presentation-only).
 *
 * Dated pre-dispatch walkthrough (import-filing-assistant Stage 1, D2/D4/D5):
 *  - A planned dispatch date is a request parameter (never persisted); a
 *    complete yyyy-mm-dd input refetches the guidance with the
 *    `dispatchDate` query param.
 *  - The dated checklist, its cited steps (including the reference-number
 *    step), the guarantee line, the return-due estimate, and the
 *    post-deadline copy all render from the response — the hedged
 *    post-deadline wording is never locally invented.
 *  - Honest degraded states (spec): an unavailable guarantee renders no
 *    line, an uncited step renders nothing, an absent date renders the
 *    undated checklist without deadline or countdown, and a response that
 *    predates `datedChecklist` renders nothing new. No skeletons imply
 *    data that is not there.
 *
 * @module DeclarationGuidancePanel
 */

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type {
  DeclarationAppliedRateDetail,
  DeclarationDatedChecklist,
  DeclarationFilingProcessCitation,
  DeclarationFilingStep,
  DeclarationSummaryResponse,
  ReliabilityStatus,
} from '@/lib/types';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import { ReliabilityBadge } from '@/components/ui';
import {
  ApiFetchError,
  classifyReportError,
  getDeclarationSummary,
} from '@/lib/api';
import DisclaimerBanner from './DisclaimerBanner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format euro-cents as a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Format an applied rate (EUR per unit) with its unit. */
function useRateFormatter(): (ratePerUnit: number, rateUnit: string) => string {
  const t = useTranslations('DeclarationGuidance');
  return (ratePerUnit: number, rateUnit: string) =>
    t('ratePerUnit', { rate: ratePerUnit, unit: rateUnit });
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
  const t = useTranslations('DeclarationGuidance');
  const formatRate = useRateFormatter();
  const provenance: string[] = [];
  if (rate.ratePerUnit !== null && rate.rateUnit !== null) {
    provenance.push(formatRate(rate.ratePerUnit, rate.rateUnit));
  }
  if (rate.ruleVersionLabel !== null) {
    provenance.push(t('ruleVersion', { version: rate.ruleVersionLabel }));
  }
  if (rate.formulaExpression !== null) {
    provenance.push(rate.formulaExpression);
  }

  return (
    <li className="py-1.5" data-testid="guidance-applied-rate">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-700">
          {t(`rateKind.${rate.kind}`)}
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
// Dated pre-dispatch walkthrough (import-filing-assistant task 2.4)
// ---------------------------------------------------------------------------

/** Localized reliability-status chip on the canonical D1/D2 hue ladder. */
function StatusChip({ status }: { status: ReliabilityStatus }) {
  const tRoot = useTranslations();
  return (
    <ReliabilityBadge status={status} size="sm">
      {tRoot(RELIABILITY_STATUS_META[status].labelKey)}
    </ReliabilityBadge>
  );
}

/** Inline citation links (official vero.fi pages) for one fact. */
function CitationLine({
  label,
  citations,
}: {
  label: string;
  citations: readonly DeclarationFilingProcessCitation[];
}) {
  return (
    <p className="mt-1 text-xs text-gray-400">
      {label}:{' '}
      {citations.map((citation, i) => (
        <React.Fragment key={citation.url}>
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 underline hover:text-primary-800"
          >
            {citation.title}
          </a>
          {i < citations.length - 1 ? ' · ' : ''}
        </React.Fragment>
      ))}
    </p>
  );
}

/**
 * One cited filing step. An uncited step renders NOTHING (spec: a step
 * whose fact is unverified never renders); the description is API text,
 * rendered verbatim.
 */
function FilingStepItem({ step }: { step: DeclarationFilingStep }) {
  const t = useTranslations('DeclarationGuidance');
  if (step.citations.length === 0) return null;
  return (
    <li className="py-2" data-testid="guidance-filing-step" data-step-kind={step.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-xs font-semibold text-gray-600">
          {t(`dated.stepLabel.${step.kind}`)}
        </span>
        {step.datedFor !== null && (
          <span className="text-xs tabular-nums text-gray-400">
            {t('dated.stepAnchor', { date: step.datedFor })}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
        {step.description}
      </p>
      <CitationLine label={t('dated.citationsLabel')} citations={step.citations} />
    </li>
  );
}

/** Props of the dated-checklist section (state lives in the panel). */
interface DatedChecklistSectionProps {
  readonly dated: DeclarationDatedChecklist;
  /** Raw controlled value of the dispatch-date input. */
  readonly dateInput: string;
  readonly onDateInputChange: (value: string) => void;
}

/**
 * The dated pre-dispatch walkthrough: dispatch-date input, the state line
 * (DATED / POST_DEADLINE / UNDATED), the cited steps, the guarantee line
 * (only when a figure is available — never a placeholder number), the
 * return-due estimate (dated states only), and the localized /guides
 * cross-link.
 */
function DatedChecklistSection({
  dated,
  dateInput,
  onDateInputChange,
}: DatedChecklistSectionProps) {
  const t = useTranslations('DeclarationGuidance');

  return (
    <div data-testid="guidance-dated-checklist">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('dated.heading')}
      </h3>

      {/* ── Dispatch-date input — a request parameter, never persisted ── */}
      <div className="mb-3">
        <label
          htmlFor="guidance-dispatch-date"
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          {t('dated.dateLabel')}
        </label>
        <input
          id="guidance-dispatch-date"
          type="date"
          name="dispatchDate"
          value={dateInput}
          onChange={(event) => onDateInputChange(event.target.value)}
          data-testid="guidance-dispatch-date"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
        />
        <p className="mt-1 text-xs text-gray-400">{t('dated.dateNote')}</p>
      </div>

      {/* ── State line ── */}
      {dated.state === 'DATED' && dated.plannedDate !== null && (
        <div
          data-testid="guidance-dated-state"
          className="mb-2 space-y-0.5 text-xs text-gray-500"
        >
          <p>{t('dated.plannedDate', { date: dated.plannedDate })}</p>
          {dated.deadlineSemantics === 'BEFORE_DISPATCH' && (
            <p>{t('dated.deadlineBeforeDispatch')}</p>
          )}
        </div>
      )}
      {dated.state === 'POST_DEADLINE' && dated.postDeadline !== null && (
        <div
          data-testid="guidance-post-deadline"
          className="mb-2 space-y-1 text-xs text-gray-500"
        >
          <p className="font-semibold text-gray-600">
            {t('dated.postDeadlineHeading')}
          </p>
          {/* Hedged passed-deadline copy from the API, verbatim (D5). */}
          <p>{dated.postDeadline.description}</p>
          <CitationLine
            label={t('dated.citationsLabel')}
            citations={dated.postDeadline.citations}
          />
        </div>
      )}
      {dated.state === 'UNDATED' && (
        <p className="mb-2 text-xs text-gray-400">{t('dated.undatedNote')}</p>
      )}

      {/* ── Ordered cited steps — uncited steps render nothing ── */}
      <ol className="divide-y divide-gray-100 rounded-md border border-gray-100 px-3 py-1">
        {dated.steps.map((step) => (
          <FilingStepItem key={step.kind} step={step} />
        ))}
      </ol>

      {/* ── Guarantee line — renders NOTHING when no figure exists ── */}
      {dated.guarantee.available && dated.guarantee.amountCents !== null && (
        <p
          data-testid="guidance-guarantee-line"
          className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600"
        >
          <span className="font-semibold">{t('dated.guaranteeLabel')}</span>
          <span className="tabular-nums">
            {formatEur(dated.guarantee.amountCents)}
          </span>
          <StatusChip status={dated.guarantee.status} />
        </p>
      )}

      {/* ── Return-due estimate — present only in the dated states ── */}
      {dated.returnDueEstimate !== null && (
        <p
          data-testid="guidance-return-due"
          className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600"
        >
          <span>
            {t('dated.returnDue', { date: dated.returnDueEstimate.dueDate })}
          </span>
          <StatusChip status={dated.returnDueEstimate.status} />
        </p>
      )}

      {/* ── /guides cross-link (locale-aware path via i18n navigation) ── */}
      <p className="mt-3 text-xs">
        <Link
          href={{ pathname: '/guides' }}
          data-testid="guidance-guides-link"
          className="text-primary-600 underline hover:text-primary-800"
        >
          {t('dated.guidesLink')}
        </Link>
      </p>
    </div>
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
  const t = useTranslations('DeclarationGuidance');
  const tCommon = useTranslations('Common');
  const [summary, setSummary] = useState<DeclarationSummaryResponse | null>(
    null,
  );
  const [needsSubscription, setNeedsSubscription] = useState(false);
  // Raw controlled value of the dispatch-date input. Only a complete
  // yyyy-mm-dd value is sent as the request parameter; anything else is
  // treated as absent (the server degrades it to the undated checklist).
  const [dateInput, setDateInput] = useState('');
  const dispatchDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput
    : null;

  // ── Declaration fetch on mount and on dispatch-date change ──
  useEffect(() => {
    let cancelled = false;

    getDeclarationSummary(recordId, dispatchDate)
      .then((res) => {
        if (cancelled) return;
        setSummary(res);
        setNeedsSubscription(false);
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
  }, [recordId, dispatchDate]);

  // ── Hidden state: entitlement rejection ──
  if (needsSubscription) {
    return (
      <section
        className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        data-testid="declaration-guidance-locked"
      >
        <h2 className="text-sm font-semibold text-gray-700">{t('title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('locked')}</p>
      </section>
    );
  }

  if (summary === null || summary.guidance === undefined) {
    return null;
  }

  const {
    derivation,
    deadline,
    liabilityNotice,
    checklist,
    caveats,
    officialSources,
    datedChecklist,
  } = summary.guidance;

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
          {t('title')}
        </summary>

        <div className="space-y-5 border-t border-gray-100 px-5 py-4">
          {/* ── Derivation walkthrough ── */}
          <div data-testid="guidance-derivation">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('derivationTitle')}
            </h3>
            <dl className="space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>{t('category')}</dt>
                <dd>{derivation.category}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{tCommon('abvLabel')}</dt>
                <dd className="tabular-nums">{derivation.abvPercent}%</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('volumePerUnit')}</dt>
                <dd className="tabular-nums">
                  {derivation.volumePerUnitLitres.toFixed(3)} L
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{tCommon('quantity')}</dt>
                <dd className="tabular-nums">
                  {t('unitCount', { count: derivation.quantity })}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('totalVolume')}</dt>
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
              {t('deadlineTitle')}
            </h3>
            {deadline.required ? (
              <div className="space-y-1 text-xs text-gray-500">
                <p>{t('deadlineRequired')}</p>
                <p>
                  {deadline.dueDate !== null
                    ? t('dueDate', { date: deadline.dueDate })
                    : t('dueDateUnknown')}
                  {deadline.deadlineDays !== null
                    ? t('deadlineDays', {
                        days: deadline.deadlineDays,
                        from: formatTimestamp(deadline.calculatedFrom),
                      })
                    : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">{t('deadlineNotRequired')}</p>
            )}
          </div>

          {/* ── Statutory obligations (1.9.2024 joint-liability reform) ──
              Wording comes from the message catalogs (counsel-approved
              formulations); this block only picks the entry matching the
              classification. Pre-reform records (liabilityNotice === null)
              get a note instead — they resolve under the older rule set. */}
          <div data-testid="guidance-obligations">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('obligations.heading')}
            </h3>
            {liabilityNotice === null ? (
              <p className="text-xs text-gray-500">
                {t('obligations.preReformNote')}
              </p>
            ) : (
              <dl className="space-y-2 text-xs text-gray-500">
                <div>
                  <dt className="font-semibold text-gray-600">
                    {t('obligations.advanceNoticeLabel')}
                  </dt>
                  <dd className="mt-0.5">
                    {t(
                      `obligations.${
                        liabilityNotice.classification === 'DistanceSelling'
                          ? 'distanceSelling'
                          : liabilityNotice.classification === 'DistanceBuying'
                            ? 'distanceBuying'
                            : 'travellerImport'
                      }.advanceNotice`,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">
                    {liabilityNotice.classification === 'DistanceSelling'
                      ? t('obligations.distanceSellingLiabilityLabel')
                      : t('obligations.liabilityLabel')}
                  </dt>
                  <dd className="mt-0.5">
                    {t(
                      `obligations.${
                        liabilityNotice.classification === 'DistanceSelling'
                          ? 'distanceSelling'
                          : liabilityNotice.classification === 'DistanceBuying'
                            ? 'distanceBuying'
                            : 'travellerImport'
                      }.liability`,
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* ── MyTax entry checklist — API phrasing verbatim ── */}
          <div data-testid="guidance-checklist">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('checklist')}
            </h3>
            <ol className="list-inside list-decimal space-y-1 text-xs text-gray-600">
              {checklist.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          </div>

          {/* ── Dated pre-dispatch walkthrough — renders nothing new until
              the response carries the datedChecklist field ── */}
          {datedChecklist !== undefined && (
            <DatedChecklistSection
              dated={datedChecklist}
              dateInput={dateInput}
              onDateInputChange={setDateInput}
            />
          )}

          {/* ── Caveats — API phrasing verbatim ── */}
          {caveats.length > 0 && (
            <div data-testid="guidance-caveats">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t('caveats')}
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
                {t('officialSources')}
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

'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import { Card, EmptyState } from '@/components/ui';
import { isWhatIfFlagEnabled } from './what-if-flag';
import {
  calculateWhatIfExcise,
  classifyWhatIfError,
  type WhatIfErrorKind,
} from './what-if.client';
import {
  buildScenarioRequest,
  draftRowsFromScenario,
  newProductDraft,
  type ProductDraft,
} from './scenario-draft';
import { decodeWhatIfShareToken } from './share-token';
import type { WhatIfResponse } from './what-if.types';
import WhatIfForm from './components/WhatIfForm';
import WhatIfResult from './components/WhatIfResult';

/**
 * Real-time recalculation vs the CALCULATOR rate limit (10/min) — the
 * deliberate reconciliation (task 8.3):
 *
 *   TRAILING-EDGE DEBOUNCE + EXPLICIT PENDING STATE. The client cannot
 *   interpolate between server results: the baseline excise is resolved
 *   server-side from the active rate dataset, so any client-side
 *   interpolation would reimplement rule resolution and break the
 *   explainability of every figure. Instead the form's edits coalesce —
 *   at most one request per {@link RECALCULATION_DEBOUNCE_MS} of quiet —
 *   and a visible pending line covers both the debounce window and the
 *   in-flight request. The first computation (mount, share-token
 *   prefill) runs immediately; updates to an existing result are
 *   debounced.
 *
 *   429 (CALCULATOR tripped) is a first-class state: the Retry-After
 *   figure drives a visible countdown, no request is sent while it
 *   runs, and when it reaches zero the latest draft is recomputed once
 *   automatically — the stale result never lingers silently and the
 *   user never has to guess when retrying is allowed.
 */
export const RECALCULATION_DEBOUNCE_MS = 800;

/** Next row key: `product-N`, skipping keys already present in the draft. */
function nextRowKey(rows: readonly ProductDraft[]): string {
  const used = new Set(rows.map((row) => row.key));
  let n = rows.length + 1;
  while (used.has(`product-${n}`)) n += 1;
  return `product-${n}`;
}

/**
 * What-if simulator page (task 8.3, change product-roadmap-phases-1-4).
 *
 * Behaviour:
 *  - `EXCISE_WHAT_IF` off ⇒ renders nothing (server-inlined flag state,
 *    design R13 — the trip/event gating treatment).
 *  - `?token=` from a share link is decoded READ-ONLY to prefill the
 *    scenario and trigger the first computation; an invalid token degrades
 *    to a calm note and a blank form, never a crash.
 *  - Edits recalculate through POST /api/v1/what-if/excise with the
 *    debounce/throttle discipline documented above.
 *  - The 200 body renders as per-product gap cards, totals, the dataset
 *    citation, and the structural HYPOTHETICAL disclaimer — rendered from
 *    the response, never a UI-only string.
 *
 * @module WhatIfPage
 */
export default function WhatIfPage() {
  const t = useTranslations('WhatIfPage');

  // ── Feature flags (server-resolved, inlined with the initial HTML) ──
  const flags = useFeatureFlags();
  const flagEnabled = isWhatIfFlagEnabled(flags);

  // ── Scenario draft ──
  const [rate, setRate] = useState(20);
  const [rows, setRows] = useState<ProductDraft[]>(() => [newProductDraft('product-1')]);
  const rowCounter = useRef(1);

  // ── Computation state ──
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [invalidInputs, setInvalidInputs] = useState(false);
  const [errorKind, setErrorKind] = useState<WhatIfErrorKind | null>(null);
  const [throttleSeconds, setThrottleSeconds] = useState<number | null>(null);
  const [invalidToken, setInvalidToken] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Latest-wins guard: a slow response from a superseded draft never
  // overwrites the result of a newer one.
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Set when a rate-limited run (or one suppressed by the countdown)
  // should be retried once the countdown clears.
  const awaitingRetryRef = useRef(false);

  // ── Share-token prefill (read-only decode, once on mount) ──
  useEffect(() => {
    // window read instead of useSearchParams: the token is consumed once,
    // and the page stays out of the Suspense-boundary prerender path.
    if (typeof window !== 'undefined') {
      const token = new URLSearchParams(window.location.search).get('token');
      if (token !== null) {
        try {
          const scenario = decodeWhatIfShareToken(token);
          const draft = draftRowsFromScenario(scenario);
          setRate(draft.rate);
          setRows(draft.rows);
          rowCounter.current = draft.rows.length;
        } catch {
          setInvalidToken(true);
        }
      }
    }
    setHydrated(true);
  }, []);

  // ── The recalculation itself ──
  const runRecalc = useCallback(async () => {
    const scenario = buildScenarioRequest(rate, rows);
    setInvalidInputs(scenario === null);
    if (scenario === null) {
      setRecalculating(false);
      return;
    }
    if (throttleSeconds !== null) {
      // Countdown running: suppress the request, remember the retry.
      awaitingRetryRef.current = true;
      setRecalculating(false);
      return;
    }

    seqRef.current += 1;
    const seq = seqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRecalculating(true);
    setErrorKind(null);
    try {
      const res = await calculateWhatIfExcise(scenario, controller.signal);
      if (seqRef.current !== seq) return; // superseded by a newer draft
      setResult(res);
    } catch (err: unknown) {
      if (seqRef.current !== seq) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      const { kind, retryAfterSeconds } = classifyWhatIfError(err);
      if (kind === 'rate-limited') {
        setThrottleSeconds(retryAfterSeconds ?? 60);
      } else {
        setErrorKind(kind);
      }
    } finally {
      if (seqRef.current === seq) setRecalculating(false);
    }
  }, [rate, rows, throttleSeconds]);

  // Debounced updates once a result exists; the first computation is immediate.
  const scheduleRecalc = useDebouncedCallback(() => {
    void runRecalc();
  }, RECALCULATION_DEBOUNCE_MS);

  const hasRunRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (!hasRunRef.current) {
      // The first computation (mount or token prefill) runs immediately —
      // there is nothing to coalesce yet. Every later draft change is
      // debounced, including after a failure, so editing can never fire
      // one request per keystroke.
      hasRunRef.current = true;
      void runRecalc();
    } else {
      setRecalculating(true);
      scheduleRecalc.run();
    }
    // runRecalc/scheduleRecalc identity tracks the draft; only draft
    // changes (and hydration) trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, rate, rows]);

  // ── Throttle countdown: tick each second, retry once at zero ──
  useEffect(() => {
    if (throttleSeconds === null) return;
    if (throttleSeconds <= 0) {
      setThrottleSeconds(null);
      return;
    }
    const timer = setTimeout(() => {
      setThrottleSeconds((seconds) => (seconds === null ? null : seconds - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [throttleSeconds]);

  useEffect(() => {
    if (throttleSeconds === null && awaitingRetryRef.current) {
      awaitingRetryRef.current = false;
      void runRecalc();
    }
    // Retry exactly on the countdown-clear transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throttleSeconds]);

  // Superseded in-flight requests must not touch state after unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Draft change handlers (mark the pending state immediately) ──
  const handleRateChange = useCallback((value: number) => {
    setRate(value);
  }, []);

  const handleRowChange = useCallback(
    (key: string, patch: Partial<Omit<ProductDraft, 'key'>>) => {
      setRows((current) =>
        current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const handleAddRow = useCallback(() => {
    setRows((current) => {
      if (current.length >= 20) return current;
      rowCounter.current += 1;
      return [...current, newProductDraft(nextRowKey(current))];
    });
  }, []);

  const handleRemoveRow = useCallback((key: string) => {
    setRows((current) =>
      current.length <= 1 ? current : current.filter((row) => row.key !== key),
    );
  }, []);

  const handleRecalculate = useCallback(() => {
    scheduleRecalc.cancel();
    void runRecalc();
  }, [runRecalc, scheduleRecalc]);

  // ── Hidden state: flag off in the inlined payload ──
  if (!flagEnabled) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Form ── */}
      <section className="mb-8">
        <Card>
          <WhatIfForm
            rate={rate}
            rows={rows}
            invalidNotice={invalidInputs && result !== null}
            throttled={throttleSeconds !== null}
            onRateChange={handleRateChange}
            onRowChange={handleRowChange}
            onAddRow={handleAddRow}
            onRemoveRow={handleRemoveRow}
            onRecalculate={handleRecalculate}
          />
        </Card>
      </section>

      {/* ── Invalid share token: calm note, blank form ── */}
      {invalidToken && (
        <p role="status" data-testid="what-if-invalid-token" className="mb-8 text-sm text-gray-500">
          {t('errors.invalidToken')}
        </p>
      )}

      {/* ── Pending: covers the debounce window and the in-flight request ── */}
      {recalculating && (
        <p role="status" data-testid="what-if-pending" className="mb-8 text-sm text-gray-500">
          {t('recalculating')}
        </p>
      )}

      {/* ── Throttled: countdown from the API's Retry-After ── */}
      {throttleSeconds !== null && (
        <p role="alert" data-testid="what-if-throttle" className="mb-8 text-sm text-red-600">
          {t('errors.throttled', { seconds: throttleSeconds })}
        </p>
      )}

      {/* ── Other classified failures ── */}
      {errorKind !== null && (
        <p role="alert" className="mb-8 text-sm text-red-600">
          {t(`errors.${errorKind}`)}
        </p>
      )}

      {/* ── Result: prominent disclaimer + gap cards + totals + share ── */}
      {result && <WhatIfResult result={result} />}

      {/* ── Initial state: nothing computed yet, the draft is not valid ── */}
      {!result && !recalculating && invalidInputs && errorKind === null && throttleSeconds === null && (
        <div className="mb-8">
          <EmptyState title={t('empty.title')} description={t('empty.body')} />
        </div>
      )}
    </main>
  );
}

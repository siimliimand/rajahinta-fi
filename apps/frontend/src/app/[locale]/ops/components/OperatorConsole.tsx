'use client';

/**
 * OperatorConsole — the operator console UI (task 12.1, change
 * technical-assessment-remediation).
 *
 * Minimal functional console for the three human workflows: governance
 * permission grants, tax-rate/FX dataset-version confirmation, and the
 * correction queue, with the durable audit trail visible per action.
 *
 * Phase 1 auth model (documented future work: interactive login): the
 * operator pastes the realm's bearer token into a field; it lives only in
 * component state and is sent as the Authorization header. The backend's
 * OpsAccessGuard enforces the token + IP allowlist regardless of this UI.
 *
 * The whole console is dark while the OPERATOR_CONSOLE flag is off
 * (compliance rule: new UI ships flag-off) — the flag state is inlined in
 * the page payload by the layout, so there is no late-visibility flash.
 *
 * @module OperatorConsole
 */

import React, { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeatureFlags } from '@/lib/feature-flags';
import type {
  CorrectionListResponse,
  OpsAuditListResponse,
  OpsConfirmationListResponse,
  OpsGovernanceListResponse,
} from '@/lib/types';
import {
  OpsApiError,
  confirmFxDataset,
  grantGovernance,
  listAuditTrail,
  listConfirmations,
  listCorrections,
  listGovernance,
  resolveCorrection,
  resolveTaxReview,
  revokeGovernance,
} from '../api';

const ACQUISITION_METHODS = [
  'PERMITTED_FEED',
  'RETAILER_API',
  'STRUCTURED_MERCHANT_FEED',
  'LICENSED_PROVIDER',
  'COMPLIANT_CRAWLING',
  'MANUAL_VERIFICATION',
] as const;

/** Shared state bundle the actions refresh together. */
interface ConsoleData {
  governance: OpsGovernanceListResponse;
  confirmations: OpsConfirmationListResponse;
  corrections: CorrectionListResponse;
  audit: OpsAuditListResponse;
}

async function loadAll(token: string): Promise<ConsoleData> {
  const [governance, confirmations, corrections, audit] = await Promise.all([
    listGovernance(token),
    listConfirmations(token),
    listCorrections(token),
    listAuditTrail(token),
  ]);
  return { governance, confirmations, corrections, audit };
}

export default function OperatorConsole() {
  const t = useTranslations('OperatorConsole');
  const flags = useFeatureFlags();

  const [token, setToken] = useState('');
  const [operator, setOperator] = useState('');
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const enabled = flags.flags.OPERATOR_CONSOLE ?? false;

  const refresh = useCallback(
    async (activeToken: string) => {
      setLoading(true);
      setError(null);
      try {
        setData(await loadAll(activeToken));
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : t('loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  /** Run a mutating action, then refresh the console + trail. */
  const runAction = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setError(null);
      setLastAction(null);
      try {
        await action();
        await refresh(token);
        setLastAction(label);
      } catch (err) {
        setError(
          err instanceof OpsApiError || err instanceof Error
            ? err.message
            : t('actionFailed'),
        );
      }
    },
    [refresh, t, token],
  );

  if (!enabled) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('disabled')}</p>
      </div>
    );
  }

  const operatorReady = operator.trim() !== '' && token.trim() !== '';

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('intro')}</p>
      </header>

      {/* ── Realm credentials — Phase 1: token field, not persisted ── */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">{t('credentials')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t('credentialsNote')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-700">
            {t('operatorName')}
            <input
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
            />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t('token')}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => refresh(token)}
          disabled={!operatorReady || loading}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? t('loading') : t('load')}
        </button>
        {error !== null && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {lastAction !== null && (
          <p className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            {t('actionRecorded', { action: lastAction })}
          </p>
        )}
      </section>

      {data !== null && (
        <>
          <GovernanceSection data={data} token={token} operator={operator.trim()} onAction={runAction} />
          <ConfirmationSection data={data} token={token} operator={operator.trim()} onAction={runAction} />
          <CorrectionSection data={data} token={token} operator={operator.trim()} onAction={runAction} />
          <AuditSection audit={data.audit} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action-runner prop shared by the workflow sections
// ---------------------------------------------------------------------------

type ActionRunner = (label: string, action: () => Promise<unknown>) => Promise<void>;

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

function GovernanceSection({
  data,
  token,
  operator,
  onAction,
}: {
  data: ConsoleData;
  token: string;
  operator: string;
  onAction: ActionRunner;
}) {
  const t = useTranslations('OperatorConsole');
  const [method, setMethod] = useState<string>(ACQUISITION_METHODS[0]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">{t('governanceTitle')}</h2>
      <p className="mt-1 text-xs text-gray-500">{t('governanceIntro')}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-gray-700">
          {t('acquisitionMethod')}
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
          >
            {ACQUISITION_METHODS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-700">
          {t('sourceUrl')}
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
          />
        </label>
        <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
          {t('noteOrReason')}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
          />
        </label>
      </div>

      <table className="mt-4 w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            <th className="py-2 pr-2 font-medium">{t('merchant')}</th>
            <th className="py-2 pr-2 font-medium">{t('permissionStatus')}</th>
            <th className="py-2 pr-2 font-medium">{t('sourceCount')}</th>
            <th className="py-2 font-medium">{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {data.governance.items.map((merchant) => (
            <tr key={merchant.merchantId} className="border-b border-gray-100">
              <td className="py-2 pr-2">
                <span className="font-medium text-gray-900">{merchant.name}</span>
                <span className="block text-gray-400">{merchant.merchantId}</span>
              </td>
              <td className="py-2 pr-2">
                <StatusBadge status={merchant.permissionStatus} />
              </td>
              <td className="py-2 pr-2 text-gray-600">{merchant.sourceCount}</td>
              <td className="py-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={sourceUrl.trim() === ''}
                    onClick={() =>
                      onAction(t('grantRecorded', { merchant: merchant.name }), () =>
                        grantGovernance(token, merchant.merchantId, {
                          operator,
                          acquisitionMethod: method,
                          sourceUrl: sourceUrl.trim(),
                          note: note.trim() === '' ? undefined : note.trim(),
                        }),
                      )
                    }
                    className="rounded bg-green-600 px-2 py-1 font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {t('grant')}
                  </button>
                  <button
                    type="button"
                    disabled={note.trim() === ''}
                    onClick={() =>
                      onAction(t('revokeRecorded', { merchant: merchant.name }), () =>
                        revokeGovernance(token, merchant.merchantId, {
                          operator,
                          reason: note.trim(),
                        }),
                      )
                    }
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {t('revoke')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.governance.items.length === 0 && (
        <p className="mt-3 text-xs text-gray-500">{t('noMerchants')}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dataset-version confirmation
// ---------------------------------------------------------------------------

function ConfirmationSection({
  data,
  token,
  operator,
  onAction,
}: {
  data: ConsoleData;
  token: string;
  operator: string;
  onAction: ActionRunner;
}) {
  const t = useTranslations('OperatorConsole');
  const [note, setNote] = useState('');

  const actionBody = () => ({
    operator,
    ...(note.trim() === '' ? {} : { note: note.trim() }),
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">{t('confirmationsTitle')}</h2>
      <p className="mt-1 text-xs text-gray-500">{t('confirmationsIntro')}</p>

      <label className="mt-3 block text-xs font-medium text-gray-700">
        {t('note')}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
        />
      </label>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('fxDatasets')}
      </h3>
      <ul className="mt-2 space-y-2">
        {data.confirmations.fx.map((dataset) => (
          <li key={dataset.id} className="rounded border border-gray-200 p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-gray-900">{dataset.versionLabel}</p>
                <p className="text-gray-500">
                  {dataset.sourceName} · {dataset.referenceDate} ·{' '}
                  {t('ratesCount', { count: dataset.rates.length })}
                </p>
                {dataset.sourceUrl !== null && (
                  <p className="text-gray-400">{dataset.sourceUrl}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  onAction(t('fxConfirmed', { version: dataset.versionLabel }), () =>
                    confirmFxDataset(token, dataset.id, actionBody()),
                  )
                }
                className="rounded bg-primary-600 px-2 py-1 font-medium text-white hover:bg-primary-700"
              >
                {t('confirm')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {data.confirmations.fx.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">{t('noFxDatasets')}</p>
      )}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('taxReviews')}
      </h3>
      <ul className="mt-2 space-y-2">
        {data.confirmations.taxReviews.map((review) => (
          <li key={review.id} className="rounded border border-gray-200 p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-gray-900">
                  {review.versionLabel ?? review.id}
                </p>
                <p className="text-gray-500">{review.description}</p>
                <p className="text-gray-400">
                  {review.source} · {review.createdAt}
                  {review.confirmedBy !== null ? ` · ${review.confirmedBy}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onAction(t('taxApproved', { version: review.versionLabel ?? review.id }), () =>
                      resolveTaxReview(token, review.id, 'approve', actionBody()),
                    )
                  }
                  className="rounded bg-green-600 px-2 py-1 font-medium text-white hover:bg-green-700"
                >
                  {t('approve')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAction(t('taxRejected', { version: review.versionLabel ?? review.id }), () =>
                      resolveTaxReview(token, review.id, 'reject', actionBody()),
                    )
                  }
                  className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                >
                  {t('reject')}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {data.confirmations.taxReviews.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">{t('noTaxReviews')}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Correction queue
// ---------------------------------------------------------------------------

function CorrectionSection({
  data,
  token,
  operator,
  onAction,
}: {
  data: ConsoleData;
  token: string;
  operator: string;
  onAction: ActionRunner;
}) {
  const t = useTranslations('OperatorConsole');
  const [note, setNote] = useState('');

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">{t('correctionsTitle')}</h2>
      <p className="mt-1 text-xs text-gray-500">{t('correctionsIntro')}</p>

      <label className="mt-3 block text-xs font-medium text-gray-700">
        {t('resolutionNote')}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800"
        />
      </label>

      <ul className="mt-3 space-y-2">
        {data.corrections.items.map((item) => (
          <li key={item.id} className="rounded border border-gray-200 p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-gray-900">
                  {t('correctionTarget', {
                    type: item.targetType,
                    id: item.targetId,
                  })}
                </p>
                <p className="text-gray-500">{item.reason}</p>
                <p className="text-gray-400">
                  {item.createdAt} · {item.status}
                </p>
              </div>
              {item.status === 'open' && (
                <button
                  type="button"
                  disabled={note.trim() === ''}
                  onClick={() =>
                    onAction(t('correctionResolved', { id: item.id }), () =>
                      resolveCorrection(token, item.id, {
                        operator,
                        ...(note.trim() === '' ? {} : { note: note.trim() }),
                      }),
                    )
                  }
                  className="rounded bg-primary-600 px-2 py-1 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {t('resolve')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data.corrections.items.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">{t('noCorrections')}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

function AuditSection({ audit }: { audit: OpsAuditListResponse }) {
  const t = useTranslations('OperatorConsole');

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">{t('auditTitle')}</h2>
      <p className="mt-1 text-xs text-gray-500">{t('auditIntro')}</p>
      <ul className="mt-3 space-y-1 font-mono text-xs text-gray-700">
        {audit.items.map((entry) => (
          <li key={entry.id} className="border-b border-gray-100 py-1">
            {entry.timestamp} · {entry.author} · {entry.entityType}/{entry.entityId} ·{' '}
            {entry.action} — {entry.reason}
          </li>
        ))}
      </ul>
      {audit.items.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">{t('noAuditEntries')}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    GRANTED: 'bg-green-100 text-green-800',
    PENDING: 'bg-amber-100 text-amber-800',
    EXPIRED: 'bg-amber-100 text-amber-800',
    REVOKED: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? 'bg-gray-100 text-gray-800'
      }`}
    >
      {status}
    </span>
  );
}

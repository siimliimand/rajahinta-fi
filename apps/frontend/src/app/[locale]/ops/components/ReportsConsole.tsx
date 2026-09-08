'use client';

/**
 * ReportsConsole — the shop-report moderation console (task 2.3, change
 * trust-and-reach-roadmap): the OPEN review queue with its evidence
 * (link to an existing entry / reject), the blacklist publish action
 * (the published standard is enforced server-side), and the entry
 * overview. Auth realm = the ops bearer token, exactly like
 * OperatorConsole (component state only, never persisted).
 *
 * New console strings are locale-selected literals (FI default) — the
 * message catalogs are owned by parallel workstreams and this is an
 * internal noindex tool.
 *
 * @module ReportsConsole
 */

import React, { useCallback, useState } from 'react';
import {
  OpsApiError,
  linkReport,
  listBlacklistEntries,
  listReports,
  publishBlacklistEntry,
  rejectReport,
  type OpsBlacklistListResponse,
  type OpsReportQueueResponse,
} from '../api';
import { ConsoleSection, StatusBadge, consoleLabels, inputClass } from './console-ui';

export default function ReportsConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Raporttien käsittely',
      intro:
        'Avoin raporttijono todisteineen, julkaisu standardin tarkistuksella ja mustan listan rivit. Jokainen toimenpide kirjataan auditointilokiin.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      load: 'Lataa',
      loading: 'Lataa…',
      queueTitle: 'Avoin raporttijono',
      queueIntro:
        'Raportit todisteineen (tilaustunnus ja kirjeenvaihto). Linkitys kuuluu jo julkaistuun riviin sama kauppiastunnus.',
      domain: 'Kauppias (domain)',
      merchantName: 'Kauppias (nimi avaimena)',
      evidence: 'Todisteet',
      reporter: 'Raportoija',
      entryId: 'Rivin tunnus (entryId)',
      link: 'Linkitä',
      reject: 'Hylkää',
      noReports: 'Ei avoimia raportteja.',
      publishTitle: 'Julkaise mustalle listalle',
      publishIntro:
        'Palvelin laskee standardin tallennetuista raporteista (3+ riippumatonta vahvistettua toimitushäiriötä TAI vahvistettu virheellinen yritysrekisteri). Standardin alittuminen hylätään.',
      confirmedIds: 'Vahvistettujen raporttien tunnukset (pilkuilla)',
      registrationConfirmed: 'Vahvistettu virheellinen yritysrekisteri',
      publish: 'Julkaise',
      entriesTitle: 'Mustan listan rivit',
      empty: 'Ei rivejä.',
      actionOk: 'Toimenpide kirjattu',
      actionFailed: 'Toimenpide epäonnistui',
    },
    en: {
      title: 'Report moderation',
      intro:
        'The open report queue with its evidence, publication behind the server-side standard check, and the blacklist entries. Every action is appended to the audit trail.',
      operator: 'Operator',
      token: 'Ops bearer token',
      load: 'Load',
      loading: 'Loading…',
      queueTitle: 'Open report queue',
      queueIntro:
        'Reports with their evidence (order reference and correspondence). Linking targets an already-published entry for the SAME merchant identity.',
      domain: 'Merchant (domain)',
      merchantName: 'Merchant (name key)',
      evidence: 'Evidence',
      reporter: 'Reporter',
      entryId: 'Entry id',
      link: 'Link',
      reject: 'Reject',
      noReports: 'No open reports.',
      publishTitle: 'Publish to the blacklist',
      publishIntro:
        'The server recomputes the published standard from the stored reports (3+ independent confirmed non-deliveries OR a confirmed invalid business registration). Below the standard the action is rejected.',
      confirmedIds: 'Confirmed report ids (comma-separated)',
      registrationConfirmed: 'Confirmed invalid business registration',
      publish: 'Publish',
      entriesTitle: 'Blacklist entries',
      empty: 'No entries.',
      actionOk: 'Action recorded',
      actionFailed: 'Action failed',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [queue, setQueue] = useState<OpsReportQueueResponse | null>(null);
  const [entries, setEntries] = useState<OpsBlacklistListResponse | null>(null);
  const [entryId, setEntryId] = useState('');
  const [publishDomain, setPublishDomain] = useState('');
  const [publishName, setPublishName] = useState('');
  const [confirmedIds, setConfirmedIds] = useState('');
  const [registrationConfirmed, setRegistrationConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(
    async (activeToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const [q, e] = await Promise.all([listReports(activeToken), listBlacklistEntries(activeToken)]);
        setQueue(q);
        setEntries(e);
      } catch (err) {
        setQueue(null);
        setEntries(null);
        setError(err instanceof Error ? err.message : t.actionFailed);
      } finally {
        setLoading(false);
      }
    },
    [t.actionFailed],
  );

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null);
      setFlash(null);
      try {
        await action();
        await refresh(token);
        setFlash(t.actionOk);
      } catch (err) {
        setError(
          err instanceof OpsApiError || err instanceof Error ? err.message : t.actionFailed,
        );
      }
    },
    [refresh, t.actionFailed, t.actionOk, token],
  );

  const ready = operator.trim() !== '' && token.trim() !== '';
  const reportIds = confirmedIds
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{t.intro}</p>
      </header>

      <ConsoleSection title={t.operator} intro={t.token}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-gray-700">
            {t.operator}
            <input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="off" className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.token}
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" className={inputClass} />
          </label>
        </div>
        <button
          type="button"
          onClick={() => refresh(token)}
          disabled={!ready || loading}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? t.loading : t.load}
        </button>
        {error !== null && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        {flash !== null && (
          <p className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{flash}</p>
        )}
      </ConsoleSection>

      {queue !== null && (
        <ConsoleSection title={t.queueTitle} intro={t.queueIntro}>
          <ul className="mt-3 space-y-2">
            {queue.items.map((report) => (
              <li key={report.id} className="rounded border border-gray-200 p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {report.merchantDomain} · {report.merchantNameNormalized}
                    </p>
                    <p className="mt-1 text-gray-600">
                      {t.evidence}: {report.orderReference} — {report.correspondenceSummary}
                    </p>
                    <p className="text-gray-400">
                      {t.reporter}: #{report.reporterAccountId} · {report.createdAt}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="text"
                      value={entryId}
                      onChange={(e) => setEntryId(e.target.value)}
                      placeholder={t.entryId}
                      className="w-24 rounded border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={entryId.trim() === ''}
                      onClick={() =>
                        runAction(() =>
                          linkReport(token, report.id, {
                            operator,
                            entryId: Number.parseInt(entryId, 10),
                          }),
                        )
                      }
                      className="rounded bg-primary-600 px-2 py-1 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {t.link}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runAction(() => rejectReport(token, report.id, { operator }))
                      }
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                    >
                      {t.reject}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {queue.items.length === 0 && <p className="mt-3 text-xs text-gray-500">{t.noReports}</p>}
        </ConsoleSection>
      )}

      {queue !== null && (
        <ConsoleSection title={t.publishTitle} intro={t.publishIntro}>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-700">
              {t.domain}
              <input type="text" value={publishDomain} onChange={(e) => setPublishDomain(e.target.value)} placeholder="shop.example" className={inputClass} />
            </label>
            <label className="block text-xs font-medium text-gray-700">
              {t.merchantName}
              <input type="text" value={publishName} onChange={(e) => setPublishName(e.target.value)} placeholder="Shop Name" className={inputClass} />
            </label>
            <label className="block text-xs font-medium text-gray-700 sm:col-span-2">
              {t.confirmedIds}
              <input type="text" value={confirmedIds} onChange={(e) => setConfirmedIds(e.target.value)} placeholder="1, 2, 3" className={inputClass} />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-gray-700 sm:col-span-2">
              <input type="checkbox" checked={registrationConfirmed} onChange={(e) => setRegistrationConfirmed(e.target.checked)} />
              {t.registrationConfirmed}
            </label>
          </div>
          <button
            type="button"
            disabled={publishDomain.trim() === '' || publishName.trim() === ''}
            onClick={() =>
              runAction(() =>
                publishBlacklistEntry(token, {
                  operator,
                  merchantDomain: publishDomain.trim(),
                  merchantName: publishName.trim(),
                  confirmedReportIds: reportIds,
                  businessRegistrationConfirmed: registrationConfirmed || undefined,
                }),
              )
            }
            className="mt-3 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {t.publish}
          </button>
        </ConsoleSection>
      )}

      {entries !== null && (
        <ConsoleSection title={t.entriesTitle} intro={t.empty}>
          <table className="mt-3 w-full text-left text-xs">
            <tbody>
              {entries.items.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100">
                  <td className="py-2 pr-2 font-medium text-gray-900">
                    {entry.merchantDomain} · {entry.merchantNameNormalized}
                  </td>
                  <td className="py-2 pr-2"><StatusBadge status={entry.status} /></td>
                  <td className="py-2 pr-2 text-gray-500">{entry.standardMet}</td>
                  <td className="py-2 text-gray-400">#{entry.publishedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.items.length === 0 && <p className="mt-2 text-xs text-gray-500">{t.empty}</p>}
        </ConsoleSection>
      )}
    </div>
  );
}

'use client';

/**
 * NewsletterConsole — the notify-subscribers action (task 5.3, change
 * trust-and-reach-roadmap): one FI + EN broadcast to every ACTIVE
 * subscriber through the email worker, with the delivery intent log
 * making retries skip already-delivered recipients (crash-safe). The
 * backend answers with the run's counters, surfaced verbatim.
 *
 * @module NewsletterConsole
 */

import React, { useState } from 'react';
import {
  OpsApiError,
  notifySubscribers,
  type OpsNewsletterBroadcastResponse,
} from '../api';
import { ConsoleSection, consoleLabels, inputClass } from './console-ui';

export default function NewsletterConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Uutiskirjeen lähetys',
      intro:
        'Lähetys vastaanottajille, joiden tilaus on vahvistettu (odottavia tai peruttuja ei koskaan lähetetä). Jokainen viesti sisältää yhden klikkauksen lopeta tilaus -linkin. Lähetys kirjoittaa aikomusrivit ennen lähetystä ja merkitsee lopputulokset sen jälkeen — uusinta ohittaa jo toimitetut.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      subject: 'Otsikko (yksi rivi)',
      bodyFi: 'Suomenkielinen teksti',
      bodyEn: 'Englanninkielinen teksti',
      note: 'Muistiinpano lokiin (valinnainen)',
      send: 'Lähetä',
      sending: 'Lähetetään…',
      resultTitle: 'Viimeisin lähetys',
      total: 'Vastaanottajat',
      notified: 'Toimitettu',
      failed: 'Epäonnistuneet',
      skipped: 'Ohitetut (jo toimitettu / cooldown)',
      actionFailed: 'Lähetys epäonnistui',
    },
    en: {
      title: 'Newsletter broadcast',
      intro:
        'One FI + EN broadcast to every ACTIVE subscriber (PENDING or UNSUBSCRIBED addresses are never mailed). Every email carries a one-click unsubscribe link. The send writes intent rows before dispatch and marks outcomes after — a retried send skips already-delivered recipients.',
      operator: 'Operator',
      token: 'Ops bearer token',
      subject: 'Subject (one line)',
      bodyFi: 'Finnish body',
      bodyEn: 'English body',
      note: 'Audit note (optional)',
      send: 'Send',
      sending: 'Sending…',
      resultTitle: 'Latest broadcast',
      total: 'Recipients',
      notified: 'Delivered',
      failed: 'Failed',
      skipped: 'Skipped (cooldown)',
      actionFailed: 'Broadcast failed',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyFi, setBodyFi] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsNewsletterBroadcastResponse | null>(null);

  const ready =
    operator.trim() !== '' &&
    token.trim() !== '' &&
    subject.trim() !== '' &&
    bodyFi.trim() !== '' &&
    bodyEn.trim() !== '';

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await notifySubscribers(token, {
          operator,
          subject: subject.trim(),
          bodyFi: bodyFi.trim(),
          bodyEn: bodyEn.trim(),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        }),
      );
    } catch (err) {
      setError(
        err instanceof OpsApiError || err instanceof Error ? err.message : t.actionFailed,
      );
    } finally {
      setSending(false);
    }
  };

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
      </ConsoleSection>

      <ConsoleSection title={t.title} intro={t.intro}>
        <div className="grid gap-3">
          <label className="block text-xs font-medium text-gray-700">
            {t.subject}
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.bodyFi}
            <textarea value={bodyFi} onChange={(e) => setBodyFi(e.target.value)} rows={4} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.bodyEn}
            <textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} rows={4} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-gray-700">
            {t.note}
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </label>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={!ready || sending}
          className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {sending ? t.sending : t.send}
        </button>
        {error !== null && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
      </ConsoleSection>

      {result !== null && (
        <ConsoleSection title={t.resultTitle} intro={t.total}>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded border border-gray-200 p-3">
              <dt className="text-gray-500">{t.total}</dt>
              <dd className="text-lg font-semibold text-gray-900">{result.total}</dd>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <dt className="text-gray-500">{t.notified}</dt>
              <dd className="text-lg font-semibold text-green-700">{result.notified}</dd>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <dt className="text-gray-500">{t.failed}</dt>
              <dd className="text-lg font-semibold text-red-700">{result.failed}</dd>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <dt className="text-gray-500">{t.skipped}</dt>
              <dd className="text-lg font-semibold text-amber-700">{result.skipped}</dd>
            </div>
          </dl>
        </ConsoleSection>
      )}
    </div>
  );
}

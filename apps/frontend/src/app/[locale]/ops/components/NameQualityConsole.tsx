'use client';

/**
 * NameQualityConsole — the name-quality enrichment queue (task 3.1,
 * change product-name-quality-gate): the products the informativeness
 * gate stored quarantined, with the raw feed name, the stripped
 * annotation, and the latest merchant/observation facts. Read-only —
 * the operator enriches at the merchant source. Realm model and string
 * strategy mirror ReportsConsole (bearer token in component state;
 * locale-selected literals, no catalog keys).
 *
 * @module NameQualityConsole
 */

import React, { useCallback, useState } from 'react';
import {
  listQuarantinedNames,
  type OpsQuarantinedNamesResponse,
} from '../api';
import { ConsoleSection, consoleLabels, inputClass } from './console-ui';

export default function NameQualityConsole({ locale }: { locale: string }) {
  const t = consoleLabels(locale, {
    fi: {
      title: 'Nimien laatu — karanteenijono',
      intro:
        'Tuotteet, joiden nimi on poistettu oletuslistauksista informatiivisuusportin toimesta. Rivillä raakanimi syötteestä, kauppiaskommentti ja viimeisin havainto — rikastus tehdään kauppiasan lähteessä.',
      operator: 'Operaattori',
      token: 'Ops-tunnus (bearer)',
      load: 'Lataa',
      loading: 'Lataa…',
      queueTitle: 'Karanteenissa olevat nimet',
      queueIntro: 'Vanhin havainto ensin; havaitsemattomat rivit ensin.',
      productId: 'Tuote',
      name: 'Raakanimi (syöte)',
      annotation: 'Kauppiaskommentti',
      merchant: 'Kauppias',
      observed: 'Havaittu',
      count: 'Rivejä',
      neverObserved: 'ei havaintoja',
      empty: 'Ei karanteeninimessä olevia rivejä.',
      loadFailed: 'Lataus epäonnistui',
    },
    en: {
      title: 'Name quality — quarantine queue',
      intro:
        'Products excluded from the default listings by the informativeness gate. Each row carries the raw feed name, the merchant annotation, and the latest observation — enrichment happens at the merchant source.',
      operator: 'Operator',
      token: 'Ops bearer token',
      load: 'Load',
      loading: 'Loading…',
      queueTitle: 'Quarantined names',
      queueIntro: 'Oldest observation first; never-observed rows list first.',
      productId: 'Product',
      name: 'Raw name (feed)',
      annotation: 'Merchant annotation',
      merchant: 'Merchant',
      observed: 'Observed',
      count: 'Rows',
      neverObserved: 'never observed',
      empty: 'No quarantined names.',
      loadFailed: 'Loading failed',
    },
  });

  const [operator, setOperator] = useState('');
  const [token, setToken] = useState('');
  const [queue, setQueue] = useState<OpsQuarantinedNamesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (activeToken: string) => {
      setLoading(true);
      setError(null);
      try {
        setQueue(await listQuarantinedNames(activeToken));
      } catch (err) {
        setQueue(null);
        setError(err instanceof Error ? err.message : t.loadFailed);
      } finally {
        setLoading(false);
      }
    },
    [t.loadFailed],
  );

  const ready = operator.trim() !== '' && token.trim() !== '';

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
      </ConsoleSection>

      {queue !== null && (
        <ConsoleSection title={t.queueTitle} intro={t.queueIntro}>
          <p className="mt-2 text-xs font-medium text-gray-700">
            {t.count}: {queue.total}
          </p>
          <table className="mt-3 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 pr-2 font-medium">{t.productId}</th>
                <th className="py-2 pr-2 font-medium">{t.name}</th>
                <th className="py-2 pr-2 font-medium">{t.annotation}</th>
                <th className="py-2 pr-2 font-medium">{t.merchant}</th>
                <th className="py-2 font-medium">{t.observed}</th>
              </tr>
            </thead>
            <tbody>
              {queue.items.map((item) => (
                <tr key={item.productId} className="border-b border-gray-100">
                  <td className="py-2 pr-2 text-gray-500">#{item.productId}</td>
                  <td className="py-2 pr-2 font-medium text-gray-900">{item.name}</td>
                  <td className="py-2 pr-2 text-gray-600">{item.nameAnnotation ?? '—'}</td>
                  <td className="py-2 pr-2 text-gray-600">{item.merchant ?? '—'}</td>
                  <td className="py-2 text-gray-400">
                    {item.observedAt ?? t.neverObserved}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queue.items.length === 0 && <p className="mt-2 text-xs text-gray-500">{t.empty}</p>}
        </ConsoleSection>
      )}
    </div>
  );
}

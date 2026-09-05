'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useFeatureFlags } from '@/lib/feature-flags';
import {
  ApiFetchError,
  fetchProductsByIds,
  searchProducts,
} from '@/lib/api';
import { Button, Card, EmptyState, Input } from '@/components/ui';
import type { ProductSearchItem } from '@/lib/types';
import ProductSearch from '../calculator/components/ProductSearch';
import ProductSelector from '../calculator/components/ProductSelector';
import SettlementNote from './settlement-note';
import {
  addGroupOrderItem,
  classifyTokenError,
  computeGroupOrderLedger,
  joinGroupOrder,
  paymentFieldRejection,
  type GroupOrderItemJson,
  type GroupOrderParticipantJson,
  type JoinResponse,
  type LedgerResponse,
} from './api';
import { formatCents, formatTimestamp, parseEuroToCents } from './money';

/**
 * Group order session page (task 9.4, change product-roadmap-phases-1-4)
 * at /group-order/[token] — the shareable link the owner distributes.
 *
 * Scope: participants join under a self-chosen nickname (no account — the
 * token IS the capability), add items, and see the who-ows-whom ledger.
 * There is no session-state GET in the 9.3 contract; the join response IS
 * the session state (join persists nothing), so refresh-on-action and the
 * 15 s poll re-join under the stored nickname (MVP — no websockets).
 *
 * Lifecycle states are explained, never raw errors:
 *   - 410 (server-set 7-day expiry passed) → a calm "session expired,
 *     contact the owner" state;
 *   - 404 (unknown token) → the same family of treatment;
 *   - 403 (flag flipped off server-side) → the view renders nothing;
 *   - EMPTY_SESSION / NO_ITEM_VALUE ledger statuses and per-item
 *     `unitValueCents: null` render as stated gaps, not errors.
 *
 * ACCOUNTING-ONLY BOUNDARY (design R12): the settlement note is a
 * persistent card on every state of this page — settlement happens
 * outside Rajahinta; Swish/MobilePay/bank transfer appear strictly as
 * user-side examples. No payment buttons, links, or pay-now affordances
 * exist here. The page never sends payment-instrument fields, and the
 * API's named-field 400 (if one ever occurs) is surfaced verbatim.
 *
 * @module GroupOrderSessionView
 */

/** How often the participant/item state refreshes while active. */
const POLL_INTERVAL_MS = 15_000;

type Phase = 'join' | 'active' | 'expired' | 'unknown';

type JoinFailure = 'invalid' | 'generic' | null;

/** Why an item add failed; `payment` carries the API's named-field message. */
type AddFailure = {
  kind: 'invalid-quantity' | 'missing-product' | 'not-found' | 'payment' | 'generic' | null;
  paymentField: string | null;
};

const NO_ADD_FAILURE: AddFailure = { kind: null, paymentField: null };

/** Why a ledger compute failed; `payment` carries the API's named-field message. */
type ComputeFailure = {
  kind: 'no-participants' | 'payment' | 'generic' | null;
  paymentField: string | null;
};

const NO_COMPUTE_FAILURE: ComputeFailure = { kind: null, paymentField: null };

/** One staged shared-cost line, already converted to integer cents. */
interface StagedCostLine {
  readonly label: string;
  readonly cents: number;
  readonly frontedByParticipantId: string;
}

export default function GroupOrderSessionView({ token }: { readonly token: string }) {
  const t = useTranslations('GroupOrder');
  const locale = useLocale();
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.GROUP_ORDER_LEDGER === true;

  // ── Join state ──
  const [phase, setPhase] = useState<Phase>('join');
  const [flagStale, setFlagStale] = useState(false);
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinFailure, setJoinFailure] = useState<JoinFailure>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  // ── Session state (the join response) ──
  const [participants, setParticipants] = useState<
    readonly GroupOrderParticipantJson[]
  >([]);
  const [items, setItems] = useState<readonly GroupOrderItemJson[]>([]);
  const [productNames, setProductNames] = useState<Readonly<Record<number, string>>>({});

  // ── Add-item state ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly ProductSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selected, setSelected] = useState<ProductSearchItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [adding, setAdding] = useState(false);
  const [addFailure, setAddFailure] = useState<AddFailure>(NO_ADD_FAILURE);

  // ── Ledger state ──
  const [costLabel, setCostLabel] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [costFrontedBy, setCostFrontedBy] = useState('');
  const [stagedLines, setStagedLines] = useState<readonly StagedCostLine[]>([]);
  const [lineError, setLineError] = useState<
    'label' | 'amount' | 'fronted-by' | null
  >(null);
  const [computing, setComputing] = useState(false);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [computeFailure, setComputeFailure] =
    useState<ComputeFailure>(NO_COMPUTE_FAILURE);

  /** Any submission in flight — the poll must not race it. */
  const busyRef = useRef(false);
  /** The nickname of the active poll/refresh cycle (avoids stale closures). */
  const joinedAsRef = useRef<string | null>(null);

  // ── State fetch: a quiet join — it persists nothing, so it reads. ──
  const refreshState = useCallback(
    async (as: string): Promise<boolean> => {
      try {
        const state: JoinResponse = await joinGroupOrder(token, as);
        setParticipants(state.participants);
        setItems(state.items);
        setExpiresAt(state.session.expiresAt);
        return true;
      } catch (err) {
        const tokenState = classifyTokenError(err);
        if (tokenState === 'expired') {
          setPhase('expired');
        } else if (tokenState === 'unknown') {
          setPhase('unknown');
        } else if (err instanceof ApiFetchError && err.status === 403) {
          setFlagStale(true);
        }
        return false;
      }
    },
    [token],
  );

  const join = useCallback(async () => {
    const trimmed = nickname.trim();
    if (trimmed.length < 1 || trimmed.length > 64) {
      setJoinFailure('invalid');
      return;
    }
    if (joining) return;
    setJoining(true);
    busyRef.current = true;
    setJoinFailure(null);
    try {
      const state = await joinGroupOrder(token, trimmed);
      joinedAsRef.current = trimmed;
      setParticipants(state.participants);
      setItems(state.items);
      setExpiresAt(state.session.expiresAt);
      setPhase('active');
    } catch (err) {
      const tokenState = classifyTokenError(err);
      if (tokenState === 'expired') {
        setPhase('expired');
      } else if (tokenState === 'unknown') {
        setPhase('unknown');
      } else if (err instanceof ApiFetchError && err.status === 403) {
        setFlagStale(true);
      } else if (err instanceof ApiFetchError && err.status === 400) {
        setJoinFailure('invalid');
      } else {
        setJoinFailure('generic');
      }
    } finally {
      busyRef.current = false;
      setJoining(false);
    }
  }, [joining, nickname, token]);

  // ── Product name resolution — one batched lookup; failures degrade
  //    rows to the "#id" label without discarding the list (alerts). ──
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const ids = [...new Set(items.map((item) => item.productId))];
    fetchProductsByIds(ids)
      .then((search) => {
        if (cancelled) return;
        const names: Record<number, string> = {};
        for (const item of search.items) {
          names[item.id] = item.name;
        }
        setProductNames(names);
      })
      .catch(() => {
        // Keep previously resolved names; rows fall back to "#id".
      });
    return () => {
      cancelled = true;
    };
  }, [items]);

  // ── Poll while active: re-join under the stored nickname every 15 s,
  //    pausing while a submission is in flight. ──
  useEffect(() => {
    if (phase !== 'active') return;
    const id = window.setInterval(() => {
      const as = joinedAsRef.current;
      if (as === null || busyRef.current) return;
      busyRef.current = true;
      void refreshState(as).finally(() => {
        busyRef.current = false;
      });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase, refreshState]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2 || searching) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      const res = await searchProducts(trimmed);
      setResults(res.items);
    } catch {
      setSearchFailed(true);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [searching]);

  const addItem = useCallback(async () => {
    const as = joinedAsRef.current;
    if (as === null || adding) return;
    const qty = Number.parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      setAddFailure({ kind: 'invalid-quantity', paymentField: null });
      return;
    }
    if (selected === null) {
      setAddFailure({ kind: 'missing-product', paymentField: null });
      return;
    }
    setAdding(true);
    busyRef.current = true;
    setAddFailure(NO_ADD_FAILURE);
    try {
      await addGroupOrderItem(token, {
        nickname: as,
        productId: selected.id,
        quantity: qty,
      });
      setSelected(null);
      setQuantity('1');
      await refreshState(as);
    } catch (err) {
      const paymentField = paymentFieldRejection(err);
      if (paymentField !== null) {
        setAddFailure({ kind: 'payment', paymentField });
      } else if (err instanceof ApiFetchError && err.status === 404) {
        setAddFailure({ kind: 'not-found', paymentField: null });
      } else {
        setAddFailure({ kind: 'generic', paymentField: null });
      }
    } finally {
      busyRef.current = false;
      setAdding(false);
    }
  }, [adding, quantity, refreshState, selected, token]);

  const stageLine = useCallback(() => {
    const label = costLabel.trim();
    if (label.length < 1 || label.length > 100) {
      setLineError('label');
      return;
    }
    const cents = parseEuroToCents(costAmount);
    if (cents === null) {
      setLineError('amount');
      return;
    }
    const frontedBy = costFrontedBy.trim();
    if (frontedBy.length < 1) {
      setLineError('fronted-by');
      return;
    }
    setLineError(null);
    setStagedLines((lines) => [
      ...lines,
      { label, cents, frontedByParticipantId: frontedBy },
    ]);
    setCostLabel('');
    setCostAmount('');
  }, [costAmount, costFrontedBy, costLabel]);

  const compute = useCallback(async () => {
    if (computing) return;
    if (stagedLines.length > 0 && participants.length === 0) {
      setComputeFailure({ kind: 'no-participants', paymentField: null });
      return;
    }
    setComputing(true);
    busyRef.current = true;
    setComputeFailure(NO_COMPUTE_FAILURE);
    try {
      setLedger(await computeGroupOrderLedger(token, stagedLines));
    } catch (err) {
      const paymentField = paymentFieldRejection(err);
      if (paymentField !== null) {
        setComputeFailure({ kind: 'payment', paymentField });
      } else {
        setComputeFailure({ kind: 'generic', paymentField: null });
      }
    } finally {
      busyRef.current = false;
      setComputing(false);
    }
  }, [computing, participants.length, stagedLines, token]);

  // ── Hidden state: flag off in the inlined payload (or flipped off
  //    server-side mid-session) — render nothing, fetch nothing. ──
  if (!flagEnabled || flagStale) {
    return null;
  }

  return (
    <main
      data-testid="group-order-session-page"
      className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        {t('title')}
      </h1>
      {phase === 'active' && expiresAt !== null && (
        <p className="mb-8 text-sm text-gray-500">
          {t('expiresAt', { date: formatTimestamp(expiresAt, locale) })}
        </p>
      )}
      {phase !== 'active' && <div className="mb-8" />}

      {/* ── Join: the entry state of every share link ── */}
      {phase === 'join' && (
        <Card as="section" padding="lg" data-testid="group-order-join-form">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('joinTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">{t('joinBody')}</p>
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                id="group-order-nickname"
                label={t('nicknameLabel')}
                value={nickname}
                maxLength={64}
                onChange={(e) => setNickname(e.target.value)}
                error={
                  joinFailure === 'invalid' ? t('nicknameRequired') : undefined
                }
              />
            </div>
            <Button type="submit" disabled={joining}>
              {joining ? t('joining') : t('joinAction')}
            </Button>
          </form>
          {joinFailure === 'generic' && (
            <p className="mt-3 text-sm text-red-700">
              {t('joinFailed')}{' '}
              <button
                type="button"
                className="font-medium underline hover:no-underline"
                onClick={() => void join()}
              >
                {t('retry')}
              </button>
            </p>
          )}
        </Card>
      )}

      {/* ── Expired link: a calm explained state, never a raw error ── */}
      {phase === 'expired' && (
        <Card as="section" padding="lg" data-testid="group-order-expired">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('expiredTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">{t('expiredBody')}</p>
        </Card>
      )}

      {/* ── Unknown token: the same family of calm treatment ── */}
      {phase === 'unknown' && (
        <Card as="section" padding="lg" data-testid="group-order-unknown">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('unknownTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">{t('unknownBody')}</p>
        </Card>
      )}

      {/* ── Active session ── */}
      {phase === 'active' && (
        <>
          {/* Participants */}
          <Card
            as="section"
            padding="lg"
            className="mb-6"
            data-testid="group-order-participants"
          >
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
              {t('participantsTitle')}
            </h2>
            {participants.length === 0 ? (
              <p className="text-sm text-gray-500">{t('participantsEmpty')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {participants.map((p) => (
                  <li
                    key={p.nickname}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="font-medium text-gray-900">
                      {p.nickname}
                    </span>
                    <span className="text-gray-500">
                      {t('participantItems', { count: p.itemCount })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Items */}
          <Card
            as="section"
            padding="lg"
            className="mb-6"
            data-testid="group-order-items"
          >
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
              {t('itemsTitle')}
            </h2>
            {items.length === 0 ? (
              <EmptyState
                title={t('itemsEmptyTitle')}
                description={t('itemsEmptyBody')}
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map((item) => (
                  <li key={item.id} className="py-2 text-sm">
                    <span className="font-medium text-gray-900">
                      {productNames[item.productId] ??
                        t('productUnknown', { id: item.productId })}
                    </span>
                    <span className="text-gray-500">
                      {' '}
                      · {t('quantityCount', { count: item.quantity })} ·{' '}
                      {t('itemAddedBy', { nickname: item.participantNickname })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Add item */}
          <Card
            as="section"
            padding="lg"
            className="mb-6"
            data-testid="group-order-add-item"
          >
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
              {t('addItemTitle')}
            </h2>
            <div className="mt-3">
              <ProductSearch
                value={query}
                onChange={setQuery}
                onSubmit={(q) => void runSearch(q)}
                loading={searching}
                error={searchFailed ? t('searchFailed') : null}
              />
            </div>
            <ProductSelector
              items={[...results]}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              loading={searching}
              query={query}
            />
            {selected !== null && (
              <p className="mt-2 text-sm text-gray-700">
                {t('selectedProduct', { name: selected.name })}
              </p>
            )}
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addItem();
              }}
            >
              <div className="w-28">
                <Input
                  id="group-order-quantity"
                  label={t('quantityLabel')}
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  error={
                    addFailure.kind === 'invalid-quantity'
                      ? t('addInvalidQuantity')
                      : undefined
                  }
                />
              </div>
              <Button type="submit" disabled={adding}>
                {adding ? t('adding') : t('addAction')}
              </Button>
            </form>
            {addFailure.kind === 'missing-product' && (
              <p className="mt-3 text-sm text-red-700">{t('addMissingProduct')}</p>
            )}
            {addFailure.kind === 'not-found' && (
              <p className="mt-3 text-sm text-red-700">{t('addProductNotFound')}</p>
            )}
            {addFailure.kind === 'generic' && (
              <p className="mt-3 text-sm text-red-700">
                {t('addFailed')}{' '}
                <button
                  type="button"
                  className="font-medium underline hover:no-underline"
                  onClick={() => void addItem()}
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {/* The API's accounting-only rejection, surfaced verbatim —
                the page never sends such fields, so this is a guardrail. */}
            {addFailure.kind === 'payment' &&
              addFailure.paymentField !== null && (
                <p
                  className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                  data-testid="group-order-payment-error"
                >
                  {t('paymentRejected', { field: addFailure.paymentField })}
                </p>
              )}
          </Card>

          {/* Ledger */}
          <Card
            as="section"
            padding="lg"
            className="mb-6"
            data-testid="group-order-ledger"
          >
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
              {t('ledgerTitle')}
            </h2>
            <p className="mb-4 text-sm text-gray-600">{t('ledgerIntro')}</p>

            {/* Staged shared-cost lines */}
            <form
              className="grid gap-2 sm:grid-cols-[1fr_8rem_10rem_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                stageLine();
              }}
            >
              <Input
                id="group-order-cost-label"
                label={t('sharedCostLabel')}
                value={costLabel}
                maxLength={100}
                onChange={(e) => setCostLabel(e.target.value)}
                error={lineError === 'label' ? t('lineInvalidLabel') : undefined}
              />
              <Input
                id="group-order-cost-amount"
                label={t('sharedCostAmount')}
                inputMode="decimal"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
                error={lineError === 'amount' ? t('lineInvalidAmount') : undefined}
              />
              <div>
                <label
                  htmlFor="group-order-cost-fronted-by"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t('sharedCostFrontedBy')}
                </label>
                <select
                  id="group-order-cost-fronted-by"
                  value={costFrontedBy}
                  onChange={(e) => setCostFrontedBy(e.target.value)}
                  disabled={participants.length === 0}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50"
                >
                  <option value="">{t('frontedByPlaceholder')}</option>
                  {participants.map((p) => (
                    <option key={p.nickname} value={p.nickname}>
                      {p.nickname}
                    </option>
                  ))}
                </select>
                {lineError === 'fronted-by' && (
                  <p className="mt-1 text-xs font-medium text-error">
                    {t('lineInvalidFrontedBy')}
                  </p>
                )}
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="secondary">
                  {t('addLine')}
                </Button>
              </div>
            </form>

            <div className="mt-4" data-testid="group-order-cost-lines">
              <h3 className="text-sm font-medium text-gray-700">
                {t('linesTitle')}
              </h3>
              {stagedLines.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">{t('noLines')}</p>
              ) : (
                <ul className="mt-1 divide-y divide-gray-100">
                  {stagedLines.map((line, i) => (
                    <li
                      key={`${line.label}-${String(i)}`}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span className="text-gray-900">
                        {line.label} · {t('frontedByLine', { nickname: line.frontedByParticipantId })}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-medium text-gray-900">
                          {formatCents(line.cents, locale)}
                        </span>
                        <button
                          type="button"
                          aria-label={t('removeLine')}
                          className="text-xs text-gray-400 underline hover:text-gray-600 hover:no-underline"
                          onClick={() =>
                            setStagedLines((lines) =>
                              lines.filter((_, j) => j !== i),
                            )
                          }
                        >
                          {t('removeLine')}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="button"
                onClick={() => void compute()}
                disabled={computing}
                data-testid="group-order-compute-button"
              >
                {computing ? t('computing') : t('computeAction')}
              </Button>
              {stagedLines.length > 0 && participants.length === 0 && (
                <p className="text-xs text-gray-500">{t('noParticipantsHint')}</p>
              )}
            </div>

            {computeFailure.kind === 'no-participants' && (
              <p className="mt-3 text-sm text-red-700">{t('noParticipantsHint')}</p>
            )}
            {computeFailure.kind === 'generic' && (
              <p className="mt-3 text-sm text-red-700">
                {t('computeFailed')}{' '}
                <button
                  type="button"
                  className="font-medium underline hover:no-underline"
                  onClick={() => void compute()}
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {computeFailure.kind === 'payment' &&
              computeFailure.paymentField !== null && (
                <p
                  className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                  data-testid="group-order-payment-error"
                >
                  {t('paymentRejected', { field: computeFailure.paymentField })}
                </p>
              )}

            {/* ── Ledger result — the 9.2 module output, value states
                rendered as explained states, never errors ── */}
            {ledger !== null && (
              <div className="mt-6" data-testid="group-order-ledger-result">
                <h3 className="text-sm font-semibold text-gray-900">
                  {t('resultTitle')}
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  {t('valuationRuleEcho', { rule: ledger.valuationRule })}
                </p>

                {ledger.ledger.status === 'EMPTY_SESSION' && (
                  <div className="mt-3">
                    <EmptyState
                      title={t('emptySessionTitle')}
                      description={t('emptySessionBody')}
                    />
                  </div>
                )}

                {ledger.ledger.status === 'NO_ITEM_VALUE' && (
                  <div className="mt-3">
                    <EmptyState
                      title={t('noItemValueTitle')}
                      description={t('noItemValueBody')}
                    />
                  </div>
                )}

                {ledger.ledger.status === 'COMPUTED' && (
                  <>
                    {/* Shared-cost lines (echo) */}
                    <ul className="mt-3 space-y-1 text-sm text-gray-700">
                      {ledger.ledger.sharedCosts.map((line) => (
                        <li key={line.label}>
                          {line.label}: {formatCents(line.sharedCostCents, locale)} ·{' '}
                          {t('frontedByLine', { nickname: line.frontedByParticipantId })}
                        </li>
                      ))}
                    </ul>

                    {/* Participant ledger table */}
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                            <th className="py-2 pr-3 font-medium">{t('colParticipant')}</th>
                            <th className="py-2 pr-3 font-medium">{t('colItemValue')}</th>
                            <th className="py-2 pr-3 font-medium">{t('colAllocated')}</th>
                            <th className="py-2 pr-3 font-medium">{t('colFronted')}</th>
                            <th className="py-2 pr-3 font-medium">{t('colTotalOwed')}</th>
                            <th className="py-2 font-medium">{t('colBalance')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {ledger.ledger.participants.map((p) => (
                            <tr key={p.participantId}>
                              <td className="py-2 pr-3 font-medium text-gray-900">
                                {p.participantId}
                              </td>
                              <td className="py-2 pr-3 text-gray-700">
                                {formatCents(p.itemValueCents, locale)}
                              </td>
                              <td className="py-2 pr-3 text-gray-700">
                                {formatCents(p.allocatedSharedCostCents, locale)}
                              </td>
                              <td className="py-2 pr-3 text-gray-700">
                                {formatCents(p.frontedSharedCostCents, locale)}
                              </td>
                              <td className="py-2 pr-3 text-gray-700">
                                {formatCents(p.totalOwedCents, locale)}
                              </td>
                              <td className="py-2 text-gray-700">
                                {p.netBalanceCents > 0
                                  ? t('balanceGroupOwes', {
                                      amount: formatCents(p.netBalanceCents, locale),
                                    })
                                  : p.netBalanceCents < 0
                                    ? t('balanceOwesGroup', {
                                        amount: formatCents(-p.netBalanceCents, locale),
                                      })
                                    : t('balanceSettled')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Who-owes-whom transfers (minimal set) */}
                    <div className="mt-4" data-testid="group-order-transfers">
                      <h4 className="text-sm font-semibold text-gray-900">
                        {t('transfersTitle')}
                      </h4>
                      {ledger.ledger.transfers.length === 0 ? (
                        <p className="mt-1 text-sm text-gray-500">
                          {t('transfersEmpty')}
                        </p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm text-gray-700">
                          {ledger.ledger.transfers.map((tr) => (
                            <li key={`${tr.fromParticipantId}-${tr.toParticipantId}`}>
                              {t('transferLine', {
                                from: tr.fromParticipantId,
                                to: tr.toParticipantId,
                                amount: formatCents(tr.cents, locale),
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                {/* Per-item valuation echo — an unvalued product is a
                    stated gap (`unitValueCents: null`), never an error. */}
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-gray-900">
                    {t('valuationsTitle')}
                  </h4>
                  <ul className="mt-1 divide-y divide-gray-100 text-sm">
                    {ledger.itemValuations.map((v, i) => (
                      <li
                        key={`${String(v.productId)}-${String(i)}`}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="text-gray-700">
                          {productNames[v.productId] ??
                            t('productUnknown', { id: v.productId })}
                          {' '}
                          · {t('quantityCount', { count: v.quantity })}
                        </span>
                        <span className="text-gray-700">
                          {v.unitValueCents === null ? (
                            <span
                              data-testid="group-order-unvalued-item"
                              className="text-xs font-medium text-gray-400"
                            >
                              {t('unvaluedItem')}
                            </span>
                          ) : (
                            formatCents(v.itemValueCents, locale)
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── The mandatory accounting-only boundary note — persistent on
          EVERY state of this page (R12), never buried, no payment
          affordances anywhere on the page. ── */}
      <SettlementNote />
    </main>
  );
}

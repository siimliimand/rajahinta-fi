'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  ApiFetchError,
  getAccountPreferences,
  putAccountPreferences,
} from '@/lib/api';
import { Button } from '@/components/ui';
import type { AccountChannel } from '@/lib/types';
import { CANONICAL_CATEGORIES, categoryLabel } from '../products/category-labels';

/** Q1 answer options, stored verbatim as the wire values (D8). */
const CHANNEL_OPTIONS: readonly AccountChannel[] = [
  'TRAVEL',
  'DELIVERY',
  'BOTH',
];

/** Message key per channel option (variable-key `t` precedent:
 *  account/alerts). */
const CHANNEL_LABEL_KEYS: Record<AccountChannel, string> = {
  TRAVEL: 'channelTravel',
  DELIVERY: 'channelDelivery',
  BOTH: 'channelBoth',
};

/**
 * Onboarding interstitial and preferences editor (design D3/D6, change
 * add-onboarding-preferences). Post-registration quiz: purchase channel,
 * followed canonical categories (zero selected is a valid "follows
 * nothing"), and the digest opt-in — unticked by default (D3), opt-in
 * only.
 *
 * The page loads the stored preferences at mount (task 3.2) so it doubles
 * as the editor reachable from the account hub; controls hydrate from the
 * stored view, never from local defaults (`channel: null` on the wire is
 * the unanswered state and is rendered as such).
 *
 * Skip is a first-class outcome (D6): it PUTs only `{ onboarded: true }`,
 * is always visible and never disabled. An account-scoped 401 redirects
 * to `/login` — the account page's no-signed-out-render precedent.
 *
 * @module OnboardingPage
 */
export default function OnboardingPage() {
  const t = useTranslations('Onboarding');
  const locale = useLocale();
  const router = useRouter();

  // ── Load state (account-page precedent: 401 → /login, other failures
  // → a retry instead of a redirect) ──
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [probeTick, setProbeTick] = useState(0);

  // ── Preference controls, hydrated from the stored view at mount ──
  const [channel, setChannel] = useState<AccountChannel | null>(null);
  const [categoryTags, setCategoryTags] = useState<string[]>([]);
  const [digestEnabled, setDigestEnabled] = useState(false);

  // ── Submit state (register-page error convention: one inline generic
  // failure paragraph) ──
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [failure, setFailure] = useState<'error' | null>(null);

  // Mount-time load; the same read powers the returning-account editor.
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    getAccountPreferences()
      .then((view) => {
        if (cancelled) return;
        setChannel(view.channel);
        setCategoryTags([...view.categoryTags]);
        setDigestEnabled(view.digestEnabled);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiFetchError && err.status === 401) {
          // No signed-in session — the sign-in page is the only way in.
          router.replace('/login');
          return;
        }
        // Backend unreachable — offer a retry instead of a redirect.
        setLoadFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, probeTick]);

  /** Chip toggle; order follows the canonical value set, not click order. */
  function toggleCategory(category: string) {
    setCategoryTags((prev) =>
      prev.includes(category)
        ? prev.filter((tag) => tag !== category)
        : [...prev, category],
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await putAccountPreferences({
        channel,
        categoryTags,
        digestEnabled,
        onboarded: true,
      });
      router.replace('/account');
    } catch {
      setFailure('error');
    } finally {
      setSaving(false);
    }
  }

  // Skip answers nothing and changes nothing except completion (D6) —
  // exactly this one-field payload, regardless of what the user ticked.
  async function handleSkip() {
    setSkipping(true);
    setFailure(null);
    try {
      await putAccountPreferences({ onboarded: true });
      router.replace('/account');
    } catch {
      setFailure('error');
    } finally {
      setSkipping(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>

        {loading && (
          <p data-testid="onboarding-loading" className="mt-6 text-sm text-gray-500">
            {t('loading')}
          </p>
        )}

        {loadFailed && (
          <div data-testid="onboarding-load-failed" className="mt-6 text-sm text-gray-600">
            <p role="alert" className="font-medium text-error">
              {t('loadFailed')}
            </p>
            <button
              type="button"
              data-testid="onboarding-retry"
              onClick={() => setProbeTick((n) => n + 1)}
              className="mt-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {!loading && !loadFailed && (
          <form className="mt-6 space-y-6" onSubmit={handleSave}>
            {/* ── Q1: purchase channel (unanswered renders with nothing
                    selected — no client-side default, D8) ── */}
            <fieldset data-testid="onboarding-channel">
              <legend className="text-sm font-medium text-gray-900">
                {t('channelLegend')}
              </legend>
              <div className="mt-2 space-y-2">
                {CHANNEL_OPTIONS.map((option) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 text-sm text-gray-700"
                  >
                    <input
                      type="radio"
                      name="onboarding-channel"
                      value={option}
                      data-testid={`onboarding-channel-${option}`}
                      checked={channel === option}
                      onChange={() => setChannel(option)}
                    />
                    {t(CHANNEL_LABEL_KEYS[option])}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ── Q2: followed categories — zero selected is a valid
                    "follows nothing" answer, so nothing here requires a
                    selection (chips follow the alerts kind-toggle
                    pattern) ── */}
            <fieldset data-testid="onboarding-categories">
              <legend className="text-sm font-medium text-gray-900">
                {t('categoryLegend')}
              </legend>
              <p className="mt-1 text-xs text-gray-500">{t('categoryHelp')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CANONICAL_CATEGORIES.map((category) => {
                  const selected = categoryTags.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={selected}
                      data-testid={`onboarding-category-${category}`}
                      onClick={() => toggleCategory(category)}
                      className={
                        selected
                          ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700'
                          : 'rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50'
                      }
                    >
                      {categoryLabel(category, locale === 'fi' ? 'fi' : 'en')}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* ── Q3: digest consent — unticked by default (D3); the
                    caption is factual, never promotional ── */}
            <label
              data-testid="onboarding-digest-row"
              className="flex items-start gap-2 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                data-testid="onboarding-digest"
                checked={digestEnabled}
                onChange={(e) => setDigestEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {t('digestLabel')}
                <span className="block text-xs text-gray-500">
                  {t('digestCaption')}
                </span>
              </span>
            </label>

            {failure === 'error' && (
              <p
                data-testid="onboarding-failure"
                role="alert"
                className="text-sm font-medium text-error"
              >
                {t('genericError')}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                data-testid="onboarding-save"
                disabled={saving || skipping}
              >
                {saving ? t('saving') : t('save')}
              </Button>
              {/* Skip is a first-class outcome (D6): always visible,
                  never disabled. */}
              <Button
                type="button"
                variant="secondary"
                data-testid="onboarding-skip"
                onClick={() => void handleSkip()}
              >
                {skipping ? t('skipping') : t('skip')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

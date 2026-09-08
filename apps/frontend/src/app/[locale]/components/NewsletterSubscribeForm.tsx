'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiFetchError, subscribeToNewsletter } from '@/lib/api';
import { Button, Input } from '@/components/ui';

/** Whole-form phase: idle form, in-flight submit, or the recorded state. */
type Phase = 'idle' | 'submitting' | 'done';

/** Why a submission failed; each kind maps to one i18n message. */
type Failure = 'invalid' | 'rate-limited' | 'generic' | null;

/**
 * Newsletter subscribe form (task 5.4, change trust-and-reach-roadmap;
 * spec content-publication — double opt-in, consent separate from price
 * alerts). Rendered in the site footer and on the blog surfaces.
 *
 * Consent discipline: submission requires the explicit checkbox, the
 * copy states the newsletter consent is separate from price alerts, and
 * the backend's 202 is uniform — so the success panel promises a
 * confirmation message without claiming an activated subscription.
 * Activation happens only through the emailed confirmation link
 * (/newsletter/confirm), and every delivered newsletter carries a
 * one-click unsubscribe link (/newsletter/unsubscribe).
 *
 * @module NewsletterSubscribeForm
 */
export default function NewsletterSubscribeForm() {
  const t = useTranslations('Newsletter');
  const locale = useLocale();

  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<Failure>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = email.trim();
      if (phase === 'submitting' || trimmed.length === 0 || !consent) return;
      setPhase('submitting');
      setFailure(null);
      try {
        await subscribeToNewsletter(
          trimmed,
          locale === 'en' ? 'en' : 'fi',
        );
        // Uniform 202 — the address was recorded as PENDING; the
        // subscription activates only through the emailed link.
        setPhase('done');
      } catch (err) {
        if (err instanceof ApiFetchError && err.status === 400) {
          setFailure('invalid');
        } else if (err instanceof ApiFetchError && err.status === 429) {
          setFailure('rate-limited');
        } else {
          setFailure('generic');
        }
        setPhase('idle');
      }
    },
    [consent, email, locale, phase],
  );

  if (phase === 'done') {
    return (
      <section
        data-testid="newsletter-subscribe"
        className="rounded-lg border border-gray-200 bg-white p-4"
      >
        <h2 className="text-sm font-semibold text-gray-900">
          {t('successTitle')}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          {t('successBody')}
        </p>
        <p className="mt-1 text-xs text-gray-400">{email.trim()}</p>
      </section>
    );
  }

  return (
    <section
      data-testid="newsletter-subscribe"
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">
        {t('description')}
      </p>

      <form onSubmit={handleSubmit} className="mt-3">
        <Input
          id="newsletter-email"
          label={t('emailLabel')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={failure === 'invalid' ? t('errorInvalid') : undefined}
        />

        {/* Explicit, separate consent (spec: double opt-in newsletter
            separate from alert consent). */}
        <label className="mt-3 flex items-start gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            data-testid="newsletter-consent"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span>{t('consentLabel')}</span>
        </label>
        <p className="mt-2 text-xs text-gray-500">{t('separationNote')}</p>

        <div className="mt-3">
          <Button
            type="submit"
            size="sm"
            disabled={phase === 'submitting' || !consent || email.trim().length === 0}
          >
            {phase === 'submitting' ? t('submitting') : t('submit')}
          </Button>
        </div>

        {failure === 'rate-limited' && (
          <p role="alert" className="mt-2 text-xs font-medium text-error">
            {t('errorRateLimited')}
          </p>
        )}
        {failure === 'generic' && (
          <p role="alert" className="mt-2 text-xs font-medium text-error">
            {t('errorGeneric')}
          </p>
        )}
      </form>
    </section>
  );
}

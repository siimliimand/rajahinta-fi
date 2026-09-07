'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiFetchError, requestPasswordReset } from '@/lib/api';
import { Button, Input } from '@/components/ui';

/**
 * Forgot-password page (design D2/D8, change email-password-auth). Posts
 * to `POST /account/password/reset-request`, which answers 202
 * unconditionally so the route cannot leak account existence — the
 * rendered outcome is therefore always the same "check your email" note.
 * The AUTH rate limit can answer 429.
 *
 * @module ForgotPasswordPage
 */
export default function ForgotPasswordPage() {
  const t = useTranslations('ForgotPassword');
  const tAuth = useTranslations('Auth');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setRateLimited(false);
    setFailed(false);
    try {
      await requestPasswordReset(email.trim());
      // 202 — sent when the account exists, silent otherwise; the UI
      // copy is identical either way by design.
      setAccepted(true);
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 429) {
        setRateLimited(true);
      } else {
        setFailed(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>

        {accepted ? (
          <div data-testid="forgot-accepted" className="mt-6">
            <p className="text-sm font-semibold text-gray-900">{t('acceptedTitle')}</p>
            <p className="mt-2 text-sm text-gray-600">{t('acceptedBody')}</p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('toLogin')}
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <Input
              id="forgot-email"
              type="email"
              name="email"
              autoComplete="email"
              label={tAuth('emailLabel')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {rateLimited && (
              <p
                data-testid="forgot-failure"
                role="alert"
                className="text-sm font-medium text-error"
              >
                {tAuth('rateLimited')}
              </p>
            )}
            {failed && (
              <p
                data-testid="forgot-failure"
                role="alert"
                className="text-sm font-medium text-error"
              >
                {tAuth('genericError')}
              </p>
            )}

            <Button
              type="submit"
              fullWidth
              data-testid="forgot-submit"
              disabled={submitting}
            >
              {submitting ? t('submitting') : t('submit')}
            </Button>

            <p className="text-sm">
              <Link href="/login" className="text-primary-600 hover:text-primary-800">
                {t('toLogin')}
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

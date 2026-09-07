'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiFetchError, resetPassword } from '@/lib/api';
import { Button, Input } from '@/components/ui';

/**
 * Password-reset landing page (design D2/D8, change email-password-auth).
 * The emailed link lands here with the raw token in the query string
 * (read from `window.location`, what-if precedent). `POST
 * /account/password/reset` rehashes the password and revokes ALL of the
 * account's sessions — the success copy states that, so shared-device
 * users are not surprised (design trade-off note). The token is read from
 * `window.location` instead of `useSearchParams` so the page stays out of
 * the Suspense-boundary prerender path.
 *
 * @module ResetPasswordPage
 */
type ResetFailure = 'invalidToken' | 'invalidPassword' | 'rateLimited' | 'error' | null;

/**
 * Token state: `undefined` = not yet read from the URL (render nothing so
 * the missing-token message never flashes first), `null` = the link
 * carried no token, a string = the capability from the emailed link.
 */
export default function ResetPasswordPage() {
  const t = useTranslations('ResetPassword');
  const tAuth = useTranslations('Auth');
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failure, setFailure] = useState<ResetFailure>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('token');
    setToken(raw === null || raw === '' ? null : raw);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typeof token !== 'string') return;
    setSubmitting(true);
    setFailure(null);
    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiFetchError) {
        if (err.status === 401) setFailure('invalidToken');
        else if (err.body?.error === 'InvalidPassword') setFailure('invalidPassword');
        else if (err.status === 429) setFailure('rateLimited');
        else setFailure('error');
      } else {
        setFailure('error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>

        {typeof token !== 'string' && !success ? (
          token === null ? (
            <div data-testid="reset-status" className="mt-4">
              <p role="alert" className="text-sm font-medium text-error">
                {t('missingToken')}
              </p>
              <div className="mt-6">
                <Link
                  href="/login"
                  className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  {t('toLogin')}
                </Link>
              </div>
            </div>
          ) : null
        ) : success ? (
          <div data-testid="reset-status" className="mt-4">
            <p className="text-sm font-semibold text-green-700">{t('successTitle')}</p>
            <p className="mt-2 text-sm text-gray-600">{t('successBody')}</p>
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
          <form data-testid="reset-form" className="mt-4 space-y-4" onSubmit={handleSubmit}>
            <p className="text-sm text-gray-600">{t('subtitle')}</p>

            <Input
              id="reset-password"
              type="password"
              name="password"
              autoComplete="new-password"
              label={tAuth('newPasswordLabel')}
              hint={tAuth('passwordHint')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              maxLength={128}
              required
            />

            {failure === 'invalidToken' && (
              <p role="alert" className="text-sm font-medium text-error">
                {t('invalidBody')}
              </p>
            )}
            {failure === 'invalidPassword' && (
              <p role="alert" className="text-sm font-medium text-error">
                {tAuth('invalidPassword')}
              </p>
            )}
            {failure === 'rateLimited' && (
              <p role="alert" className="text-sm font-medium text-error">
                {tAuth('rateLimited')}
              </p>
            )}
            {failure === 'error' && (
              <p role="alert" className="text-sm font-medium text-error">
                {tAuth('genericError')}
              </p>
            )}

            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

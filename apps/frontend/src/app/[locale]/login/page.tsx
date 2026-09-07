'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiFetchError, loginAccount } from '@/lib/api';
import { Button, Input } from '@/components/ui';

/**
 * Sign-in page (design D8, change email-password-auth). Posts the email
 * credential to `POST /api/v1/account/login`, which sets the httpOnly
 * session cookie; the anonymous auto-mint no longer exists. Unknown email
 * and wrong password arrive as one uniform 401 (no enumeration); the AUTH
 * rate limit can answer 429.
 *
 * @module LoginPage
 */
export default function LoginPage() {
  const t = useTranslations('Login');
  const tAuth = useTranslations('Auth');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<'credentials' | 'rateLimited' | 'error' | null>(
    null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFailure(null);
    try {
      await loginAccount(email.trim(), password);
      router.replace('/account');
    } catch (err) {
      if (err instanceof ApiFetchError) {
        if (err.status === 401) setFailure('credentials');
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
        <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <Input
            id="login-email"
            type="email"
            name="email"
            autoComplete="email"
            label={tAuth('emailLabel')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="login-password"
            type="password"
            name="password"
            autoComplete="current-password"
            label={tAuth('passwordLabel')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {failure === 'credentials' && (
            <p
              data-testid="login-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {t('invalidCredentials')}
            </p>
          )}
          {failure === 'rateLimited' && (
            <p
              data-testid="login-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {tAuth('rateLimited')}
            </p>
          )}
          {failure === 'error' && (
            <p
              data-testid="login-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {tAuth('genericError')}
            </p>
          )}

          <Button
            type="submit"
            fullWidth
            data-testid="login-submit"
            disabled={submitting}
          >
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-2 text-sm text-gray-600">
          <Link href="/account/forgot" className="text-primary-600 hover:text-primary-800">
            {t('toForgot')}
          </Link>
          <p>
            {t('noAccount')}{' '}
            <Link href="/register" className="font-medium text-primary-600 hover:text-primary-800">
              {t('toRegister')}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

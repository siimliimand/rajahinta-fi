'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiFetchError, registerAccount } from '@/lib/api';
import { Button, Input } from '@/components/ui';

/**
 * Registration page (design D8, change email-password-auth). Posts to
 * `POST /api/v1/account/register`, which validates the credentials
 * (password policy: 12–128 chars), creates the account, sets the session
 * cookie, and fires a best-effort verification email. Duplicate email
 * answers 409; the AUTH rate limit can answer 429.
 *
 * @module RegisterPage
 */
export default function RegisterPage() {
  const t = useTranslations('Register');
  const tAuth = useTranslations('Auth');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [
    failure,
    setFailure,
  ] = useState<'emailTaken' | 'invalidEmail' | 'invalidPassword' | 'rateLimited' | 'error' | null>(
    null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFailure(null);
    try {
      await registerAccount(email.trim(), password);
      router.replace('/account');
    } catch (err) {
      if (err instanceof ApiFetchError) {
        const code = err.body?.error;
        if (err.status === 409 || code === 'EmailAlreadyRegistered') {
          setFailure('emailTaken');
        } else if (err.status === 429) {
          setFailure('rateLimited');
        } else if (code === 'InvalidEmail' || err.status === 400) {
          setFailure(code === 'InvalidPassword' ? 'invalidPassword' : 'invalidEmail');
        } else {
          setFailure('error');
        }
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
            id="register-email"
            type="email"
            name="email"
            autoComplete="email"
            label={tAuth('emailLabel')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="register-password"
            type="password"
            name="password"
            autoComplete="new-password"
            label={tAuth('passwordLabel')}
            hint={tAuth('passwordHint')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            maxLength={128}
            required
          />

          {failure === 'emailTaken' && (
            <p
              data-testid="register-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {t('emailTaken')}
            </p>
          )}
          {failure === 'invalidEmail' && (
            <p
              data-testid="register-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {tAuth('invalidEmail')}
            </p>
          )}
          {failure === 'invalidPassword' && (
            <p
              data-testid="register-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {tAuth('invalidPassword')}
            </p>
          )}
          {failure === 'rateLimited' && (
            <p
              data-testid="register-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {tAuth('rateLimited')}
            </p>
          )}
          {failure === 'error' && (
            <p
              data-testid="register-failure"
              role="alert"
              className="text-sm font-medium text-error"
            >
              {tAuth('genericError')}
            </p>
          )}

          <Button
            type="submit"
            fullWidth
            data-testid="register-submit"
            disabled={submitting}
          >
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </form>

        <p className="mt-6 text-sm text-gray-600">
          {t('hasAccount')}{' '}
          <Link href="/login" className="font-medium text-primary-600 hover:text-primary-800">
            {t('toLogin')}
          </Link>
        </p>
      </div>
    </main>
  );
}

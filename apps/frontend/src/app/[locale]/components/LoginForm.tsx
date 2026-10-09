'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ApiFetchError, loginAccount } from '@/lib/api';
import { Button, Input } from '@/components/ui';

/** Why a submission failed; each kind maps to one i18n message. */
type Failure = 'credentials' | 'rateLimited' | 'error' | null;

/**
 * Email/password sign-in form (design D8, change email-password-auth).
 * Posts the email credential to `POST /api/v1/account/login`, which sets
 * the httpOnly session cookie; the anonymous auto-mint no longer exists.
 * Unknown email and wrong password arrive as one uniform 401 (no
 * enumeration); the AUTH rate limit can answer 429.
 *
 * Owns only the form — no page chrome — so the login page and the
 * account modal can both host it. Navigation after success is the
 * host's concern via `onSuccess`.
 *
 * @module LoginForm
 */
export default function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('Login');
  const tAuth = useTranslations('Auth');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFailure(null);
    try {
      await loginAccount(email.trim(), password);
      onSuccess();
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
  );
}

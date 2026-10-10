'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import LoginForm from '../components/LoginForm';

/**
 * Sign-in page (design D8, change email-password-auth): page chrome around
 * the shared `LoginForm`, which owns the credential state and the
 * `POST /api/v1/account/login` exchange (uniform 401 on unknown email or
 * wrong password; 429 from the AUTH rate limit). Success hands control
 * back here and lands the visitor on /account.
 *
 * @module LoginPage
 */
export default function LoginPage() {
  const t = useTranslations('Login');
  const router = useRouter();

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>

        <LoginForm onSuccess={() => router.replace('/account')} />

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

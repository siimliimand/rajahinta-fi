'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Dialog } from '@/components/ui';
import LoginForm from './LoginForm';

export interface LoginModalProps {
  /** Whether the dialog is shown; renders nothing while false. */
  open: boolean;
  /** Dismissal intents (Escape, backdrop) — forwarded to the Dialog. */
  onClose: () => void;
  /** Successful sign-in — forwarded from the LoginForm to the host. */
  onSuccess: () => void;
}

/**
 * Sign-in dialog (change add-product-favorites, task 3.3): the shared
 * `LoginForm` hosted in a modal `Dialog` — the entry point from
 * gated actions (favorites) so visitors need not leave the page they
 * are on. Reuses the login page's body and link block verbatim,
 * including its message keys; register and forgot-password leave the
 * modal flow via a full page navigation, which is spec'd.
 *
 * @module LoginModal
 */
export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const t = useTranslations('Login');

  return (
    <Dialog open={open} onClose={onClose} labelledBy="login-modal-title">
      <h2 id="login-modal-title" className="text-2xl font-bold text-primary-700">
        {t('title')}
      </h2>
      <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>

      <LoginForm onSuccess={onSuccess} />

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
    </Dialog>
  );
}

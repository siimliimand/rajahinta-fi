'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { ApiFetchError, createCalculationShare } from '@/lib/api';
import { localizedPath } from '@/lib/i18n/localized-paths';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Lifecycle of the share action (task 5.2). */
type ShareState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'shared'; readonly url: string }
  | { readonly kind: 'failed'; readonly reason: 'auth' | 'generic' };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Share action on calculation results (task 5.2, change
 * client-experience-improvement).
 *
 * Creates a frozen share snapshot through the existing sharing API
 * (`POST /api/v1/calculations/:id/share`) and presents the public
 * `/share/[publicId]` URL with copy-to-clipboard. The snapshot
 * assembler's personal-data strip assertion and the public share page's
 * contract are untouched — this component only drives the existing
 * endpoints.
 *
 * Failure mapping: 401 (no session) names signing in as the fix; every
 * other rejection (including the ownership 404) is a single honest
 * failure line, never a raw status code.
 */
export default function ShareResultAction({ recordId }: { recordId: number }) {
  const t = useTranslations('ShareResult');
  const locale = useLocale();
  const [state, setState] = useState<ShareState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    setState({ kind: 'creating' });
    setCopied(false);
    try {
      const { publicId } = await createCalculationShare(recordId);
      // The share URL goes through the localized pathnames (change
      // localize-fi-route-pathnames): the /share segment is shared by
      // both locales (routing D2), so only the /en prefix varies.
      setState({
        kind: 'shared',
        url: `${window.location.origin}${localizedPath(
          locale === 'en' ? 'en' : 'fi',
          {
            pathname: '/share/[publicId]',
            params: { publicId },
          },
        )}`,
      });
    } catch (err: unknown) {
      setState({
        kind: 'failed',
        reason:
          err instanceof ApiFetchError && err.status === 401
            ? 'auth'
            : 'generic',
      });
    }
  }, [recordId, locale]);

  const handleCopy = useCallback(async () => {
    if (state.kind !== 'shared') return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      // Clipboard permission denied — the URL stays selectable in the
      // read-only field, so the visitor can copy it manually.
      setCopied(false);
    }
  }, [state]);

  return (
    <div data-testid="share-result">
      {state.kind === 'shared' ? (
        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-600">
            {t('linkHeading')}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <input
              readOnly
              value={state.url}
              aria-label={t('linkLabel')}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
            />
            <Button size="sm" variant="secondary" onClick={handleCopy}>
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500">{t('frozenNote')}</p>
        </div>
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleShare}
            disabled={state.kind === 'creating'}
          >
            {state.kind === 'creating' ? t('sharing') : t('share')}
          </Button>
          {state.kind === 'failed' && (
            <p role="alert" className="mt-1 text-xs text-error">
              {state.reason === 'auth' ? t('authRequired') : t('failed')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ApiFetchError } from '@/lib/api';
import { Card } from '@/components/ui';

// ---------------------------------------------------------------------------
// Gate-state detection
// ---------------------------------------------------------------------------

/**
 * Recognises the launch-gate-closed rejection from the existing guarded
 * endpoints (search, calculation): HTTP 403 carrying the LaunchGateGuard's
 * "not yet publicly available" message. This is the same read mechanism the
 * page has always had — the guard's rejection itself; no new endpoint is
 * introduced.
 *
 * Age-gate 403s carry a different message and must not match.
 */
export function isLaunchGateClosedError(err: unknown): boolean {
  return (
    err instanceof ApiFetchError &&
    err.status === 403 &&
    /not yet publicly available|launch gates/i.test(err.message)
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Explanatory notice shown on the calculator page while the production
 * launch gates (legal opinion, tax-source mapping, correction mechanism)
 * are closed — replacing an unexplained API failure with a calm statement
 * of what is happening and what will be available at launch.
 *
 * `role="status"`: the notice appears asynchronously (after the guarded
 * request rejects) and should be announced politely, not assertively —
 * nothing is wrong from the visitor's point of view.
 */
export default function GateClosedNotice() {
  const t = useTranslations('GateClosed');

  return (
    <Card
      padding="lg"
      role="status"
      data-testid="gate-closed-notice"
      className="text-left"
    >
      <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{t('body')}</p>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        {t('availableAtLaunch')}
      </p>
    </Card>
  );
}

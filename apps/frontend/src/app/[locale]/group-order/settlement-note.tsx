// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';

/**
 * The accounting-only settlement-boundary note (task 9.4, change
 * product-roadmap-phases-1-4; design R12, spec: group-order-ledger).
 *
 * MANDATORY and PERSISTENT: settlement happens outside Rajahinta, and the
 * page must state that whenever it is viewed — so this renders on every
 * state of the share-link page (join, active, expired), as its own card
 * next to the ledger section, never buried behind an expansion and never
 * only after a computation. Swish, MobilePay, and a bank transfer are
 * named strictly as USER-SIDE settlement examples; there are no payment
 * buttons, payment links, or "pay now" affordances of any kind.
 *
 * @module SettlementNote
 */
export default function SettlementNote() {
  const t = useTranslations('GroupOrder');

  return (
    <Card
      as="section"
      padding="lg"
      data-testid="group-order-settlement-note"
      className="border-gray-200"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
        {t('settlementNoteTitle')}
      </h2>
      <p className="mt-2 text-sm text-gray-700">
        {t('settlementNoteBody')}
      </p>
    </Card>
  );
}

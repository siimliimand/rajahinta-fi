/**
 * Operator console page (task 12.1, change
 * technical-assessment-remediation).
 *
 * Server shell for the console at `/ops` (Finnish, default locale) and
 * `/en/ops` (English). Operational data itself never renders here — the
 * client console fetches it from the `/ops/console/**` API, which sits
 * behind the bearer-token + IP-allowlist realm and the OPERATOR_CONSOLE
 * feature flag (default OFF). The page is excluded from indexing: it is
 * an internal tool, not product surface.
 *
 * @module OpsPage
 */

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import OperatorConsole from './components/OperatorConsole';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'OperatorConsole' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default function OpsPage() {
  return <OperatorConsole />;
}

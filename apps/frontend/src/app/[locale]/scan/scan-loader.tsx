'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import nextDynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { LoadingSkeleton } from '@/components/ui';

/**
 * Client boundary for the scan surface's dynamic import (task 3.1,
 * change label-scan-product-lookup).
 *
 * `next/dynamic` with `ssr: false` is only legal inside a client
 * component — and the camera surface must be client-only twice over:
 * getUserMedia does not exist on the server, and the camera + capture +
 * upload code must stay out of the main bundle (the page.tsx doc). This
 * module carries only the dynamic import and the chunk-load fallback;
 * ./scan-client holds everything camera-related.
 */
const ScanClient = nextDynamic(() => import('./scan-client'), {
  ssr: false,
  loading: () => <ScanLoading />,
});

/** The chunk-load fallback: an announced skeleton, no camera code. */
function ScanLoading() {
  const t = useTranslations('Scan');
  return (
    <div
      data-testid="scan-loading"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <p role="status" className="mb-4 text-sm font-medium text-gray-700">
        {t('loadingLabel')}
      </p>
      <LoadingSkeleton variant="card" count={1} />
    </div>
  );
}

export default function ScanLoader() {
  return <ScanClient />;
}

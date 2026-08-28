import { notFound } from 'next/navigation';

/**
 * Catch-all for unmatched paths inside a locale. Without it, Next 14
 * renders the built-in root 404 (no root layout exists to localize);
 * routing through notFound() renders `[locale]/not-found.tsx` with the
 * active locale's copy. Unknown top-level paths reach here through the
 * middleware rewrite into the default locale.
 */
export default function CatchAllPage() {
  notFound();
}

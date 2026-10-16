/**
 * Sitemap metadata route (task 9.5) — the Next contract only (default
 * export + `revalidate`). The builder machinery lives in
 * `lib/sitemap-entries.ts` (sitemap-tree-coverage task 2.1) so the
 * sitemap-tree route handlers (tasks 2.2/2.3) can share it; emission is
 * delegated verbatim.
 *
 * @module Sitemap
 */

import type { MetadataRoute } from 'next';
import { buildSitemapEntries } from '@/lib/sitemap-entries';

export const revalidate = 900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries();
}

/**
 * Locale-aware navigation primitives.
 *
 * `Link`, `useRouter`, and `usePathname` from this module keep the active
 * locale in the URL automatically and translate hrefs through the
 * localized vocabulary in `routing.ts` (e.g. `Link href="/calculator"`
 * renders `/laskuri` in Finnish and `/en/calculator` in English). Hrefs
 * are typed to the `routing.pathnames` keys — every route navigated
 * through these primitives needs an entry there, localized or
 * explicitly shared. Use these instead of `next/link` and
 * `next/navigation` inside the app.
 *
 * @module i18n/navigation
 */

import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

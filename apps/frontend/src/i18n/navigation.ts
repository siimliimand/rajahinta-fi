/**
 * Locale-aware navigation primitives.
 *
 * `Link`, `useRouter`, and `usePathname` from this module keep the active
 * locale in the URL automatically (e.g. `Link href="/calculator"` renders
 * `/calculator` in Finnish and `/en/calculator` in English). Use these
 * instead of `next/link` and `next/navigation` inside the app.
 *
 * @module i18n/navigation
 */

import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

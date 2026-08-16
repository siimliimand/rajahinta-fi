'use client';

import Link from 'next/link';

/**
 * Saved baskets page.
 *
 * Phase 1: shows a sign-in prompt. Baskets can only be saved by
 * signed-in users. The calculator, comparison, and ranking pages
 * work without an account.
 *
 * @module SavedBasketsPage
 */
export default function SavedBasketsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6">
        <Link
          href="/account"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; My account
        </Link>
      </nav>

      <h1 className="mb-1 text-2xl font-bold text-primary-700">Saved baskets</h1>
      <p className="mb-8 text-sm text-gray-500">
        Save product selections to quickly re-run landed-cost calculations.
      </p>

      {/* ── Sign-in prompt ── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          Sign in to save baskets
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Sign in to save and manage your product baskets. Browsing the
          product catalogue, comparing products, and running calculations
          does not require an account.
        </p>
        <div className="mt-4">
          <button
            type="button"
            disabled
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white opacity-60"
            title="Sign-in will be available in a future update"
          >
            Sign in to save
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Account creation is coming in a future update. You can still
          use all core features — calculator, comparison, and ranking —
          without signing in.
        </p>
      </section>
    </main>
  );
}
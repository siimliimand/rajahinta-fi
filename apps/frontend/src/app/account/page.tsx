'use client';

import Link from 'next/link';

/**
 * Account overview page.
 *
 * Phase 1: shows a sign-in prompt. Account creation is NOT required
 * to view public product comparisons — the calculator, comparison,
 * and ranking pages all work without an account.
 *
 * @module AccountPage
 */
export default function AccountPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6">
        <Link
          href="/"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; Home
        </Link>
      </nav>

      <h1 className="mb-1 text-2xl font-bold text-primary-700">My account</h1>
      <p className="mb-8 text-sm text-gray-500">
        Manage your saved baskets, calculation history, and subscription.
      </p>

      {/* ── Sign-in prompt ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Sign in to your account</h2>
        <p className="mt-2 text-sm text-gray-600">
          Sign in to save baskets, view your calculation history, and manage
          your subscription. Browsing the product catalogue, comparing products,
          and running calculations does not require an account.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white opacity-60"
            title="Sign-in will be available in a future update"
          >
            Sign in
          </button>
          <button
            type="button"
            disabled
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 opacity-60"
            title="Account creation will be available in a future update"
          >
            Create account
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Account creation is coming in a future update.
        </p>
      </section>

      {/* ── Account-only feature list ── */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Account features
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/account/saved-baskets"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">Saved baskets</h3>
            <p className="mt-1 text-xs text-gray-500">
              Save product selections for quick re-calculation.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              Sign in to save &rarr;
            </span>
          </Link>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60">
            <h3 className="font-medium text-gray-900">Calculation history</h3>
            <p className="mt-1 text-xs text-gray-500">
              View and re-run past landed-cost calculations.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-gray-400">
              Coming soon
            </span>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60">
            <h3 className="font-medium text-gray-900">Subscription</h3>
            <p className="mt-1 text-xs text-gray-500">
              Manage your plan and billing details.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-gray-400">
              Coming soon
            </span>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60">
            <h3 className="font-medium text-gray-900">Data export</h3>
            <p className="mt-1 text-xs text-gray-500">
              Export your data in CSV or PDF format.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-gray-400">
              Coming soon
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
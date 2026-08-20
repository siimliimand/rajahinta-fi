'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSessionUserId } from '../../lib/api';

/**
 * Account overview page.
 *
 * Phase 1: shows the current session state and a list of account features.
 * The session is created automatically on first visit. Anonymous-only
 * design — no email or personal data collection.
 *
 * @module AccountPage
 */
export default function AccountPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    // getSessionUserId creates the cookie if absent, so by the time this
    // component mounts the anonymous session always exists.
    setSessionId(getSessionUserId());
  }, []);

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

      {/* ── Session status ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {sessionId ? (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              You are signed in as an anonymous user. Your session is active,
              and account features are available below.
            </p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/account/saved-baskets"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Continue &rarr;
              </Link>
              <Link
                href="/account/create"
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Create new session
              </Link>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Session ID: {sessionId.slice(0, 8)}&hellip;
              &nbsp;&middot;&nbsp; Anonymous account
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              Anonymous account
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Create an anonymous account to save baskets, view your
              calculation history, and manage your preferences. No email or
              personal data required.
            </p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/account/create"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Create account
              </Link>
            </div>
          </>
        )}
      </section>

      {/* ── Account feature list ── */}
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
              Browse saved baskets &rarr;
            </span>
          </Link>

          <Link
            href="/account"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">Calculation history</h3>
            <p className="mt-1 text-xs text-gray-500">
              View and re-run past landed-cost calculations.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              View history &rarr;
            </span>
          </Link>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-60">
            <h3 className="font-medium text-gray-900">Subscription</h3>
            <p className="mt-1 text-xs text-gray-500">
              Manage your plan and billing details.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-gray-400">
              Coming soon
            </span>
          </div>

          <Link
            href="/account"
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <h3 className="font-medium text-gray-900">Data export</h3>
            <p className="mt-1 text-xs text-gray-500">
              Export your data in JSON format.
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-primary-600">
              Export data &rarr;
            </span>
          </Link>
        </div>
      </section>

      {/* ── Data retention ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Data retention</h2>
        <p className="mt-1 text-sm text-gray-600">
          Your data is retained only as long as necessary for the service to
          function. The following policies apply automatically:
        </p>
        <dl className="mt-4 space-y-3">
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">Inactive accounts</dt>
            <dd className="text-sm text-gray-500">
              Deleted after <strong>12 months</strong> of inactivity
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">Inactive account anonymization</dt>
            <dd className="text-sm text-gray-500">
              Anonymized after <strong>6 months</strong> of inactivity
            </dd>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-2">
            <dt className="text-sm font-medium text-gray-700">Calculation history</dt>
            <dd className="text-sm text-gray-500">
              Deleted after <strong>24 months</strong>
            </dd>
          </div>
          <div className="flex justify-between pb-2">
            <dt className="text-sm font-medium text-gray-700">Analytics &amp; telemetry</dt>
            <dd className="text-sm text-gray-500">
              Anonymized after <strong>12 months</strong>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-400">
          Retention is enforced automatically. No action is needed on your part.
        </p>
      </section>
    </main>
  );
}
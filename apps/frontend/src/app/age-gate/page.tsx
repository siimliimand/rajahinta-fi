'use client';

import { AgeGate } from '../components/AgeGate';

/**
 * Standalone age-verification page.
 * Uses the same AgeGate component as the layout wrapper —
 * redirects unauthenticated visitors before showing any content.
 */
export default function AgeGatePage() {
  return (
    <AgeGate>
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <h1 className="text-3xl font-bold text-primary-700">Welcome</h1>
        <p className="mt-4 text-gray-600">
          You have been verified. You can now browse the site.
        </p>
        <a
          href="/"
          className="mt-6 rounded-md bg-primary-600 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700"
        >
          Go to home page
        </a>
      </main>
    </AgeGate>
  );
}

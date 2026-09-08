'use client';

/**
 * Shared presentational bits for the operator consoles (tasks 2.3/5.3,
 * change trust-and-reach-roadmap) — the OperatorConsole's section and
 * status-badge styling extracted so the moderation/appeal/newsletter
 * consoles render identically without growing the message catalogs
 * (the console is an internal noindex surface; its new strings are
 * locale-selected literals, not catalog keys).
 *
 * @module ConsoleUi
 */

import React from 'react';

/** Status chip — the moderation/consent lifecycles' shared palette. */
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: 'bg-amber-100 text-amber-800',
    LINKED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    PUBLISHED: 'bg-green-100 text-green-800',
    REOPENED: 'bg-amber-100 text-amber-800',
    DELIVERED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? 'bg-gray-100 text-gray-800'
      }`}
    >
      {status}
    </span>
  );
}

/** A console workflow section (OperatorConsole section styling). */
export function ConsoleSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-xs text-gray-500">{intro}</p>
      {children}
    </section>
  );
}

/** Locale-aware literal labels for the internal consoles (FI default). */
export function consoleLabels<T extends Record<string, string>>(
  locale: string,
  labels: { fi: T; en: T },
): T {
  return locale === 'en' ? labels.en : labels.fi;
}

/** Shared classes for the console's form inputs (OperatorConsole parity). */
export const inputClass =
  'mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800';

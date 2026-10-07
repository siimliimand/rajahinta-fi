'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { SanityNote } from '@/lib/types';

interface SanityNoteListProps {
  /** The trip records from the result object — empty renders nothing. */
  readonly notes: readonly SanityNote[];
}

/**
 * The degraded-state note block for results whose plausibility sanity
 * rail tripped (change unit-integrity-and-result-trust, task 2.2;
 * retitled by hedge-dedup-confidence-meter 3.1).
 *
 * Each note names the degraded input directly — the shared category label
 * leads the line and the API's own detail string names the breached
 * threshold and the actual figures; the note text is never invented or
 * reworded here. The former generic framing label
 * ("Luotettavuus alennettu: tulos on arvio") is retired: the notes
 * themselves carry the fact, with no hedging prose around them.
 *
 * Callers render this only when the result carries `sanityNotes`
 * (key-absent = plausible calculation, nothing rendered).
 */
export default function SanityNoteList({ notes }: SanityNoteListProps) {
  const t = useTranslations('CalculatorResult');

  if (notes.length === 0) return null;

  return (
    <div
      className="rounded-md bg-gray-50 px-3 py-2"
      data-testid="sanity-note"
      role="note"
    >
      <ul className="space-y-1.5">
        {notes.map((note, i) => (
          <li
            key={`${note.code}-${i}`}
            className="flex items-start gap-1.5 text-xs leading-relaxed text-gray-600"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-stale"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>
              <span className="font-medium text-gray-700">
                {t(`category.${note.component}`)}
              </span>{' '}
              {note.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

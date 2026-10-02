'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@/components/ui';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProductSearchProps {
  /** Current search query value. */
  value: string;
  /** Called when the user types in the search field. */
  onChange: (query: string) => void;
  /** Called when the user presses Enter or submits the form. */
  onSubmit: (query: string) => void;
  /** Whether a search is in flight. */
  loading: boolean;
  /** Error message to display, or null. */
  error: string | null;
  /**
   * Zero-result did-you-mean candidate from the last search response
   * (task 3.3, change finnish-first-client-experience). The API attaches
   * it only when the ranked search returned zero items, so the banner
   * never appears when results exist. Absent/null renders nothing.
   */
  suggestion?: string | null;
  /**
   * Runs the suggested query. The customer's own query stays in the
   * input — the chip searches, it never rewrites what was typed.
   */
  onSuggestion?: (query: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Product search input.
 *
 * A controlled input: every keystroke reports to `onChange` (the parent
 * debounces the actual search, task 5.2) and Enter or the search button
 * fires `onSubmit` for an immediate search. A zero-result response can
 * carry a did-you-mean candidate, rendered as a clickable chip below the
 * form (task 3.3) — clicking it runs the suggested query while the
 * customer's original spelling stays in the input.
 */
export default function ProductSearch({
  value,
  onChange,
  onSubmit,
  loading,
  error,
  suggestion,
  onSuggestion,
}: ProductSearchProps) {
  const t = useTranslations('ProductSearch');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(value);
  }

  const hasSuggestion =
    onSuggestion !== undefined &&
    typeof suggestion === 'string' &&
    suggestion.trim() !== '';

  return (
    <div className="space-y-1">
      <form onSubmit={handleSubmit} className="flex gap-2">
        {/* The Input wrapper is a block div, so it needs a flex child that
            stretches — without flex-1 the shrink-to-fit wrapper would
            collapse the field instead of filling the row. */}
        <div className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('placeholder')}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={loading || value.trim().length === 0}>
          {loading ? t('searching') : t('search')}
        </Button>
      </form>
      {error && <p className="text-sm text-error">{error}</p>}
      {hasSuggestion && (
        <div
          data-testid="search-suggestion"
          className="flex flex-wrap items-center gap-2 pt-1"
        >
          <span className="text-sm text-gray-600">{t('didYouMean')}</span>
          <button
            type="button"
            data-testid="search-suggestion-chip"
            onClick={() => onSuggestion!(suggestion!.trim())}
            className="touch-target inline-flex items-center rounded-full border border-primary-300 bg-primary-50 px-3 py-1 text-sm font-medium text-primary-800 transition-colors hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            {suggestion}
          </button>
        </div>
      )}
    </div>
  );
}

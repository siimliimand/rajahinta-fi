'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Product search input.
 *
 * A controlled input: every keystroke reports to `onChange` (the parent
 * debounces the actual search, task 5.2) and Enter or the search button
 * fires `onSubmit` for an immediate search.
 */
export default function ProductSearch({
  value,
  onChange,
  onSubmit,
  loading,
  error,
}: ProductSearchProps) {
  const t = useTranslations('ProductSearch');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(value);
  }

  return (
    <div className="space-y-1">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('placeholder')}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading || value.trim().length === 0}
          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t('searching') : t('search')}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

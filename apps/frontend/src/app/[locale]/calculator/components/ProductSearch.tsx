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
    </div>
  );
}

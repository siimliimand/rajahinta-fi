'use client';

/**
 * ScenarioControls — save-scenario form and scenario picker for the
 * calculator page (task 4.1, change phase2-advanced-features).
 *
 * Behaviour:
 *  - `enable_advanced_features` off ⇒ the section renders nothing and the
 *    scenario list request is never fired (guard runs before the fetch,
 *    same pattern as ProductHistoryPanel). A failed flag lookup also
 *    degrades to hidden.
 *  - Saving delegates to the page via `onSaveScenario` (the page owns the
 *    current calculator inputs); the component owns the name field,
 *    pending state, and the result message. A successful save refreshes
 *    the picker so the new name is immediately loadable.
 *  - Loading delegates to `onLoadScenario`; the page repopulates the
 *    calculator inputs and re-runs the calculation against current data.
 *
 * @module ScenarioControls
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SavedScenario } from '@/lib/types';
import { getFeatureFlags, listScenarios } from '@/lib/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum scenario-name length accepted by the input (controlled length). */
const MAX_NAME_LENGTH = 60;

type FlagState = 'checking' | 'enabled' | 'disabled';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScenarioControlsProps {
  /** Whether the calculator currently holds a saveable input set. */
  readonly canSave: boolean;
  /**
   * Persist the current calculator inputs under the given name.
   * Rejects on failure; the component renders the failure message.
   */
  readonly onSaveScenario: (name: string) => Promise<void>;
  /**
   * Load a scenario: repopulate the calculator inputs and re-run the
   * calculation against current data. The page surfaces calculation
   * failures through its normal error path, so this never rejects.
   */
  readonly onLoadScenario: (scenario: SavedScenario) => void;
}

export default function ScenarioControls({
  canSave,
  onSaveScenario,
  onLoadScenario,
}: ScenarioControlsProps) {
  const t = useTranslations('ScenarioControls');
  const [flag, setFlag] = useState<FlagState>('checking');
  const [scenarios, setScenarios] = useState<readonly SavedScenario[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Feature flag: hide and skip the list request when off ──
  useEffect(() => {
    let cancelled = false;
    getFeatureFlags()
      .then((res) => {
        if (cancelled) return;
        setFlag(res.flags.ADVANCED_FEATURES ? 'enabled' : 'disabled');
      })
      .catch(() => {
        // Flag state unreachable — degrade as if disabled.
        if (!cancelled) setFlag('disabled');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshScenarios = useCallback(async (): Promise<void> => {
    try {
      const rows = await listScenarios();
      setScenarios(rows);
    } catch {
      // The picker is non-critical; leave the previous list in place.
    }
  }, []);

  // ── Load the scenario list once the flag is on ──
  useEffect(() => {
    if (flag !== 'enabled') return;
    refreshScenarios();
  }, [flag, refreshScenarios]);

  // ── Hidden states: flag off or still checking ──
  if (flag !== 'enabled') {
    return null;
  }

  // ── Save handler ──
  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || saving) return;

    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await onSaveScenario(trimmed);
      setName('');
      setStatus(t('saved', { name: trimmed }));
      await refreshScenarios();
    } catch {
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ── Load handler ──
  const handleLoad = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const selected = scenarios.find((s) => String(s.id) === event.target.value);
    if (selected === undefined) return;
    // Reset the picker to the placeholder so the same scenario can be
    // re-picked later even if nothing changes.
    event.target.value = '';
    setError(null);
    setStatus(t('loaded', { name: selected.name }));
    onLoadScenario(selected);
  };

  return (
    <section
      aria-label={t('ariaLabel')}
      data-testid="scenario-controls"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h2 className="mb-3 text-sm font-semibold text-gray-700">{t('title')}</h2>

      {/* ── Save-scenario form ── */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="scenario-name" className="sr-only">
          {t('nameLabel')}
        </label>
        <input
          id="scenario-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder={t('namePlaceholder')}
          disabled={!canSave}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || name.trim().length === 0 || saving}
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="scenario-save"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
      {!canSave && (
        <p className="mt-1.5 text-xs text-gray-400">{t('selectToEnable')}</p>
      )}

      {/* ── Scenario picker ── */}
      <div className="mt-3">
        <label
          htmlFor="scenario-picker"
          className="mb-1 block text-xs font-medium text-gray-500"
        >
          {t('loadLabel')}
        </label>
        <select
          id="scenario-picker"
          onChange={handleLoad}
          value=""
          disabled={scenarios.length === 0}
          data-testid="scenario-picker"
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">
            {scenarios.length === 0
              ? t('noScenarios')
              : t('selectPlaceholder')}
          </option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Status / error messages ── */}
      {status && (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="scenario-status"
          role="status"
        >
          {status}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600" data-testid="scenario-error">
          {error}
        </p>
      )}
    </section>
  );
}

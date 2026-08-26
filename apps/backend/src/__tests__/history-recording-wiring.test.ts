/**
 * Static wiring test for the task 2.2 composition root (follows the
 * billing-ranking-isolation static-analysis precedent).
 *
 * Nest DI cannot be booted in vitest for this graph: vitest inlines the
 * symlinked workspace dist entry, whose internal index → drizzle.module →
 * drizzle.provider → index require cycle mis-evaluates under Vite's module
 * runner (decorator tokens capture as undefined), while the tsc-compiled
 * CJS the production app loads is correct — verified by `nest build` +
 * compiled-module boot in task 2.2 verification. This suite therefore
 * guards the composition statically:
 *
 * - AppModule imports HistoryRecordingModule (the recorder reaches the
 *   ingestion side of the app graph).
 * - HistoryRecordingModule is @Global, binds OFFER_CHANGE_HOOK_TOKEN to
 *   OfferChangeRecorderHook, and configures HistoryModule.forRoot with the
 *   Drizzle observation adapter, the shared ProductDataAdapter, the
 *   TaxRuleRepositoryAdapter, and the ProductRepository binding its scope
 *   needs.
 * - The request path stays clean: no controller imports the hook or the
 *   recorder.
 *
 * @module HistoryRecordingWiringTest
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tests run from the package root (apps/backend) via `pnpm test`.
const SRC = join(process.cwd(), 'src');

function readSrc(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf-8');
}

describe('HistoryRecordingModule — static composition wiring (task 2.2)', () => {
  const moduleSource = readSrc('history-recording.module.ts');
  const appModuleSource = readSrc('app.module.ts');
  const hookAdapterSource = readSrc('adapters', 'offer-change-recorder-hook.adapter.ts');

  it('AppModule imports HistoryRecordingModule', () => {
    expect(appModuleSource).toMatch(/import\s+\{[^}]*HistoryRecordingModule[^}]*\}\s+from/);
    expect(appModuleSource).toMatch(/imports:\s*\[[\s\S]*HistoryRecordingModule/);
  });

  it('is @Global and exports the hook token for the pipeline scope', () => {
    expect(moduleSource).toMatch(/@Global\(\)/);
    expect(moduleSource).toMatch(
      /provide:\s*OFFER_CHANGE_HOOK_TOKEN,\s*useClass:\s*OfferChangeRecorderHook/,
    );
    expect(moduleSource).toMatch(/exports:\s*\[OFFER_CHANGE_HOOK_TOKEN\]/);
  });

  it('configures HistoryModule.forRoot with the observation-port adapter', () => {
    expect(moduleSource).toMatch(
      /HistoryModule\.forRoot\(\{[\s\S]*priceObservationPort:\s*DrizzlePriceObservationRepository/,
    );
  });

  it('reuses the calculator product-data adapter and the tax-rule adapter', () => {
    expect(moduleSource).toMatch(/productDataPort:\s*ProductDataAdapter/);
    expect(moduleSource).toMatch(/taxRuleRepository:\s*TaxRuleRepositoryAdapter/);
    // ProductDataAdapter's repository dependency must be registered in the
    // history module scope (same extraProviders pattern as the calculator).
    expect(moduleSource).toMatch(
      /provide:\s*ProductRepository,\s*useClass:\s*DrizzleProductRepository/,
    );
  });

  it('hook adapter delegates to the recorder and maps the offer read-model', () => {
    expect(hookAdapterSource).toMatch(
      /implements\s+IOfferChangeHook/,
    );
    expect(hookAdapterSource).toMatch(/recorder\.record\(/);
    expect(hookAdapterSource).toMatch(/reliabilityStatus:\s*toReliabilityStatus/);
  });

  it('keeps the recorder off the request path — no controller touches the hook', () => {
    expect(hookAdapterSource).not.toMatch(/Controller/);
    expect(moduleSource).not.toMatch(/Controller/);
  });
});

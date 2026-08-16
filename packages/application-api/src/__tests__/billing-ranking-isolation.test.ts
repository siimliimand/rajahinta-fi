/**
 * Billing / Ranking isolation tests.
 *
 * Verifies structural separation between the billing module and the
 * Ranking & Sorting Module. No shared write path exists — a merchant
 * account (if ever introduced) cannot purchase better placement.
 *
 * ## Enforcement layers
 *
 * 1. **Compile-time (type system):** Type-level assertions prove that
 *    billing types (`SubscriptionStatus`) are structurally incompatible
 *    with ranking types (`NeutralSortInput`). Any attempt to pass one
 *    where the other is expected produces a type error at the call site.
 *
 * 2. **Compile-time (module graph):** `BillingModule`'s `@Module()`
 *    decorator declares no `imports` array referencing ranking, and its
 *    source files contain no import of ranking module paths. Same for
 *    `RankingModule` with respect to billing.
 *
 * 3. **Runtime (static analysis):** Source-file import scanning confirms
 *    zero cross-references in either direction.
 *
 * 4. **Write-path audit:** Neither module exposes any method, port, or
 *    type that could be used to write ranking-affecting data from a
 *    billing context, or vice versa.
 *
 * @module BillingRankingIsolationTests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types for compile-time structural-incompatibility proofs
// ---------------------------------------------------------------------------

import type { NeutralSortInput } from '@rajahinta/core-domain';
import type { SubscriptionStatus } from '../billing/billing.service';

/** BillingModule class — we import the module symbol to check its shape. */
import { BillingModule } from '../billing/billing.module';
import type { BillingService } from '../billing/billing.service';

// ---------------------------------------------------------------------------
// Paths for static source-file analysis
// ---------------------------------------------------------------------------

/** Billing source files to scan for ranking imports. */
const BILLING_SOURCE_FILES = [
  resolve(__dirname, '../billing/billing.module.ts'),
  resolve(__dirname, '../billing/billing.service.ts'),
  resolve(__dirname, '../billing/index.ts'),
] as const;

/** Ranking source files paths (resolved from project root). */
const RANKING_DIR = resolve(__dirname, '../../../core-domain/src/ranking');
const RANKING_SOURCE_FILES = [
  resolve(RANKING_DIR, 'ranking.module.ts'),
  resolve(RANKING_DIR, 'ranking.service.ts'),
  resolve(RANKING_DIR, 'ranking.types.ts'),
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Billing-related import patterns (module paths, type names). */
const BILLING_PATTERNS = [
  /from\s+['"].*billing['"]/,
  /from\s+['"].*\/billing/,
  /billing\.service/,
  /billing\.module/,
  /SubscriptionStatus/,
  /BillingService/,
  /BillingModule/,
] as const;

/** Ranking-related import patterns (module paths, type names). */
const RANKING_PATTERNS = [
  /from\s+['"].*ranking['"]/,
  /from\s+['"].*\/ranking/,
  /ranking\.service/,
  /ranking\.module/,
  /ranking\.types/,
  /NeutralSortInput/,
  /SortOrder/,
  /RankingService/,
  /RankingModule/,
] as const;

/**
 * Scan a source file for any of the given regex patterns.
 * Returns the list of matched lines (empty = clean).
 */
function findMatchingLines(
  filePath: string,
  patterns: readonly RegExp[],
): { line: number; text: string }[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip comment lines and blank lines
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '') {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        matches.push({ line: i + 1, text: trimmed });
        break;
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// 1. Compile-time: type incompatibility
// ---------------------------------------------------------------------------

describe('compile-time type incompatibility', () => {
  it('proves SubscriptionStatus is NOT assignable to NeutralSortInput', () => {
    // @ts-expect-error — SubscriptionStatus has userId, plan, active etc.
    // which are not fields on NeutralSortInput. If this assignment compiles
    // without error, the type-level separation has been breached.
    const _check: NeutralSortInput = {} as SubscriptionStatus;
    expect(true).toBe(true);
  });

  it('proves NeutralSortInput is NOT assignable to SubscriptionStatus', () => {
    // @ts-expect-error — NeutralSortInput has totalCents, volumeLitres etc.
    // which are not fields on SubscriptionStatus. If this assignment compiles
    // without error, the type-level separation has been breached.
    const _check: SubscriptionStatus = {} as NeutralSortInput;
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Compile-time: module shape — BillingModule is not a ranking provider
// ---------------------------------------------------------------------------

describe('compile-time module shape proof', () => {
  it('proves BillingModule does not expose ranking functionality', () => {
    // BillingModule is a NestJS module class. Verify it has no `rank` method
    // and no property/method that could influence sort placement.
    const proto = BillingModule.prototype as Record<string, unknown>;

    // These are ranking-specific operations — if any exist on BillingModule,
    // the separation has been breached.
    const rankingMethods = ['rank', 'rankItems', 'sort', 'reorder', 'boost', 'promote'];
    for (const method of rankingMethods) {
      expect(proto).not.toHaveProperty(method);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Compile-time: no billing fields leak into ranking input types
// ---------------------------------------------------------------------------

describe('compile-time ranking input neutrality', () => {
  it('proves NeutralSortInput has no billing-related field', () => {
    // If NeutralSortInput ever gains a 'plan' field (from billing), this
    // conditional type resolves to `never` and the assignment below fails.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _NoPlanField = NeutralSortInput extends { plan: string }
      ? never
      : true;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _NoSubscriptionTierField = NeutralSortInput extends {
      subscriptionTier: string;
    }
      ? never
      : true;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _NoUserIdField = NeutralSortInput extends { userId: string }
      ? never
      : true;

    // Runtime assertion: all guards resolved to `true`
    const _planCheck: _NoPlanField = true;
    const _tierCheck: _NoSubscriptionTierField = true;
    const _userCheck: _NoUserIdField = true;
    expect(_planCheck && _tierCheck && _userCheck).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Runtime: static import analysis — BillingModule → ranking prohibited
// ---------------------------------------------------------------------------

describe('static import analysis: billing → ranking', () => {
  for (const filePath of BILLING_SOURCE_FILES) {
    const fileName = filePath.split('/').pop()!;

    it(`${fileName} has no import of ranking types/services`, () => {
      const matches = findMatchingLines(filePath, RANKING_PATTERNS);

      // Filter: the billing.service.ts imports `EntitlementTier` from
      // `@rajahinta/core-domain`, which is NOT a ranking import.
      // Filter out any match containing 'entitlement' (case-insensitive).
      const filtered = matches.filter(
        (m) => !/entitlement/i.test(m.text),
      );

      expect(filtered).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Runtime: static import analysis — RankingModule → billing prohibited
// ---------------------------------------------------------------------------

describe('static import analysis: ranking → billing', () => {
  for (const filePath of RANKING_SOURCE_FILES) {
    const fileName = filePath.split('/').pop()!;

    it(`${fileName} has no import of billing types/services`, () => {
      const matches = findMatchingLines(filePath, BILLING_PATTERNS);
      expect(matches).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Write-path audit
// ---------------------------------------------------------------------------

describe('write-path audit', () => {
  it('BillingService does not expose ranking-affecting method names', () => {
    type MethodNames = keyof BillingService;

    // @ts-expect-error — "rank" must NOT be a method on BillingService.
    // If this compiles without error, BillingService has a method called
    // "rank" and the billing module can influence product placement.
    const _noRank: MethodNames = 'rank';

    // @ts-expect-error — "reorder" must NOT be a method on BillingService.
    const _noReorder: MethodNames = 'reorder';

    // @ts-expect-error — "boost" must NOT be a method on BillingService.
    const _noBoost: MethodNames = 'boost';

    expect(true).toBe(true);
  });

  it('RankingService does not accept billing-related input', () => {
    // Verify that the parameter type of RankingService.rank() has no
    // billing-related fields. We do this by checking that a type-level
    // assertion passes: billing types are structurally incompatible.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _RankInput = Parameters<
      typeof import('@rajahinta/core-domain').RankingService['prototype']['rank']
    >[0][number];

    // Verify _RankInput is exactly NeutralSortInput (no extra fields)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _RankInputIsNeutral = _RankInput extends NeutralSortInput
      ? NeutralSortInput extends _RankInput
        ? true
        : never
      : never;

    const _check: _RankInputIsNeutral = true;
    expect(_check).toBe(true);
  });
});
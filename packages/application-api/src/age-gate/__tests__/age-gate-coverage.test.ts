/**
 * Age-gate coverage test — verifies every alcohol-content controller
 * is protected by {@link AgeGateGuard}.
 *
 * Uses raw `Reflect.getMetadata` (the same mechanism NestJS's `@UseGuards`
 * writes to) to check controller-class metadata.  Fails when:
 *
 *   1. A known alcohol-content controller is missing `AgeGateGuard`.
 *   2. A controller is not explicitly categorized as "must guard" or
 *      "reviewed safe" (detects new controllers the developer forgot to
 *      classify).
 *
 * ## Adding a new controller
 *
 * 1. Import the controller class at the top of this file.
 * 2. Add it to `mustGuard` if it exposes alcohol-content data (ABV,
 *    excise estimates, etc.) — then also add `@UseGuards(AgeGateGuard)`
 *    to its class definition.
 * 3. Add it to `reviewedSafe` if it does not expose alcohol-content data.
 *
 * If neither list includes the new controller, the test fails.
 *
 * @module AgeGateCoverageTest
 */

import { describe, it, expect } from 'vitest';

import { CalculatorController } from '../../calculator/calculator.controller';
import { SearchController } from '../../search/search.controller';
import { RankingController } from '../../ranking/ranking.controller';
import { DeclarationController } from '../../declaration/declaration.controller';
import { AccountController } from '../../accounts/account.controller';
import { CorrectionController } from '../../correction/correction.controller';
import { AnalyticsController } from '../../analytics/analytics.controller';
import { OutboundRedirectController } from '../../analytics/outbound-redirect.controller';
import { OpsDashboardController } from '../../observability/ops-dashboard.controller';
import { CalculationController, HealthController } from '../../index';

import { AgeGateGuard } from '../age-gate.guard';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NestJS internal metadata key written by the `@UseGuards` decorator. */
const GUARDS_METADATA = '__guards__';

/** All controllers registered in the application-api module. */
const ALL_CONTROLLERS = [
  CalculatorController,
  SearchController,
  RankingController,
  DeclarationController,
  AccountController,
  CorrectionController,
  AnalyticsController,
  OutboundRedirectController,
  OpsDashboardController,
  CalculationController,
  HealthController,
] as const;

// ---------------------------------------------------------------------------
// Controller classifications
// ---------------------------------------------------------------------------

/**
 * Controllers that expose alcohol-content data (product ABV, excise
 * estimates, calculator results, etc.) and MUST have `AgeGateGuard`
 * applied at the class level.
 */
const MUST_GUARD = new Set([
  CalculatorController,
  SearchController,
  RankingController,
  DeclarationController,
  CalculationController,
]);

/**
 * Controllers explicitly reviewed as NOT exposing alcohol-content data.
 * These do not need `AgeGateGuard`.
 *
 * If you add a controller here, be certain its routes never return
 * alcohol-by-volume, excise amounts, or any alcohol-content data.
 */
const REVIEWED_SAFE = new Set([
  AccountController,
  CorrectionController,
  AnalyticsController,
  OutboundRedirectController,
  OpsDashboardController,
  HealthController,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the class-level guard constructors registered via `@UseGuards`.
 */
function getClassGuards(
  controller: abstract new (...args: never[]) => unknown,
): Array<abstract new (...args: never[]) => unknown> {
  return (
    Reflect.getMetadata(GUARDS_METADATA, controller) ?? []
  );
}

/**
 * Check whether a controller has `AgeGateGuard` in its class-level guards.
 */
function hasAgeGateGuard(
  controller: abstract new (...args: never[]) => unknown,
): boolean {
  const guards = getClassGuards(controller);
  return guards.some((g) => g === AgeGateGuard);
}

// ===========================================================================
// Tests
// ===========================================================================

describe('AgeGateGuard coverage — alcohol-content controllers', () => {
  // ========================================================================
  // 1. Every controller in the application is explicitly categorised
  // ========================================================================

  describe('all controllers are explicitly categorised', () => {
    it.each(ALL_CONTROLLERS)(
      '%s is in must-guard or reviewed-safe list',
      (controller) => {
        expect(
          MUST_GUARD.has(controller as any) ||
          REVIEWED_SAFE.has(controller as any),
        ).toBe(true);
      },
    );

    it('the two lists do not overlap', () => {
      for (const ctrl of MUST_GUARD) {
        expect((REVIEWED_SAFE as Set<unknown>).has(ctrl)).toBe(false);
      }
    });
  });

  // ========================================================================
  // 2. Every must-guard controller has AgeGateGuard at the class level
  // ========================================================================

  describe('alcohol-content controllers are guarded', () => {
    it.each(Array.from(MUST_GUARD))(
      '%s has AgeGateGuard via class-level @UseGuards',
      (controller) => {
        expect(hasAgeGateGuard(controller)).toBe(true);
      },
    );
  });

  // ========================================================================
  // 3. Reviewed-safe controllers must NOT have AgeGateGuard
  //    (they should not require age confirmation)
  // ========================================================================

  describe('reviewed-safe controllers do not have AgeGateGuard', () => {
    it.each(Array.from(REVIEWED_SAFE))(
      '%s does NOT have AgeGateGuard',
      (controller) => {
        expect(hasAgeGateGuard(controller)).toBe(false);
      },
    );
  });

  // ========================================================================
  // 4. New controller detection — if a new controller is added to the
  //    application but not to either list, the test fails.
  // ========================================================================

  describe('new controller detection', () => {
    it('every imported controller is in at least one set', () => {
      // This is a blanket check: ALL_CONTROLLERS is the source of truth,
      // and every controller must be in MUST_GUARD or REVIEWED_SAFE.
      // A new controller that is imported but not classified will cause
      // the "all controllers are categorised" test above to fail.
      //
      // Developer workflow:
      //   1. Add a new @Controller class.
      //   2. Import it above and add it to ALL_CONTROLLERS.
      //   3. Add it to MUST_GUARD (if it exposes alcohol data) and
      //      add @UseGuards(AgeGateGuard), or add it to REVIEWED_SAFE.
      const unionSize = MUST_GUARD.size + REVIEWED_SAFE.size;
      expect(unionSize).toBeGreaterThanOrEqual(ALL_CONTROLLERS.length);
    });
  });

  // ========================================================================
  // 5. Individually verify each must-guard controller's guard set
  // ========================================================================

  describe('individual guard verification', () => {
    it('CalculatorController has AgeGateGuard', () => {
      expect(hasAgeGateGuard(CalculatorController)).toBe(true);
    });

    it('SearchController has AgeGateGuard', () => {
      expect(hasAgeGateGuard(SearchController)).toBe(true);
    });

    it('RankingController has AgeGateGuard', () => {
      // Added by the phase-0-1-verification-fix workstream (M8).
      expect(hasAgeGateGuard(RankingController)).toBe(true);
    });

    it('DeclarationController has AgeGateGuard', () => {
      // Added by the phase-0-1-verification-fix workstream (M8) —
      // declaration summaries expose ABV and excise data.
      expect(hasAgeGateGuard(DeclarationController)).toBe(true);
    });

    it('CalculationController has AgeGateGuard', () => {
      // Inline in index.ts, exposes excise calculation that accepts
      // alcohol-by-volume input.
      expect(hasAgeGateGuard(CalculationController)).toBe(true);
    });
  });
});
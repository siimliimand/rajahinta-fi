/**
 * Guard composition (task 3.2) — registers the ported Nest guards as Hono
 * middleware with route scoping copied from the controllers' `@UseGuards`
 * decorations (change migrate-to-cloudflare, design D1: guard semantics
 * are preserved; the Nest DI plumbing is rewritten once, here).
 *
 * ## Route-coverage map (Nest controller → Worker middleware)
 *
 * | Controller (route prefix)        | Nest guards                                   | Worker middleware |
 * |----------------------------------|-----------------------------------------------|----------------------------------------------|
 * | CalculatorController (/api/v1/calculator) | class: RateLimit, LaunchGate(CALCULATION), LaunchGateGuard, AgeGateGuard | requireLaunchGate('CALCULATION'), ageGate() |
 * | SearchController (/api/v1/products)       | class: LaunchGate(PRICE_DATA), LaunchGateGuard, AgeGateGuard             | requireLaunchGate('PRICE_DATA'), ageGate() |
 * | BasketOptimizerController (/api/v1/basket)| class: RateLimit, FeatureFlagGuard, @FeatureFlag(BASKET_OPTIMIZATION)    | requireFeatureFlag('BASKET_OPTIMIZATION') |
 * | DeclarationController (/api/v1/declaration)| class: AgeGateGuard; GET :recordId: EntitlementGuard + RequireFeature   | ageGate(); requireFeature('declaration:summary') on GET /:recordId |
 * | AccountController (/api/v1/account)       | class: SessionAuthGuard; scenarios: FeatureFlagGuard(ADVANCED_FEATURES)  | sessionAuth() per route; + flag on scenarios |
 * | SessionController (/api/v1/account)       | POST session: RateLimit only; rotate/revoke: SessionAuthGuard            | rotate + DELETE session: sessionAuth(); POST session stays public |
 * | OpsDashboardController (/ops/health)      | OpsAccessGuard                                                           | opsAccess() |
 * | Ops console (4 controllers, /ops/console/*)| OpsAccessGuard + FeatureFlagGuard(OPERATOR_CONSOLE)                      | opsAccess(), requireFeatureFlag('OPERATOR_CONSOLE') |
 *
 * Rate limiting (RateLimitGuard) is not in this task's scope — it ports
 * with the RateLimiterDO wiring (task 3.3) and slots into the same
 * registrations ahead of the guards.
 *
 * Controllers with no guard decorations (health, feature-flags index,
 * outbound redirects, …) are deliberately absent.
 *
 * @module guards
 */

import type { Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ageGate } from './age-gate';
import { requireFeature } from './entitlement';
import { requireFeatureFlag } from './feature-flags';
import { requireLaunchGate } from './launch-gate';
import { opsAccess } from './ops-access';
import { sessionAuth } from './session-auth';

/** HTTP methods used by the guarded Nest routes. */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** A method-scoped middleware registration (Nest @UseGuards parity). */
interface GuardedRoute {
  /** HTTP methods the Nest route(s) respond to. */
  readonly methods: HttpMethod[];
  /** Path pattern — exact or one `:param`/`*` segment per Nest route. */
  readonly path: string;
  /** Middleware chain in Nest guard order. */
  readonly use: MiddlewareHandler<AppEnv>[];
}

/**
 * Method-scoped registrations. Anything class-level in Nest (whole
 * controller prefix) is registered below via `app.use`; these are the
 * per-method routes where Nest scoping is narrower than a prefix — most
 * importantly POST /api/v1/account/session, which MUST stay unguarded
 * (it issues anonymous sessions).
 */
const GUARDED_ROUTES: readonly GuardedRoute[] = [
  // DeclarationController — GET :recordId adds the entitlement on top of
  // the class-level age gate (registered as a prefix below).
  {
    methods: ['GET'],
    path: '/api/v1/declaration/:recordId',
    use: [requireFeature('declaration:summary')],
  },

  // AccountController — class-level SessionAuthGuard, enumerated per
  // method so the SessionController's POST /session (same prefix) stays
  // public. Scenarios add the method-level FeatureFlagGuard.
  { methods: ['GET'], path: '/api/v1/account/export', use: [sessionAuth()] },
  {
    methods: ['GET', 'POST'],
    path: '/api/v1/account/baskets',
    use: [sessionAuth()],
  },
  {
    methods: ['DELETE'],
    path: '/api/v1/account/baskets/:basketId',
    use: [sessionAuth()],
  },
  {
    methods: ['GET', 'POST'],
    path: '/api/v1/account/history',
    use: [sessionAuth()],
  },
  {
    methods: ['GET'],
    path: '/api/v1/account/subscription',
    use: [sessionAuth()],
  },
  {
    methods: ['POST'],
    path: '/api/v1/account/verify-email',
    use: [sessionAuth()],
  },
  {
    methods: ['GET', 'POST'],
    path: '/api/v1/account/scenarios',
    use: [sessionAuth(), requireFeatureFlag('ADVANCED_FEATURES')],
  },
  {
    methods: ['DELETE'],
    path: '/api/v1/account/scenarios/:id',
    use: [sessionAuth(), requireFeatureFlag('ADVANCED_FEATURES')],
  },

  // SessionController — method-level SessionAuthGuard; POST /session
  // (issuance) is rate-limited only in Nest and must stay public here.
  {
    methods: ['POST'],
    path: '/api/v1/account/session/rotate',
    use: [sessionAuth()],
  },
  {
    methods: ['DELETE'],
    path: '/api/v1/account/session',
    use: [sessionAuth()],
  },

  // OpsDashboardController — OpsAccessGuard only (no console flag).
  { methods: ['GET'], path: '/ops/health', use: [opsAccess()] },
];

/**
 * Register the ported guards on the app with Nest-parity route scoping.
 * Class-level controller guards become prefix `app.use` registrations;
 * method-level guards become `app.on` registrations that compose ahead of
 * the route handlers (tasks 3.5–3.8 append handlers to the same routes).
 *
 * Middleware read configuration lazily from `c.env` per request; env vars
 * are static per isolate, so resolution is stable for a deployment's
 * lifetime — the Worker equivalent of the Nest guards' construction-time
 * env reads.
 */
export function registerGuardMiddleware(app: Hono<AppEnv>): Hono<AppEnv> {
  // CalculatorController — class-level LaunchGate(CALCULATION) +
  // LaunchGateGuard + AgeGateGuard (guard order; rate limit slots in
  // ahead of these at task 3.3).
  app.use('/api/v1/calculator/*', requireLaunchGate('CALCULATION'), ageGate());

  // SearchController — class-level LaunchGate(PRICE_DATA) + AgeGateGuard.
  app.use('/api/v1/products/*', requireLaunchGate('PRICE_DATA'), ageGate());

  // BasketOptimizerController — class-level FeatureFlag(BASKET_OPTIMIZATION).
  app.use('/api/v1/basket/*', requireFeatureFlag('BASKET_OPTIMIZATION'));

  // DeclarationController — class-level AgeGateGuard.
  app.use('/api/v1/declaration/*', ageGate());

  // Ops console controllers (governance / audit / corrections /
  // confirmations) — OpsAccessGuard + FeatureFlagGuard(OPERATOR_CONSOLE)
  // at class level; all four share the /ops/console prefix.
  app.use('/ops/console/*', opsAccess(), requireFeatureFlag('OPERATOR_CONSOLE'));

  for (const route of GUARDED_ROUTES) {
    for (const method of route.methods) {
      // Hono's on() overloads take fixed handler tuples; the guarded
      // routes carry one or two middleware (guard order preserved).
      if (route.use.length === 1) {
        app.on(method, route.path, route.use[0]);
      } else {
        app.on(method, route.path, route.use[0], route.use[1]);
      }
    }
  }

  return app;
}

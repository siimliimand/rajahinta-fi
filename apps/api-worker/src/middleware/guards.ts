/**
 * Guard composition (task 3.2) — registers the ported Nest guards as Hono
 * middleware with route scoping copied from the controllers' `@UseGuards`
 * decorations (change migrate-to-cloudflare, design D1: guard semantics
 * are preserved; the Nest DI plumbing is rewritten once, here).
 *
 * The feature-flag and launch-gate systems were removed by decision — no
 * route denies service based on FF_* or LAUNCH_GATE_* env vars. The age
 * gate (legal), entitlement checks (subscription seam), and ops access
 * (security) are kept.
 *
 * ## Route-coverage map (Nest controller → Worker middleware)
 *
 * | Controller (route prefix)        | Nest guards                                   | Worker middleware |
 * |----------------------------------|-----------------------------------------------|----------------------------------------------|
 * | CalculatorController (/api/v1/calculator) | class: RateLimit, AgeGateGuard | ageGate() |
 * | SearchController (/api/v1/products)       | class: AgeGateGuard             | ageGate() — scoped to GET /api/v1/products and GET /api/v1/products/:id |
 * | BasketOptimizerController (/api/v1/basket)| class: RateLimit                | — |
 * | DeclarationController (/api/v1/declaration)| class: AgeGateGuard; GET :recordId: EntitlementGuard + RequireFeature   | ageGate(); requireFeature('declaration:summary') on GET /:recordId |
 * | AccountController (/api/v1/account)       | class: SessionAuthGuard         | sessionAuth() per route |
 * | Credential routes (NEW, email-password-auth D2) | POST register + login + password/reset-request: rate-limit AUTH (public); GET me + POST verify-email/request: sessionAuth; POST verify-email/confirm + POST password/reset: PUBLIC (the token IS the capability) | AUTH limiter and sessionAuth() per route below; confirm/reset register no guard |
 * | SessionController (/api/v1/account)       | rotate/revoke: SessionAuthGuard            | rotate + DELETE session: sessionAuth(); the anonymous POST /session issuance route is DELETED (register/login replace it) |
 * | PriceAlertsRoutes (NEW surface, product-roadmap-phases-1-4) (/api/v1/account/alerts) | no Nest counterpart | sessionAuth(); per-account rate limit registers on the routes (needs the resolved identity) |
 * | GroupOrderRoutes (NEW surface, product-roadmap-phases-1-4) (/api/v1/group-orders) | no Nest counterpart | POST create only: sessionAuth(); the token-scoped participant routes carry NO sessionAuth (the share token is the capability) |
 * | OpsDashboardController (/ops/health)      | OpsAccessGuard                                                           | opsAccess() |
 * | Ops console (4 controllers, /ops/console/*)| OpsAccessGuard                      | opsAccess() |
 *
 * Rate limiting (RateLimitGuard) is not in this task's scope — it ports
 * with the RateLimiterDO wiring (task 3.3) and slots into the same
 * registrations ahead of the guards.
 *
 * Controllers with no guard decorations (health, outbound redirects, …)
 * are deliberately absent.
 *
 * @module guards
 */

import type { Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ageGate } from './age-gate';
import { requireFeature } from './entitlement';
import { opsAccess } from './ops-access';
import { sessionAuth } from './session-auth';
import { requireRateLimit } from './rate-limit';

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
 * importantly the credential routes (email-password-auth D2), where the
 * public ones are rate-limited only and the capability routes stay
 * guard-free by design.
 */
const GUARDED_ROUTES: readonly GuardedRoute[] = [
  // DeclarationController — GET :recordId adds the entitlement on top of
  // the class-level age gate (registered as a prefix below).
  {
    methods: ['GET'],
    path: '/api/v1/declaration/:recordId',
    use: [requireFeature('declaration:summary')],
  },

  // Credential routes (tasks 2.2/2.3, change email-password-auth, design
  // D2/D5). register/login/password-reset-request are PUBLIC — the AUTH
  // limiter (10 req / 5 min / IP, design D5) is the brute-force defence
  // and composes ahead of the handler. verify-email/confirm and
  // password/reset deliberately stay OUT of this table: the emailed
  // single-use token IS the capability, a session would add nothing.
  { methods: ['POST'], path: '/api/v1/account/register', use: [requireRateLimit('AUTH')] },
  { methods: ['POST'], path: '/api/v1/account/login', use: [requireRateLimit('AUTH')] },
  {
    methods: ['POST'],
    path: '/api/v1/account/password/reset-request',
    use: [requireRateLimit('AUTH')],
  },
  { methods: ['GET'], path: '/api/v1/account/me', use: [sessionAuth()] },
  {
    methods: ['POST'],
    path: '/api/v1/account/verify-email/request',
    use: [sessionAuth()],
  },

  // AccountController — class-level SessionAuthGuard, enumerated per
  // method so the credential routes above (same prefix) keep their own
  // composition.
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
    methods: ['GET', 'POST'],
    path: '/api/v1/account/scenarios',
    use: [sessionAuth()],
  },
  {
    methods: ['DELETE'],
    path: '/api/v1/account/scenarios/:id',
    use: [sessionAuth()],
  },

  // PriceAlertsRoutes (task 2.3, change product-roadmap-phases-1-4) — NEW
  // surface, no Nest counterpart. Session first (the scenarios-route order
  // pinned by route-coverage: an anonymous caller gets the 401 envelope).
  // The per-account rate limit is NOT listed here — requireAccountRateLimit
  // keys the bucket on the resolved identity, so it registers on the route
  // handlers themselves, composing after this guard.
  {
    methods: ['GET', 'POST'],
    path: '/api/v1/account/alerts',
    use: [sessionAuth()],
  },
  {
    methods: ['PATCH', 'DELETE'],
    path: '/api/v1/account/alerts/:alertId',
    use: [sessionAuth()],
  },

  // GroupOrderRoutes (task 9.3, change product-roadmap-phases-1-4) — only
  // the session-create route is owner-authenticated (an anonymous caller
  // gets the 401 envelope). The token-scoped participant routes
  // (join/items/ledger) deliberately stay OUT of this table: participants
  // join by share link without an account (the share token IS the
  // capability, spec: participant joins by link).
  {
    methods: ['POST'],
    path: '/api/v1/group-orders',
    use: [sessionAuth()],
  },

  // SessionController — method-level SessionAuthGuard; the anonymous
  // POST /session issuance route was DELETED (register/login are the
  // only session-issuing endpoints, change email-password-auth).
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

  // OpsDashboardController — OpsAccessGuard only.
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
  // CalculatorController — class-level AgeGateGuard (the removed launch
  // gate never re-denies the surface; rate limit slots in ahead at
  // index.ts).
  app.use('/api/v1/calculator/*', ageGate());

  // SearchController — class-level AgeGateGuard, scoped to the
  // controller's two routes: HistoricalDataController shares the
  // /api/v1/products URL prefix in Nest, and Nest applies class guards
  // per CONTROLLER — the historical route must not inherit the search
  // gates (its own guard set registers with the task-3.6 route port).
  app.on('GET', '/api/v1/products', ageGate());
  app.on('GET', '/api/v1/products/:id', ageGate());

  // DeclarationController — class-level AgeGateGuard.
  app.use('/api/v1/declaration/*', ageGate());

  // Ops console controllers (governance / audit / corrections /
  // confirmations) — OpsAccessGuard at class level; all four share the
  // /ops/console prefix.
  app.use('/ops/console/*', opsAccess());

  for (const route of GUARDED_ROUTES) {
    for (const method of route.methods) {
      // Hono's on() overloads take fixed handler tuples; each guarded
      // route carries exactly one middleware today, but the tuple form
      // keeps multi-guard entries expressible.
      if (route.use.length === 1) {
        app.on(method, route.path, route.use[0]);
      } else {
        app.on(method, route.path, route.use[0], route.use[1]);
      }
    }
  }

  return app;
}

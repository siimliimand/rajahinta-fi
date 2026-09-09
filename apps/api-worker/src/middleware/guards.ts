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
 * | Shop-report submission (NEW surface, trust-and-reach-roadmap 2.2) (POST /api/v1/reports) | no Nest counterpart | requireRateLimit('AUTH') → sessionAuth() |
 * | Outcome + share writes (NEW surface, trust-and-reach-roadmap 3.2/6.1) (POST /api/v1/calculations/:id/{outcome,share}) | no Nest counterpart | sessionAuth() (the prefix's CALCULATOR rate limit registers at index.ts) |
 * | Newsletter (NEW surface, trust-and-reach-roadmap 5.3) (/api/v1/newsletter/*) | no Nest counterpart | POST subscribe: requireRateLimit('AUTH') (public write; consent is account-independent — no session exists); GET confirm + unsubscribe: NO guard (the emailed token IS the capability — verify-email/confirm precedent) |
 * | Ops console (4 controllers, /ops/console/*) + moderation/newsletter additions (trust-and-reach-roadmap 2.3/5.3: reports queue, blacklist publish/appeals, newsletter notify) | OpsAccessGuard | opsAccess() (prefix registration below covers every /ops/console/** route) |
 *
 * ## Route inventory — chains registered per-route (NOT in GUARDED_ROUTES)
 *
 * These surfaces register their guard chains in their own route files
 * (route-specific needs — e.g. the trip fill entitlement or the
 * historical route's narrow age gate). Listed here so the inventory
 * covers every registered route and its rate-limit profile; the
 * route-coverage test pins the full route set against this map.
 *
 * | Route (file) | Chain in registration order | Rate-limit profile |
 * |---|---|---|
 * | GET /api/v1/products/:id/price-history (historical.routes.ts) | requireRateLimit('HISTORICAL') at index.ts → ageGate() per-route | HISTORICAL |
 * | GET /api/v1/products/:id/price-context (insight-surfaces 3.2, price-context.routes.ts) | requireRateLimit('HISTORICAL') at index.ts → ageGate() per-route | HISTORICAL |
 * | GET /api/v1/savings (insight-surfaces 2.3, savings.routes.ts) | ageGate() → requireRateLimit('SAVINGS') per-route | SAVINGS |
 * | GET /api/v1/reports/:recordId calculation-record export (reports.routes.ts) | requireRateLimit('DECLARATION') at index.ts → ageGate() → attachOptionalSession → requireFeature('calculation:export') per-route | DECLARATION |
 * | GET /api/v1/unitprice/ranking (trust-and-reach-roadmap 7.2, unitprice.routes.ts) | ageGate() per-route (product-surface parity: alcoholic-beverage listing) | none (public read) |
 * | POST /api/v1/trip/fill (trust-and-reach-roadmap 8.2, trip.routes.ts) | requireRateLimit('CALCULATOR') → sessionAuth() → requireFeature('calculation:basic') per-route (spec: authenticated users only; entitlement is the calculation-surface paywall seam) | CALCULATOR |
 * | POST /api/v1/what-if/excise, POST /api/v1/event-calc, POST /api/v1/trip-feasibility (own route files) | requireRateLimit('CALCULATOR') per-route | CALCULATOR |
 * | GET /api/v1/products/:id/dupes, GET /api/v1/lists, GET /api/v1/lists/:slug, GET /api/v1/outbound/:offerId, GET /api/v1/outbound/ferry/:offerId (own route files) | requireRateLimit('DEFAULT') per-route | DEFAULT |
 * | POST /api/v1/account/session/rotate (accounts.routes.ts) | requireRateLimit('DEFAULT') per-route, then sessionAuth() from GUARDED_ROUTES below | DEFAULT |
 * | GET /api/v1/account/alerts(+:alertId), POST /api/v1/group-orders | sessionAuth() from GUARDED_ROUTES below, then requireAccountRateLimit('DEFAULT') on the handlers (keys the bucket on the resolved identity) | DEFAULT (per-account) |
 * | GET /api/v1/merchants/reliability (merchants.routes.ts) | ageGate() per-route | none (public read) |
 *
 * Guard-free surfaces with no rate limit (reviewed-safe public reads and
 * token-capability exchanges): GET /api/v1/health(+/ready), GET
 * /api/v1/accuracy (trust-and-reach-roadmap 3.3), GET /api/v1/blog/posts
 * (+:/:slug, 5.1) + GET /api/v1/guides (insight-surfaces 5.1), GET
 * /api/v1/share/:publicId (6.1), POST
 * /api/v1/analytics/click, GET /api/v1/newsletter/confirm +
 * /unsubscribe (5.3, emailed token IS the capability), POST
 * /api/v1/account/password/reset + /verify-email/confirm (same
 * precedent), and the group-order participant routes (share token IS
 * the capability).
 *
 * Rate limiting composes ahead of the guards (RateLimiterDO wiring,
 * task 3.3): prefix profiles register at index.ts
 * (/api/v1/calculator/*, /api/v1/calculations/*, /api/v1/basket/*,
 * /api/v1/products/:id/price-history,
 * /api/v1/products/:id/price-context, /api/v1/reports/:recordId — the
 * latter two narrowed so POST /api/v1/reports carries ONLY its AUTH
 * profile), route-local profiles register in the route files listed
 * above, and the AUTH-profile public writes register in GUARDED_ROUTES
 * below.
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

  // Shop-blacklist report submission (task 2.2, change
  // trust-and-reach-roadmap) — a public write surface, so the AUTH
  // limiter (credential-route precedent) composes FIRST and the report
  // binds to the session-resolved account. Nest guard order: rate limit
  // before authentication.
  {
    methods: ['POST'],
    path: '/api/v1/reports',
    use: [requireRateLimit('AUTH'), sessionAuth()],
  },

  // Outcome reporting + share-link creation (tasks 3.2/6.1, change
  // trust-and-reach-roadmap) — owner-scoped writes under the shared
  // /api/v1/calculations prefix (whose CALCULATOR rate limit registers
  // at index.ts, ahead of this guard).
  {
    methods: ['POST'],
    path: '/api/v1/calculations/:id/outcome',
    use: [sessionAuth()],
  },
  {
    methods: ['POST'],
    path: '/api/v1/calculations/:id/share',
    use: [sessionAuth()],
  },

  // Newsletter subscribe (task 5.3, change trust-and-reach-roadmap) — a
  // public bulk-mail entry point, so the AUTH limiter (credential-route
  // precedent) is the abuse defence. Consent is account-independent by
  // design: NO sessionAuth (an anonymous visitor subscribes). The
  // confirm/unsubscribe routes stay OUT of this table — the emailed
  // token IS the capability (verify-email/confirm precedent).
  {
    methods: ['POST'],
    path: '/api/v1/newsletter/subscribe',
    use: [requireRateLimit('AUTH')],
  },

  // No /ops/health entry: the Nest OpsDashboardController health route was
  // never ported — liveness/readiness live at /api/v1/health(+/ready),
  // which register no guard (see health.routes.ts).
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

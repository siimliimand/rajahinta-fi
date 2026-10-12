/**
 * Frontend Worker binding types (product-page-cold-latency 3.1).
 *
 * The runtime env type the code actually sees is the OpenNext adapter's
 * ambient `CloudflareEnv` (`getCloudflareContext().env`), so the
 * `API_WORKER` service binding is declared there by interface merging.
 * (`wrangler types` would generate a parallel `interface Env` from
 * wrangler.jsonc; nothing consumes that name yet.)
 *
 * Optional, like every adapter binding: outside the deployed worker the
 * binding is genuinely absent, and its presence is environment
 * detection, not a feature flag.
 *
 * Structural minimal type of a Worker service binding (a Fetcher): the
 * code only ever calls `fetch` on it, and `@cloudflare/workers-types` is
 * not a dependency of this workspace to import the nominal type from.
 */
interface ServiceFetcherBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface CloudflareEnv {
  /** SSR-only public catalog reads (lib/server-api.ts) → the API Worker. */
  API_WORKER?: ServiceFetcherBinding;
}

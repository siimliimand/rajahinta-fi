/**
 * Vitest-pool stubs for the `cloudflare:workers` / `cloudflare:workflows`
 * runtime modules (vitest.config aliases both here — the Node pool cannot
 * resolve the workerd built-ins).
 *
 * Only what the entry-script re-exports need at COLLECTION time:
 * `WorkflowEntrypoint` as a constructible base class and
 * `NonRetryableError` as an Error subclass. The workflow's step logic
 * never runs under vitest (the ingeston core is import-free by design);
 * these stubs exist so importing src/index.ts — which re-exports the
 * entrypoint class for runtime registration — stays testable.
 *
 * @module CloudflareModulesStub
 */

export class WorkflowEntrypoint<Env = unknown> {
  readonly env: Env;
  readonly ctx: unknown;

  constructor(env: Env, ctx: unknown) {
    this.env = env;
    this.ctx = ctx;
  }
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export type WorkflowEvent<P> = { readonly payload: P };
export type WorkflowStep = object;

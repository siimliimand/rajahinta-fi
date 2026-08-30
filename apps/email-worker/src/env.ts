/**
 * Environment bindings for the email Worker (migrate-to-cloudflare task 5.3).
 *
 * Kept as plain interfaces (no `@cloudflare/workers-types` coupling in the
 * domain of this app) so unit tests can construct fakes without the Workers
 * runtime.
 *
 * @module env
 */

/** Structured message the Cloudflare `send_email` binding consumes. */
export interface SendEmailBindingMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly reply_to?: string;
}

/** Shape of the `send_email` binding under key `EMAIL` in wrangler.jsonc. */
export interface SendEmailBinding {
  send(message: SendEmailBindingMessage): Promise<unknown>;
}

/** Bindings and config the Worker reads from the request environment. */
export interface WorkerEnv {
  /** Cloudflare Email Service `send_email` binding (SPF/DKIM managed by Cloudflare). */
  readonly EMAIL: SendEmailBinding;
  /**
   * Shared secret required in the `X-Email-Send-Secret` request header.
   * Worker Secret — set per environment via `wrangler secret put`; never a
   * committed var and never defaulted.
   */
  readonly EMAIL_SEND_SECRET: string;
  /**
   * Verified sender address used as the MIME `From` header. Must live on the
   * domain verified in Cloudflare Email Service (see RUNBOOK.md).
   */
  readonly EMAIL_FROM: string;
}

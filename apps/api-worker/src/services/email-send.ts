/**
 * Shared transport for the email Worker's internal send contract
 * (POST /internal/email/send, apps/email-worker).
 *
 * Cloudflare blocks same-account Worker-to-Worker subrequests over
 * workers.dev hostnames (error 1042), so production dispatches through
 * the EMAIL_WORKER service binding; the URL form remains as the
 * fallback for local runs and tests without a binding.
 *
 * The shared-secret header is byte-parity with SEND_SECRET_HEADER in
 * apps/email-worker/src/app.ts. The callers keep their
 * log-only-never-throw policies — this helper throws on transport or
 * rejection and the CALLER decides what a failure means.
 *
 * @module email-send
 */

/** Send-contract path on the email Worker. */
export const EMAIL_SEND_PATH = '/internal/email/send';

/** Shared-secret header — byte-parity with the email Worker's app.ts. */
export const EMAIL_SEND_SECRET_HEADER = 'x-email-send-secret';

/**
 * Where the send contract lives: the EMAIL_WORKER service binding when
 * bound (production/staging), else the configured base URL (tests,
 * local). The secret is always required — the email Worker rejects
 * unauthenticated sends.
 */
export interface EmailDispatchTarget {
  readonly binding?: Fetcher;
  readonly baseUrl?: string;
  readonly sendSecret?: string;
}

/** The structured body the send contract accepts. */
export interface EmailDispatchBody {
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
}

/** True when dispatch could plausibly reach the email Worker. */
export function isEmailSendConfigured(target: EmailDispatchTarget): boolean {
  return Boolean(target.sendSecret) && Boolean(target.binding || target.baseUrl);
}

/** Origin used for binding-dispatched requests (path is what routes). */
const BINDING_REQUEST_ORIGIN = 'https://rajahinta-email.internal';

/**
 * POST one email to the email Worker's internal send contract.
 * Binding-first; throws on transport or rejection (`HTTP <status>`).
 */
export async function dispatchEmailToWorker(
  target: EmailDispatchTarget,
  mail: EmailDispatchBody,
): Promise<void> {
  if (!isEmailSendConfigured(target)) {
    throw new Error('email worker is not configured (EMAIL_WORKER binding / EMAIL_WORKER_URL + EMAIL_SEND_SECRET)');
  }
  const url = `${(target.baseUrl ?? BINDING_REQUEST_ORIGIN).replace(/\/+$/, '')}${EMAIL_SEND_PATH}`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [EMAIL_SEND_SECRET_HEADER]: target.sendSecret!,
    },
    body: JSON.stringify({
      to: mail.to,
      subject: mail.subject,
      ...(mail.text !== undefined ? { text: mail.text } : {}),
      ...(mail.html !== undefined ? { html: mail.html } : {}),
    }),
  };
  // Binding fetch takes a Request; global fetch keeps the (url, init)
  // form the tests stub.
  const response = target.binding
    ? await target.binding.fetch(new Request(url, init))
    : await fetch(url, init);
  if (!response.ok) {
    throw new Error(`email worker rejected the send: HTTP ${response.status}`);
  }
}

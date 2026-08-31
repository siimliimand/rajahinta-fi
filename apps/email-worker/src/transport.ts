/**
 * Transport port — the only seam in front of the Cloudflare `send_email`
 * binding (migrate-to-cloudflare task 5.3).
 *
 * The route depends on the `EmailTransport` interface, never on the binding
 * directly, so unit tests stub dispatch without the Workers runtime. The
 * production adapter maps a built message onto the binding's structured
 * `send()` call.
 *
 * @module transport
 */

import type { BuiltEmailMessage } from './mime';
import type { SendEmailBinding } from './env';

/** Port: dispatch a fully-built outbound message. */
export interface EmailTransport {
  send(message: BuiltEmailMessage): Promise<void>;
}

/** Production adapter over the `send_email` binding. */
export class SendEmailBindingTransport implements EmailTransport {
  constructor(private readonly binding: SendEmailBinding) {}

  async send(message: BuiltEmailMessage): Promise<void> {
    await this.binding.send(message.bindingMessage);
  }
}

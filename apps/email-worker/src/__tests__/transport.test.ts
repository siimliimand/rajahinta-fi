/**
 * Transport port suite (task 5.3): the binding adapter maps a built message
 * onto the send_email binding's structured send() call and propagates
 * failures; a stub transport proves the route never touches the binding
 * directly.
 *
 * @module transport.test
 */

import { describe, expect, it, vi } from 'vitest';
import { SendEmailBindingTransport, type EmailTransport } from '../transport';
import { buildMimeMessage } from '../mime';
import type { SendEmailBinding, SendEmailBindingMessage } from '../env';

function recordingBinding(
  impl: (message: SendEmailBindingMessage) => Promise<unknown> = async () => undefined,
): { binding: SendEmailBinding; calls: SendEmailBindingMessage[] } {
  const calls: SendEmailBindingMessage[] = [];
  return {
    calls,
    binding: {
      send: vi.fn(async (message: SendEmailBindingMessage) => {
        calls.push(message);
        return impl(message);
      }),
    },
  };
}

const built = buildMimeMessage(
  {
    from: 'alerts@rajahinta.fi',
    to: 'ops@example.com',
    subject: 'Alert',
    text: 'body',
    html: '<p>body</p>',
    replyTo: 'replies@example.com',
  },
  new Date('2026-08-30T12:00:00Z'),
  'test-id',
);

describe('SendEmailBindingTransport', () => {
  it('forwards the structured binding message to binding.send', async () => {
    const { binding, calls } = recordingBinding();
    const transport = new SendEmailBindingTransport(binding);

    await transport.send(built);

    expect(calls).toEqual([built.bindingMessage]);
    expect(calls[0]).toEqual({
      from: 'alerts@rajahinta.fi',
      to: 'ops@example.com',
      subject: 'Alert',
      text: 'body',
      html: '<p>body</p>',
      reply_to: 'replies@example.com',
    });
  });

  it('propagates binding failures to the caller', async () => {
    const { binding } = recordingBinding(async () => {
      throw new Error('binding unavailable');
    });
    const transport = new SendEmailBindingTransport(binding);

    await expect(transport.send(built)).rejects.toThrow('binding unavailable');
  });
});

describe('EmailTransport port', () => {
  it('is stubbable without the Workers runtime', async () => {
    const sent: string[] = [];
    const stub: EmailTransport = {
      send: async (message) => {
        sent.push(message.messageId);
      },
    };

    await stub.send(built);

    expect(sent).toEqual([built.messageId]);
  });
});

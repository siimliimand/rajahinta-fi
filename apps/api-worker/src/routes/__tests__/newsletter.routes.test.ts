/**
 * Newsletter route tests (task 5.3, change trust-and-reach-roadmap) —
 * double opt-in subscribe/confirm/unsubscribe plus the ops
 * notify-subscribers action, over the full createApp() harness with a
 * STUBBED transport: the email worker send contract (global fetch to
 * EMAIL_WORKER_URL) is replaced with an in-memory recorder.
 *
 * Spec pins (content-publication):
 * - a PENDING subscriber is NEVER mailed newsletter content ("Unconfirmed
 *   never mailed") — the confirmation mail itself is the only mail a
 *   pending address can receive;
 * - unsubscribe is immediate and one-click, and no further newsletter
 *   is sent afterwards;
 * - a retried broadcast skips subscribers already marked delivered
 *   ("Crash-safe send") — the intent log's delivered rows are the skip
 *   set, so a crash mid-dispatch cannot double-send.
 *
 * @module NewsletterRoutesTest
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { D1NewsletterSubscriberRepository } from '../../../../../packages/data-platform/src/repositories/d1/newsletter-subscriber.repository';
import { WorkerAuditService } from '../../adapters/audit';

type TestEnv = ReturnType<typeof permissiveEnv>;

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` } as const;
const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Recorder for the stubbed email-worker transport. */
interface SentMail {
  readonly to: string;
  readonly subject: string;
  readonly body: Record<string, unknown>;
}

interface StubOptions {
  /** Return an HTTP error for this recipient (dispatch failure). */
  readonly failFor?: (mail: { to: string }) => boolean;
  readonly failStatus?: number;
}

function stubTransport(options: StubOptions = {}): SentMail[] {
  const sent: SentMail[] = [];
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push({
        to: body.to as string,
        subject: body.subject as string,
        body,
      });
      if (options.failFor !== undefined && options.failFor({ to: body.to as string })) {
        return new Response(
          JSON.stringify({ error: 'EmailDeliveryError', message: 'delivery failed' }),
          { status: options.failStatus ?? 500 },
        );
      }
      return new Response(JSON.stringify({ accepted: true, messageId: 'm-1' }), {
        status: 200,
      });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function mailEnv(d1: Parameters<typeof permissiveEnv>[0]): TestEnv {
  return permissiveEnv(d1, {
    EMAIL_WORKER_URL: 'http://email-worker.test',
    EMAIL_SEND_SECRET: 'newsletter-test-secret',
  });
}

/** Extract a link token from the stubbed confirmation mail for `to`. */
function extractToken(
  sent: SentMail[],
  to: string,
  kind: 'confirm' | 'unsubscribe',
): string {
  const mail = sent.find((m) => m.to === to);
  if (mail === undefined) throw new Error(`no mail recorded for ${to}`);
  const text = mail.body.text as string;
  const match = text.match(
    new RegExp(`https://rajahinta\\.fi/fi/newsletter/${kind}\\?token=([A-Za-z0-9_-]+)`),
  );
  if (match === null) throw new Error(`no ${kind} link in mail for ${to}`);
  return match[1]!;
}

async function subscribe(
  app: ReturnType<typeof buildApp>,
  env: TestEnv,
  email: string,
): Promise<Response> {
  return request(app, env, '/api/v1/newsletter/subscribe', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
}

/**
 * Subscribe + confirm through the stubbed confirmation link — the
 * shared setup for a broadcast-audience member (ACTIVE row).
 */
async function subscribeAndConfirm(
  app: ReturnType<typeof buildApp>,
  env: TestEnv,
  sent: SentMail[],
  email: string,
): Promise<void> {
  const res = await subscribe(app, env, email);
  expect(res.status).toBe(202);
  const token = extractToken(sent, email, 'confirm');
  const confirm = await request(
    app,
    env,
    `/api/v1/newsletter/confirm?token=${encodeURIComponent(token)}`,
  );
  expect(confirm.status).toBe(200);
  expect(await confirm.json()).toEqual({ status: 'ACTIVE' });
}

const NOTIFY_BODY = {
  subject: 'Rajahinta-uutiskirje / Newsletter',
  bodyFi: 'Tullimuutokset astuivat voimaan.',
  bodyEn: 'The tax changes took effect.',
};

function notify(app: ReturnType<typeof buildApp>, env: TestEnv): Promise<Response> {
  return request(app, env, '/ops/console/newsletter/notify', {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...OPS },
    body: JSON.stringify({ operator: 'ops-1', ...NOTIFY_BODY }),
  });
}

describe('POST /api/v1/newsletter/subscribe', () => {
  it('stores PENDING and mails the double opt-in confirmation (stubbed transport)', async () => {
    const { db, d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const sent = stubTransport();
    const app = buildApp();

    const res = await subscribe(app, env, 'Future.Subscriber@Example.invalid');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'PENDING' });

    // Row stored lowercased + PENDING.
    const rows = db
      .prepare('SELECT email, status FROM newsletter_subscribers')
      .all() as { email: string; status: string }[];
    expect(rows).toEqual([
      { email: 'future.subscriber@example.invalid', status: 'PENDING' },
    ]);

    // Exactly one mail — the confirmation, FI + EN, carrying the
    // confirm and one-click unsubscribe links (raw token in URL only).
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('future.subscriber@example.invalid');
    expect(sent[0]!.subject).toContain('Vahvista uutiskirje tilaus');
    const text = sent[0]!.body.text as string;
    expect(text).toContain('/fi/newsletter/confirm?token=');
    expect(text).toContain('/fi/newsletter/unsubscribe?token=');
  });

  it('rejects an invalid address with the InvalidEmail envelope', async () => {
    const { d1 } = openMigratedD1();
    const env = mailEnv(d1);
    stubTransport();
    const app = buildApp();

    const res = await subscribe(app, env, 'not-an-email');
    await expectEnvelope(res, 400, { error: 'InvalidEmail' });
  });

  it('answers a duplicate with the same 202 — no second mail, no overwrite', async () => {
    const { db, d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const sent = stubTransport();
    const app = buildApp();

    await subscribe(app, env, 'dupe@example.invalid');
    const second = await subscribe(app, env, 'DUPE@example.invalid');

    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ status: 'PENDING' });
    expect(sent).toHaveLength(1); // no confirmation re-send
    const rows = db.prepare('SELECT id FROM newsletter_subscribers').all() as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('a failing transport never fails the subscribe (best-effort mail, register parity)', async () => {
    const { db, d1 } = openMigratedD1();
    const env = mailEnv(d1);
    stubTransport({ failFor: () => true });
    const app = buildApp();

    const res = await subscribe(app, env, 'unlucky@example.invalid');
    expect(res.status).toBe(202);
    const rows = db
      .prepare('SELECT status FROM newsletter_subscribers')
      .all() as { status: string }[];
    expect(rows).toEqual([{ status: 'PENDING' }]);
  });
});

describe('GET /api/v1/newsletter/confirm + /unsubscribe', () => {
  it('activates on the emailed token; reuse is idempotent; unknown token is a uniform 400', async () => {
    const { d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const sent = stubTransport();
    const app = buildApp();
    const repo = new D1NewsletterSubscriberRepository(d1);

    await subscribeAndConfirm(app, env, sent, 'activator@example.invalid');
    expect((await repo.findByEmail('activator@example.invalid'))?.status).toBe('ACTIVE');

    const token = extractToken(sent, 'activator@example.invalid', 'confirm');

    // Reuse — still ACTIVE (idempotent), never an error.
    const again = await request(
      app,
      env,
      `/api/v1/newsletter/confirm?token=${encodeURIComponent(token)}`,
    );
    expect(await again.json()).toEqual({ status: 'ACTIVE' });

    const bad = await request(app, env, '/api/v1/newsletter/confirm?token=nope');
    await expectEnvelope(bad, 400, { error: 'InvalidToken' });
  });

  it('unsubscribes immediately via the one-click link and stays terminal', async () => {
    const { db, d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const sent = stubTransport();
    const app = buildApp();
    const repo = new D1NewsletterSubscriberRepository(d1);

    await subscribeAndConfirm(app, env, sent, 'leaver@example.invalid');
    expect((await repo.findByEmail('leaver@example.invalid'))?.status).toBe('ACTIVE');

    const link = extractToken(sent, 'leaver@example.invalid', 'unsubscribe');

    // One click — immediate effect.
    const unsubscribe = await request(
      app,
      env,
      `/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(link)}`,
    );
    expect(unsubscribe.status).toBe(200);
    expect(await unsubscribe.json()).toEqual({ status: 'UNSUBSCRIBED' });
    expect(
      db.prepare('SELECT unsubscribed_at FROM newsletter_subscribers').get() as {
        unsubscribed_at: string | null;
      },
    ).toMatchObject({ unsubscribed_at: expect.any(String) });

    // A second click converges on the same honest answer (terminal).
    const second = await request(
      app,
      env,
      `/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(link)}`,
    );
    expect(await second.json()).toEqual({ status: 'UNSUBSCRIBED' });
    const bad = await request(app, env, '/api/v1/newsletter/unsubscribe?token=nope');
    await expectEnvelope(bad, 400, { error: 'InvalidToken' });
  });

  it('the broadcast digest form also unsubscribes (the standing one-click capability)', async () => {
    const { db, d1 } = openMigratedD1();
    const env = mailEnv(d1);
    stubTransport();
    const app = buildApp();

    await subscribe(app, env, 'digest-leaver@example.invalid');
    const digest = (
      db
        .prepare('SELECT confirmation_token_hash FROM newsletter_subscribers')
        .get() as { confirmation_token_hash: string }
    ).confirmation_token_hash;

    const res = await request(app, env, `/api/v1/newsletter/unsubscribe?token=${digest}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'UNSUBSCRIBED' });
  });
});

describe('POST /ops/console/newsletter/notify (intent-log pipeline, stubbed transport)', () => {
  it('pending subscribers are never mailed; only ACTIVE receive the broadcast', async () => {
    const { d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const sent = stubTransport();
    const app = buildApp();

    // PENDING: subscribe only, never confirmed.
    const pending = await subscribe(app, env, 'pending@example.invalid');
    expect(pending.status).toBe(202);
    await subscribeAndConfirm(app, env, sent, 'active@example.invalid');

    const res = await notify(app, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 1, notified: 1, failed: 0, skipped: 0 });

    // Exactly one broadcast mail — to the ACTIVE address; the pending
    // address received ONLY its confirmation mail.
    const broadcast = sent.filter((m) => m.subject === NOTIFY_BODY.subject);
    expect(broadcast).toHaveLength(1);
    expect(broadcast[0]!.to).toBe('active@example.invalid');
    // Every newsletter email carries the one-click unsubscribe link.
    expect(broadcast[0]!.body.html as string).toContain('/newsletter/unsubscribe?token=');
  });

  it('a failed dispatch marks the intent failed and the retry reaches only that subscriber', async () => {
    const { d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const app = buildApp();

    const setup = stubTransport();
    await subscribeAndConfirm(app, env, setup, 'a@example.invalid');
    await subscribeAndConfirm(app, env, setup, 'b@example.invalid');

    // Run 1: B's dispatch fails mid-batch (the crash face) — A is
    // delivered, B's intent is marked failed.
    stubTransport({ failFor: (mail) => mail.to === 'b@example.invalid' });
    const first = await notify(app, env);
    expect(await first.json()).toMatchObject({ total: 2, notified: 1, failed: 1 });

    // Run 2 (retry): A is inside the delivered-row cooldown → skipped;
    // only B is re-attempted — no duplicate for A.
    const sent2 = stubTransport();
    const second = await notify(app, env);
    expect(await second.json()).toMatchObject({ notified: 1, skipped: 1, failed: 0 });
    expect(sent2.map((m) => m.to)).toEqual(['b@example.invalid']);
  });

  it('an immediate rerun skips every cooldown subscriber — zero dispatches', async () => {
    const { d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const app = buildApp();

    const setup = stubTransport();
    await subscribeAndConfirm(app, env, setup, 'cooldown@example.invalid');

    stubTransport();
    const first = await notify(app, env);
    expect(await first.json()).toMatchObject({ notified: 1 });

    const sent = stubTransport();
    const second = await notify(app, env);
    expect(await second.json()).toMatchObject({ total: 1, notified: 0, skipped: 1 });
    expect(sent).toEqual([]);
  });

  it('fails closed with 503 when the email worker is not configured', async () => {
    const { d1 } = openMigratedD1();
    stubTransport();
    const app = buildApp();
    const env = permissiveEnv(d1); // no EMAIL_* config

    const res = await notify(app, env);
    await expectEnvelope(res, 503, { error: 'StoreUnavailable' });
  });

  it('validates the broadcast content and appends the audit event', async () => {
    const { d1 } = openMigratedD1();
    const env = mailEnv(d1);
    const sent = stubTransport();
    const app = buildApp();

    const missing = await request(app, env, '/ops/console/newsletter/notify', {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...OPS },
      body: JSON.stringify({ operator: 'ops-1', subject: 's', bodyFi: 'x' }),
    });
    await expectEnvelope(missing, 400, {
      message: expect.stringContaining('bodyEn is required'),
    });

    await subscribeAndConfirm(app, env, sent, 'audited@example.invalid');
    const res = await notify(app, env);
    expect(res.status).toBe(200);

    const trail = await new WorkerAuditService(d1).queryChanges({ limit: 10 });
    const broadcast = trail.find((entry) => entry.entityType === 'newsletter_broadcast');
    expect(broadcast).toBeDefined();
    expect(broadcast!.action).toBe('created');
    expect(broadcast!.author).toBe('ops-1');
    expect(broadcast!.newValue).toMatchObject({ notified: 1, total: 1 });
  });
});

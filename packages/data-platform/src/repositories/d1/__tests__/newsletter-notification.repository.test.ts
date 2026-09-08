/**
 * D1 NewsletterNotificationRepository — real-SQLite tests (task 5.3,
 * change trust-and-reach-roadmap) on the node:sqlite harness with the
 * committed migrations applied. Pins the intent-log contract the
 * crash-safe send depends on: pending-at-birth intents, ONE-SHOT
 * outcome marking (a delivered row never flips), and the
 * latest-DELIVERED cooldown read.
 *
 * @module D1NewsletterNotificationRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1NewsletterSubscriberRepository } from '../newsletter-subscriber.repository';
import { D1NewsletterNotificationRepository } from '../newsletter-notification.repository';

const { db, d1 } = openMigratedD1();
const subscribers = new D1NewsletterSubscriberRepository(d1);
const notifications = new D1NewsletterNotificationRepository(d1);

async function seedSubscriber(email: string): Promise<{ id: number }> {
  const row = await subscribers.subscribe({
    email,
    confirmationTokenHash: `hash-${email}`,
  });
  return { id: row.id };
}

describe('D1NewsletterNotificationRepository', () => {
  it('creates the intent PENDING at the instant of intent', async () => {
    const sub = await seedSubscriber('intent@example.invalid');
    const intent = await notifications.createIntent({
      subscriberId: sub.id,
      channel: 'email',
    });

    expect(intent.id).toBeGreaterThan(0);
    expect(intent.subscriberId).toBe(sub.id);
    expect(intent.channel).toBe('email');
    expect(intent.deliveryStatus).toBe('pending');
    expect(intent.markedAt).toBeNull();
    expect(intent.createdAt).toBeInstanceOf(Date);
  });

  it('marks delivered exactly once — a second marking matches no row', async () => {
    const sub = await seedSubscriber('once@example.invalid');
    const intent = await notifications.createIntent({
      subscriberId: sub.id,
      channel: 'email',
    });

    const delivered = await notifications.markDelivered(intent.id);
    expect(delivered?.deliveryStatus).toBe('delivered');
    expect(delivered?.markedAt).toBeInstanceOf(Date);

    // One-shot: a delivered row cannot be rewritten (append-only
    // delivery-attempt records).
    expect(await notifications.markDelivered(intent.id)).toBeNull();
    expect(await notifications.markFailed(intent.id)).toBeNull();
  });

  it('marks failed exactly once and never resurrects a failed row', async () => {
    const sub = await seedSubscriber('failed@example.invalid');
    const intent = await notifications.createIntent({
      subscriberId: sub.id,
      channel: 'email',
    });

    expect((await notifications.markFailed(intent.id))?.deliveryStatus).toBe(
      'failed',
    );
    expect(await notifications.markFailed(intent.id)).toBeNull();
    expect(await notifications.markDelivered(intent.id)).toBeNull();
  });

  it('finds the latest DELIVERED intent per subscriber (cooldown read)', async () => {
    const sub = await seedSubscriber('cooldown@example.invalid');

    // Nothing delivered yet → null (never-cooled subscriber).
    expect(await notifications.findLatestDeliveredBySubscriberId(sub.id)).toBeNull();

    const failed = await notifications.createIntent({
      subscriberId: sub.id,
      channel: 'email',
    });
    await notifications.markFailed(failed.id);
    // A failed attempt is not a delivery — the cooldown stays open.
    expect(await notifications.findLatestDeliveredBySubscriberId(sub.id)).toBeNull();

    const first = await notifications.createIntent({
      subscriberId: sub.id,
      channel: 'email',
    });
    await notifications.markDelivered(first.id);
    const latest = await notifications.findLatestDeliveredBySubscriberId(sub.id);
    expect(latest?.id).toBe(first.id);

    // A later intent (still pending) does not become the cooldown read.
    await notifications.createIntent({ subscriberId: sub.id, channel: 'email' });
    expect(
      (await notifications.findLatestDeliveredBySubscriberId(sub.id))?.id,
    ).toBe(first.id);
  });

  it('cascades with the subscriber row', async () => {
    const sub = await seedSubscriber('cascade@example.invalid');
    const intent = await notifications.createIntent({
      subscriberId: sub.id,
      channel: 'email',
    });

    db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(sub.id);
    const remaining = db
      .prepare(
        'SELECT id FROM newsletter_notifications WHERE id = ?',
      )
      .all(intent.id);
    expect(remaining).toEqual([]);
  });
});

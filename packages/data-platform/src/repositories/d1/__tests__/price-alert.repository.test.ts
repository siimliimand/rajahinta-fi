/**
 * D1 price-alert repositories — real-SQLite tests (task 2.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers the alert CRUD lifecycle, the
 * notification intent-log transitions (write-before-dispatch, one-shot
 * outcome marking), the latest-delivered finder the 24-hour cooldown
 * (task 2.2) enforces from, and the FK cascades that make account/alert
 * deletion carry their dependent rows away.
 *
 * @module D1PriceAlertRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1PriceAlertRepository } from '../price-alert.repository';
import { D1AlertNotificationRepository } from '../alert-notification.repository';

const { db, d1 } = openMigratedD1();
const alerts = new D1PriceAlertRepository(d1);
const notifications = new D1AlertNotificationRepository(d1);

/** Fresh DB per test would be cleaner; ids stay unique per test instead. */
let accountIdSeq = 300;
async function seedAccount(): Promise<number> {
  const id = ++accountIdSeq;
  db.prepare(
    `INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`,
  ).run(id, `user-${id}@test.invalid`, `user-${id}@test.invalid`);
  return id;
}

let productIdSeq = 900;
async function seedProduct(): Promise<number> {
  const id = ++productIdSeq;
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'm', 'b', 'beer', 0.5, 'can', 'beer')`,
  ).run(id, `product-${id}`);
  return id;
}

async function seedAlert(accountId?: number, productId?: number) {
  return alerts.create({
    accountId: accountId ?? (await seedAccount()),
    productId: productId ?? (await seedProduct()),
    thresholdCents: 1500,
  });
}

describe('D1PriceAlertRepository', () => {
  it('creates an active alert with defaulted status and timestamps', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();

    const row = await alerts.create({ accountId, productId, thresholdCents: 2499 });

    expect(row.id).toBeGreaterThan(0);
    expect(row.accountId).toBe(accountId);
    expect(row.productId).toBe(productId);
    expect(row.thresholdCents).toBe(2499);
    expect(row.status).toBe('active');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    // A fresh row's stamps are effectively the same instant.
    expect(Math.abs(row.updatedAt.getTime() - row.createdAt.getTime())).toBeLessThan(5_000);
  });

  it('enforces one alert per (account, product) — duplicates reject on the unique constraint', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    await alerts.create({ accountId, productId, thresholdCents: 1000 });

    // The cooldown scope is per-product-per-account (design R2); a second
    // alert on the same pair could only produce duplicate emails.
    await expect(
      alerts.create({ accountId, productId, thresholdCents: 2000 }),
    ).rejects.toThrow();
  });

  it('rejects non-positive thresholds at the schema level', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();

    for (const thresholdCents of [0, -1]) {
      await expect(
        alerts.create({ accountId, productId, thresholdCents }),
      ).rejects.toThrow();
    }
  });

  it('rejects an unknown status value at the schema level', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    expect(() =>
      db
        .prepare(
          `INSERT INTO price_alerts (account_id, product_id, threshold_cents, status)
           VALUES (?, ?, 100, 'retired')`,
        )
        .run(accountId, productId),
    ).toThrow();
  });

  it('lists only the account’s own alerts, in deterministic order', async () => {
    const accountId = await seedAccount();
    const otherAccountId = await seedAccount();
    const productId = await seedProduct();
    const otherProductId = await seedProduct();

    const first = await alerts.create({ accountId, productId, thresholdCents: 1000 });
    const second = await alerts.create({
      accountId,
      productId: otherProductId,
      thresholdCents: 2000,
    });
    await alerts.create({ accountId: otherAccountId, productId, thresholdCents: 3000 });

    const rows = await alerts.findByAccountId(accountId);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows.every((r) => r.accountId === accountId)).toBe(true);
  });

  it('updates threshold and status account-scoped, stamping updatedAt', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    const alert = await alerts.create({ accountId, productId, thresholdCents: 1000 });

    const updated = await alerts.update(accountId, alert.id, {
      thresholdCents: 1234,
      status: 'paused',
    });

    expect(updated).not.toBeNull();
    expect(updated!.thresholdCents).toBe(1234);
    expect(updated!.status).toBe('paused');
    expect(updated!.createdAt).toEqual(alert.createdAt);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(alert.updatedAt.getTime());
  });

  it('partial update keeps untouched columns (COALESCE patch)', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    const alert = await alerts.create({ accountId, productId, thresholdCents: 1000 });

    const updated = await alerts.update(accountId, alert.id, { status: 'paused' });

    expect(updated!.thresholdCents).toBe(1000);
    expect(updated!.status).toBe('paused');
  });

  it('update of a foreign or absent alert id matches no row', async () => {
    const accountId = await seedAccount();
    const alert = await seedAlert();

    await expect(alerts.update(accountId, alert.id, { thresholdCents: 1 })).resolves.toBeNull();
    await expect(
      alerts.update(accountId, 999_999, { thresholdCents: 1 }),
    ).resolves.toBeNull();
  });

  it('pause flips only the status and removes the alert from the active scan set', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    const paused = await alerts.create({ accountId, productId, thresholdCents: 1000 });
    const stillActive = await alerts.create({
      accountId,
      productId: await seedProduct(),
      thresholdCents: 1000,
    });

    const result = await alerts.pause(accountId, paused.id);
    expect(result!.status).toBe('paused');
    // Account-scoped: pausing via a foreign account id does nothing.
    const foreign = await seedAccount();
    await expect(alerts.pause(foreign, paused.id)).resolves.toBeNull();

    const activeIds = (await alerts.findActive()).map((r) => r.id);
    expect(activeIds).toContain(stillActive.id);
    expect(activeIds).not.toContain(paused.id);
  });

  it('deletes account-scoped and reports what happened', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    const alert = await alerts.create({ accountId, productId, thresholdCents: 1000 });
    const foreign = await seedAccount();

    // A foreign account must not be able to delete someone else's alert…
    await expect(alerts.delete(foreign, alert.id)).resolves.toBe(false);
    const stillThere = db
      .prepare('SELECT count(*) n FROM price_alerts WHERE id = ?')
      .get(alert.id) as { n: number };
    expect(stillThere.n).toBe(1);

    // …the owner can, and a second attempt reports false.
    await expect(alerts.delete(accountId, alert.id)).resolves.toBe(true);
    await expect(alerts.delete(accountId, alert.id)).resolves.toBe(false);
  });

  describe('account-deletion cascade (retention path)', () => {
    it('deleting the account row takes its alerts and their notifications with it', async () => {
      const accountId = await seedAccount();
      const productId = await seedProduct();
      const alert = await alerts.create({ accountId, productId, thresholdCents: 1000 });
      await notifications.createIntent({
        alertId: alert.id,
        observedPriceCents: 999,
        channel: 'email',
      });
      const survivorAlert = await seedAlert(); // belongs to another account

      // The retention path's account-row deletion — alerts cascade at the
      // database level (same guarantee saved_scenarios carries), so the
      // erasure cannot leave orphaned alerts behind even if the
      // repository layer is bypassed.
      db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);

      const remainingAlerts = db
        .prepare('SELECT count(*) n FROM price_alerts WHERE account_id = ?')
        .get(accountId) as { n: number };
      expect(remainingAlerts.n).toBe(0);
      const orphans = db
        .prepare('SELECT count(*) n FROM price_alerts WHERE id = ?')
        .get(alert.id) as { n: number };
      expect(orphans.n).toBe(0);
      // The unrelated account's alert survives untouched.
      const activeIds = (await alerts.findActive()).map((r) => r.id);
      expect(activeIds).not.toContain(alert.id);
      expect(activeIds).toContain(survivorAlert.id);
    });

    it('deleting an alert cascades to its notification rows only', async () => {
      const accountId = await seedAccount();
      const doomed = await alerts.create({
        accountId,
        productId: await seedProduct(),
        thresholdCents: 1000,
      });
      const kept = await alerts.create({
        accountId,
        productId: await seedProduct(),
        thresholdCents: 1000,
      });
      await notifications.createIntent({ alertId: doomed.id, observedPriceCents: 900, channel: 'email' });
      await notifications.createIntent({ alertId: kept.id, observedPriceCents: 800, channel: 'email' });

      await alerts.delete(accountId, doomed.id);

      // The doomed alert's intent row cascaded away…
      const doomedRows = db
        .prepare('SELECT count(*) n FROM alert_notifications WHERE alert_id = ?')
        .get(doomed.id) as { n: number };
      expect(doomedRows.n).toBe(0);
      // …and the kept alert still owns exactly its one intent row.
      const keptRows = db
        .prepare('SELECT count(*) n FROM alert_notifications WHERE alert_id = ?')
        .get(kept.id) as { n: number };
      expect(keptRows.n).toBe(1);
    });
  });
});

describe('D1AlertNotificationRepository', () => {
  it('writes the intent row pending with a null marked_at, freezing the observed price', async () => {
    const alert = await seedAlert();

    const intent = await notifications.createIntent({
      alertId: alert.id,
      observedPriceCents: 1234,
      channel: 'email',
    });

    expect(intent.id).toBeGreaterThan(0);
    expect(intent.alertId).toBe(alert.id);
    expect(intent.observedPriceCents).toBe(1234);
    expect(intent.channel).toBe('email');
    expect(intent.deliveryStatus).toBe('pending');
    expect(intent.markedAt).toBeNull();
    expect(intent.createdAt).toBeInstanceOf(Date);
  });

  it('rejects channels outside the closed value set at the schema level', async () => {
    const alert = await seedAlert();
    expect(() =>
      db
        .prepare(
          `INSERT INTO alert_notifications (alert_id, observed_price_cents, channel)
           VALUES (?, 100, 'push')`,
        )
        .run(alert.id),
    ).toThrow();
  });

  it('marks the outcome once: delivered sets marked_at and cannot be rewritten', async () => {
    const alert = await seedAlert();
    const intent = await notifications.createIntent({
      alertId: alert.id,
      observedPriceCents: 1000,
      channel: 'email',
    });

    const delivered = await notifications.markDelivered(intent.id);
    expect(delivered!.deliveryStatus).toBe('delivered');
    expect(delivered!.markedAt).toBeInstanceOf(Date);
    expect(delivered!.markedAt!.getTime()).toBeGreaterThanOrEqual(delivered!.createdAt.getTime());

    // One-shot: a retried marking matches no pending row and the stored
    // outcome never moves (spec: rows never rewritten).
    await expect(notifications.markDelivered(intent.id)).resolves.toBeNull();
    await expect(notifications.markFailed(intent.id)).resolves.toBeNull();
    const stored = db
      .prepare('SELECT delivery_status, marked_at FROM alert_notifications WHERE id = ?')
      .get(intent.id) as { delivery_status: string; marked_at: string };
    expect(stored.delivery_status).toBe('delivered');
    expect(stored.marked_at).toBe(delivered!.markedAt!.toISOString());
  });

  it('marks failed, and a failed intent can never resurrect as delivered', async () => {
    const alert = await seedAlert();
    const intent = await notifications.createIntent({
      alertId: alert.id,
      observedPriceCents: 1000,
      channel: 'email',
    });

    const failed = await notifications.markFailed(intent.id);
    expect(failed!.deliveryStatus).toBe('failed');
    expect(failed!.markedAt).toBeInstanceOf(Date);

    await expect(notifications.markDelivered(intent.id)).resolves.toBeNull();
    await expect(notifications.findLatestDeliveredByAlertId(alert.id)).resolves.toBeNull();
  });

  it('marking an absent notification id reports null', async () => {
    await expect(notifications.markDelivered(999_999)).resolves.toBeNull();
    await expect(notifications.markFailed(999_999)).resolves.toBeNull();
  });

  it('the cooldown finder returns only delivered rows, latest first', async () => {
    const accountId = await seedAccount();
    const productId = await seedProduct();
    const alert = await alerts.create({ accountId, productId, thresholdCents: 1000 });

    // No delivered row yet — pending and failed never satisfy the cooldown.
    await expect(notifications.findLatestDeliveredByAlertId(alert.id)).resolves.toBeNull();
    const pending = await notifications.createIntent({
      alertId: alert.id,
      observedPriceCents: 900,
      channel: 'email',
    });
    const failedIntent = await notifications.createIntent({
      alertId: alert.id,
      observedPriceCents: 890,
      channel: 'email',
    });
    await notifications.markFailed(failedIntent.id);
    await expect(notifications.findLatestDeliveredByAlertId(alert.id)).resolves.toBeNull();

    const deliveredAt = (iso: string, id: number) =>
      db
        .prepare('UPDATE alert_notifications SET created_at = ? WHERE id = ?')
        .run(iso, id);
    // Backdate fixtures so "latest delivered" is decided by data, not insert speed.
    deliveredAt('2026-09-01T00:00:00.000Z', pending.id);
    const first = await notifications.markDelivered(pending.id);

    await expect(notifications.findLatestDeliveredByAlertId(alert.id)).resolves.toMatchObject({
      id: first!.id,
      deliveryStatus: 'delivered',
    });

    const newer = await notifications.createIntent({
      alertId: alert.id,
      observedPriceCents: 880,
      channel: 'email',
    });
    deliveredAt('2026-09-02T00:00:00.000Z', newer.id);
    const second = await notifications.markDelivered(newer.id);

    // Cooldown measured from the most recent delivered instant.
    await expect(notifications.findLatestDeliveredByAlertId(alert.id)).resolves.toMatchObject({
      id: second!.id,
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
    });
  });

  it('the finder never leaks another alert’s delivered rows', async () => {
    const alertA = await seedAlert();
    const alertB = await seedAlert();
    const intent = await notifications.createIntent({
      alertId: alertA.id,
      observedPriceCents: 900,
      channel: 'email',
    });
    await notifications.markDelivered(intent.id);

    await expect(notifications.findLatestDeliveredByAlertId(alertA.id)).resolves.not.toBeNull();
    await expect(notifications.findLatestDeliveredByAlertId(alertB.id)).resolves.toBeNull();
  });
});

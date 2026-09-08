/**
 * D1 content / share / newsletter repositories — real-SQLite tests
 * (task 1.4, change trust-and-reach-roadmap) on the node:sqlite harness
 * with the committed migrations applied. Covers the blog-post draft →
 * publish gate (public reads PUBLISHED only; published posts immutable),
 * the newsletter double opt-in (token-hash round-trip, case-insensitive
 * address uniqueness, terminal unsubscribe), and the share snapshots
 * (22-character public id, frozen-result round-trip, hygiene sweep).
 *
 * @module D1ContentShareRepositoriesTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1BlogPostRepository } from '../blog-post.repository';
import {
  D1NewsletterSubscriberRepository,
} from '../newsletter-subscriber.repository';
import { D1ShareSnapshotRepository } from '../share-snapshot.repository';
import {
  DuplicateNewsletterSubscriptionError,
} from '../../../abstracts';

const { db, d1 } = openMigratedD1();
const posts = new D1BlogPostRepository(d1);
const subscribers = new D1NewsletterSubscriberRepository(d1);
const snapshots = new D1ShareSnapshotRepository(d1);

describe('D1BlogPostRepository', () => {
  let slugSeq = 0;
  const nextSlug = () => `rate-change-${++slugSeq}`;

  it('creates a post as DRAFT with no publication stamps', async () => {
    const slug = nextSlug();
    const row = await posts.create({
      slug,
      locale: 'fi',
      title: 'Tullimuutokset 3/2026',
      bodyMarkdown: '# Muutos\n\nSisältöä.',
      rateDatasetVersion: '2026-03-01',
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.slug).toBe(slug);
    expect(row.locale).toBe('fi');
    expect(row.status).toBe('DRAFT');
    expect(row.rateDatasetVersion).toBe('2026-03-01');
    expect(row.publishedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);

    expect(await posts.findById(row.id)).toEqual(row);
    expect(await posts.findBySlugAndLocale(slug, 'fi')).toEqual(row);
    expect(await posts.findBySlugAndLocale(slug, 'en')).toBeNull();
  });

  it('one row per (slug, locale): another locale is a distinct post', async () => {
    const slug = nextSlug();
    const fi = await posts.create({
      slug,
      locale: 'fi',
      title: 'fi',
      bodyMarkdown: 'fi body',
    });
    const en = await posts.create({
      slug,
      locale: 'en',
      title: 'en',
      bodyMarkdown: 'en body',
    });
    expect(fi.id).not.toBe(en.id);

    // …but the exact same pair is a unique violation.
    await expect(
      posts.create({ slug, locale: 'fi', title: 'x', bodyMarkdown: 'y' }),
    ).rejects.toThrow();
  });

  it('refuses a blank slug at the schema level', async () => {
    await expect(
      posts.create({ slug: '', locale: 'fi', title: 't', bodyMarkdown: 'b' }),
    ).rejects.toThrow();
  });

  it('listByLocale serves both the public view (PUBLISHED) and the console view', async () => {
    const draft = await posts.create({
      slug: nextSlug(),
      locale: 'sv',
      title: 'draft',
      bodyMarkdown: 'b',
    });
    const published = await posts.create({
      slug: nextSlug(),
      locale: 'sv',
      title: 'published',
      bodyMarkdown: 'b',
    });
    await posts.publish(published.id);

    const publicView = await posts.listByLocale('sv', 'PUBLISHED');
    expect(publicView.map((p) => p.id)).toEqual([published.id]);

    const consoleView = await posts.listByLocale('sv');
    expect(consoleView.map((p) => p.id)).toEqual([draft.id, published.id]);
  });

  it('drafts are editable; publication is the one-way gate', async () => {
    const row = await posts.create({
      slug: nextSlug(),
      locale: 'fi',
      title: 'original',
      bodyMarkdown: 'original body',
    });

    const patched = await posts.updateDraft(row.id, {
      title: 'edited',
      rateDatasetVersion: '2026-04-01',
    });
    expect(patched!.title).toBe('edited');
    expect(patched!.rateDatasetVersion).toBe('2026-04-01');
    // COALESCE patch: untouched body keeps its value.
    expect(patched!.bodyMarkdown).toBe('original body');

    const published = await posts.publish(row.id, new Date('2026-04-02T00:00:00.000Z'));
    expect(published!.status).toBe('PUBLISHED');
    expect(published!.publishedAt!.toISOString()).toBe('2026-04-02T00:00:00.000Z');

    // PUBLISHED is immutable — draft edits match no row.
    await expect(posts.updateDraft(row.id, { title: 'sneaky' })).resolves.toBeNull();
    // …and republish is a no-op.
    await expect(posts.publish(row.id)).resolves.toBeNull();
  });

  it('deletes a post once', async () => {
    const row = await posts.create({
      slug: nextSlug(),
      locale: 'fi',
      title: 'doomed',
      bodyMarkdown: 'b',
    });
    await expect(posts.delete(row.id)).resolves.toBe(true);
    await expect(posts.delete(row.id)).resolves.toBe(false);
    await expect(posts.findById(row.id)).resolves.toBeNull();
  });
});

describe('D1NewsletterSubscriberRepository', () => {
  let subscriberSeq = 0;
  /** sha256-hex-shaped fixture: 64 characters. */
  const tokenHash = (n: number) => `hash-${String(n).padStart(60, '0')}`;
  const nextSubscriber = (prefix: string) => {
    const n = ++subscriberSeq;
    return { email: `${prefix}-${n}@example.com`, tokenHash: tokenHash(n) };
  };

  it('subscribes PENDING with the address lowercased, and the token hash round-trips', async () => {
    const sub = nextSubscriber('roundtrip');
    const row = await subscribers.subscribe({
      // Deliberately mixed case — the stored address must be lowercase.
      email: sub.email.replace('roundtrip', 'RoundTrip').toUpperCase(),
      confirmationTokenHash: sub.tokenHash,
    });

    expect(row.email).toBe(`ROUNDTRIP-${subscriberSeq}@EXAMPLE.COM`.toLowerCase());
    expect(row.status).toBe('PENDING');
    expect(row.confirmationTokenHash).toBe(sub.tokenHash);
    expect(row.confirmedAt).toBeNull();
    expect(row.unsubscribedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);

    // Lookup by hash — the emailed link's only stored trace.
    const byHash = await subscribers.findByConfirmationTokenHash(sub.tokenHash);
    expect(byHash!.id).toBe(row.id);
    expect(byHash!.confirmationTokenHash).toBe(row.confirmationTokenHash);
    await expect(
      subscribers.findByConfirmationTokenHash(tokenHash(999_999)),
    ).resolves.toBeNull();
  });

  it('uniqueness is case-insensitive — a case variant rejects with the typed error', async () => {
    const sub = nextSubscriber('casefold');
    await subscribers.subscribe({
      email: sub.email,
      confirmationTokenHash: sub.tokenHash,
    });

    await expect(
      subscribers.subscribe({
        email: sub.email.toUpperCase(),
        confirmationTokenHash: sub.tokenHash,
      }),
    ).rejects.toThrow(DuplicateNewsletterSubscriptionError);

    // The lookup is case-insensitive too.
    const found = await subscribers.findByEmail(sub.email.toUpperCase());
    expect(found).not.toBeNull();
    expect(found!.email).toBe(sub.email);
  });

  it('confirms exactly once: PENDING → ACTIVE, then the token is spent', async () => {
    const sub = nextSubscriber('confirm');
    const row = await subscribers.subscribe({
      email: sub.email,
      confirmationTokenHash: sub.tokenHash,
    });
    const confirmedAt = new Date('2026-05-01T00:00:00.000Z');

    const confirmed = await subscribers.confirm(row.id, confirmedAt);
    expect(confirmed!.status).toBe('ACTIVE');
    expect(confirmed!.confirmedAt!.toISOString()).toBe('2026-05-01T00:00:00.000Z');

    // The active set is who the notify-subscribers action mails.
    const activeIds = (await subscribers.findActive()).map((s) => s.id);
    expect(activeIds).toContain(row.id);

    // A replayed confirmation matches no PENDING row.
    await expect(subscribers.confirm(row.id, new Date())).resolves.toBeNull();
  });

  it('unsubscribe is terminal, from any live state', async () => {
    const sub = nextSubscriber('bye');
    const pending = await subscribers.subscribe({
      email: sub.email,
      confirmationTokenHash: sub.tokenHash,
    });
    const unsubscribedAt = new Date('2026-05-02T00:00:00.000Z');

    const gone = await subscribers.unsubscribe(pending.id, unsubscribedAt);
    expect(gone!.status).toBe('UNSUBSCRIBED');
    expect(gone!.unsubscribedAt!.toISOString()).toBe('2026-05-02T00:00:00.000Z');
    expect(gone!.confirmedAt).toBeNull();

    // Terminal: no resurrection, no second stamp.
    await expect(subscribers.unsubscribe(pending.id, new Date())).resolves.toBeNull();
    await expect(subscribers.confirm(pending.id, new Date())).resolves.toBeNull();
    const activeIds = (await subscribers.findActive()).map((s) => s.id);
    expect(activeIds).not.toContain(pending.id);
  });

  it('refuses a blank token hash at the schema level', async () => {
    await expect(
      subscribers.subscribe({
        email: nextSubscriber('nohash').email,
        confirmationTokenHash: '',
      }),
    ).rejects.toThrow();
  });
});

describe('D1ShareSnapshotRepository', () => {
  /** The documented generator shape: exactly 22 URL-safe characters. */
  const publicId = (n: number) => `snap${String(n).padStart(18, '0')}`;
  let snapshotSeq = 0;

  it('freezes a result behind a 22-character public id and reads it back', async () => {
    const id = publicId(++snapshotSeq);
    const frozen = {
      totalCents: 4210,
      lines: [{ label: 'alko', cents: 3200 }],
      disclaimer: 'estimate',
    };

    const row = await snapshots.create({ publicId: id, frozenResult: frozen });
    expect(row.id).toBeGreaterThan(0);
    expect(row.publicId).toBe(id);
    expect(row.publicId.length).toBe(22);
    expect(row.frozenResult).toEqual(frozen);
    expect(row.createdAt).toBeInstanceOf(Date);

    expect(await snapshots.findByPublicId(id)).toEqual(row);
    await expect(snapshots.findByPublicId(publicId(999_999))).resolves.toBeNull();
  });

  it('refuses public ids that are not exactly 22 characters before touching SQL', async () => {
    for (const bad of [publicId(++snapshotSeq) + 'x', publicId(++snapshotSeq).slice(1)]) {
      await expect(
        snapshots.create({ publicId: bad, frozenResult: {} }),
      ).rejects.toThrow(/22 characters/);
    }
    // The CHECK is the backstop if the guard were bypassed.
    await expect(() =>
      db
        .prepare(
          `INSERT INTO share_snapshots (public_id, frozen_result) VALUES (?, '{}')`,
        )
        .run('short'),
    ).toThrow();
  });

  it('a public-id collision propagates as a constraint error (the generator retries)', async () => {
    const id = publicId(++snapshotSeq);
    await snapshots.create({ publicId: id, frozenResult: { first: true } });
    await expect(
      snapshots.create({ publicId: id, frozenResult: { second: true } }),
    ).rejects.toThrow();
  });

  it('the hygiene sweep deletes only snapshots created before the cutoff', async () => {
    const old = await snapshots.create({
      publicId: publicId(++snapshotSeq),
      frozenResult: { old: true },
    });
    const fresh = await snapshots.create({
      publicId: publicId(++snapshotSeq),
      frozenResult: { fresh: true },
    });
    db.prepare('UPDATE share_snapshots SET created_at = ? WHERE id = ?').run(
      '2025-01-01T00:00:00.000Z',
      old.id,
    );

    await expect(
      snapshots.deleteOlderThan(new Date('2026-01-01T00:00:00.000Z')),
    ).resolves.toBe(1);

    await expect(snapshots.findByPublicId(old.publicId)).resolves.toBeNull();
    expect(await snapshots.findByPublicId(fresh.publicId)).not.toBeNull();
  });
});

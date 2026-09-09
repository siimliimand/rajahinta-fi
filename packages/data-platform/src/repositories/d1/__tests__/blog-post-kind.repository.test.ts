/**
 * D1BlogPostRepository content-kind support — real-SQLite tests
 * (task 1.2, change insight-surfaces) on the node:sqlite harness with
 * the committed migrations applied.
 *
 * Load-bearing cases: the kind-filtered list queries (blog index =
 * RATE_CHANGE only, guides = GUIDE only), the D3 default (pre-kind rows
 * and kind-less creates read RATE_CHANGE), the SQL CHECK on the value
 * set, and that slug uniqueness per (slug, locale) is untouched by kind.
 *
 * @module D1BlogPostKindRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1BlogPostRepository } from '../blog-post.repository';

const { d1 } = openMigratedD1();
const posts = new D1BlogPostRepository(d1);

let slugSeq = 0;
const nextSlug = (prefix: string) => `${prefix}-${++slugSeq}`;

describe('D1BlogPostRepository.create kind', () => {
  it('persists an explicit GUIDE kind', async () => {
    const row = await posts.create({
      slug: nextSlug('guide'),
      locale: 'fi',
      title: 'Tulliopas',
      bodyMarkdown: '# Opas',
      kind: 'GUIDE',
    });
    expect(row.kind).toBe('GUIDE');
    expect(await posts.findById(row.id)).toEqual(row);
  });

  it('defaults an omitted kind to RATE_CHANGE — pre-existing call sites unchanged', async () => {
    const row = await posts.create({
      slug: nextSlug('rate'),
      locale: 'fi',
      title: 'Tullimuutos',
      bodyMarkdown: '# Muutos',
    });
    expect(row.kind).toBe('RATE_CHANGE');
  });

  it('keeps the pre-kind row interpretation: a raw INSERT without kind reads RATE_CHANGE', async () => {
    // Simulates a row written by pre-kind code (no kind column bound) —
    // the column default is what D3 preserves it with, no backfill.
    const slug = nextSlug('legacy');
    d1
      .prepare(
        `INSERT INTO blog_posts (slug, locale, title, body_markdown, rate_dataset_version)
         VALUES (?, 'fi', 'Vanha muutos', '# Muutos', '2026-01-01')`,
      )
      .bind(slug)
      .run();

    const row = await posts.findBySlugAndLocale(slug, 'fi');
    expect(row).not.toBeNull();
    expect(row?.kind).toBe('RATE_CHANGE');
  });

  it('still rejects a duplicate (slug, locale) — kind is part of no key', async () => {
    const slug = nextSlug('dup');
    await posts.create({ slug, locale: 'en', title: 'a', bodyMarkdown: 'a', kind: 'GUIDE' });
    await expect(
      posts.create({ slug, locale: 'en', title: 'b', bodyMarkdown: 'b', kind: 'RATE_CHANGE' }),
    ).rejects.toThrow(/UNIQUE/i);

    // The same slug in another locale remains a distinct post.
    const en = await posts.create({ slug, locale: 'fi', title: 'c', bodyMarkdown: 'c', kind: 'GUIDE' });
    expect(en.kind).toBe('GUIDE');
  });
});

describe('D1BlogPostRepository.listByLocaleAndKind', () => {
  it('splits the streams: blog index = RATE_CHANGE only, guides = GUIDE only', async () => {
    const rate = await posts.create({
      slug: nextSlug('stream-rate'),
      locale: 'sv',
      title: 'rate',
      bodyMarkdown: 'r',
      kind: 'RATE_CHANGE',
    });
    const guide = await posts.create({
      slug: nextSlug('stream-guide'),
      locale: 'sv',
      title: 'guide',
      bodyMarkdown: 'g',
      kind: 'GUIDE',
    });

    const rateChanges = await posts.listByLocaleAndKind('sv', 'RATE_CHANGE');
    const guides = await posts.listByLocaleAndKind('sv', 'GUIDE');
    expect(rateChanges.map((r) => r.id)).toContain(rate.id);
    expect(rateChanges.map((r) => r.kind)).toEqual(['RATE_CHANGE']);
    expect(guides.map((r) => r.id)).toContain(guide.id);
    expect(guides.map((r) => r.kind)).toEqual(['GUIDE']);
  });

  it('narrows by kind on top of the status filter, never widening it', async () => {
    await posts.create({
      slug: nextSlug('draft-rate'),
      locale: 'sv',
      title: 'draft rate',
      bodyMarkdown: 'd',
      kind: 'RATE_CHANGE',
    });
    const published = await posts.create({
      slug: nextSlug('pub-rate'),
      locale: 'sv',
      title: 'pub rate',
      bodyMarkdown: 'p',
      kind: 'RATE_CHANGE',
    });
    await posts.create({
      slug: nextSlug('pub-guide'),
      locale: 'sv',
      title: 'pub guide',
      bodyMarkdown: 'pg',
      kind: 'GUIDE',
    });
    await posts.publish(published.id);

    const publishedRates = await posts.listByLocaleAndKind('sv', 'RATE_CHANGE', 'PUBLISHED');
    expect(publishedRates.map((r) => r.id)).toEqual([published.id]);

    const draftGuides = await posts.listByLocaleAndKind('sv', 'GUIDE', 'DRAFT');
    expect(draftGuides.every((r) => r.kind === 'GUIDE' && r.status === 'DRAFT')).toBe(true);
  });

  it('scopes the kind filter to the requested locale', async () => {
    await posts.create({
      slug: nextSlug('locale'),
      locale: 'en',
      title: 'en guide',
      bodyMarkdown: 'e',
      kind: 'GUIDE',
    });
    const guides = await posts.listByLocaleAndKind('de', 'GUIDE');
    expect(guides).toEqual([]);
  });
});

describe('blog_posts kind CHECK constraint', () => {
  it('rejects a kind outside RATE_CHANGE|GUIDE at the SQL boundary', async () => {
    const slug = nextSlug('badkind');
    await expect(
      d1
        .prepare(
          `INSERT INTO blog_posts (slug, locale, title, body_markdown, kind)
           VALUES (?, 'fi', 'x', 'x', 'NEWS')`,
        )
        .bind(slug)
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('rejects mutating an existing row onto an unknown kind', async () => {
    const slug = nextSlug('mutate');
    await posts.create({ slug, locale: 'fi', title: 'm', bodyMarkdown: 'm', kind: 'GUIDE' });
    await expect(
      d1
        .prepare(`UPDATE blog_posts SET kind = 'GUIDES' WHERE slug = ?`)
        .bind(slug)
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });
});

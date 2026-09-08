/**
 * D1 BlogPostRepository — rate-change explainers behind a human
 * publication gate (task 1.4, change trust-and-reach-roadmap), backed
 * by the `blog_posts` table (migration 0016). Implements the abstract
 * contract from abstracts.ts.
 *
 * Lifecycle: the draft hook at the manual rate-confirmation point
 * creates FI + EN DRAFT rows (fail-open); only an explicit operator
 * publish makes a post public (guarded DRAFT → PUBLISHED UPDATE
 * stamping published_at), and the public endpoints read PUBLISHED rows
 * only (the (locale, status) index). Draft edits are guarded to DRAFT
 * rows — what the public has seen is immutable. One row per
 * (slug, locale): the unique key is the create-time conflict.
 *
 * `rate_dataset_version` is a version_label reference, not an FK — rate
 * versions are append-only rows across the rule tables, not keyed
 * lookups; the repository stores it verbatim.
 *
 * @module D1BlogPostRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';
import {
  BlogPostRepository,
  type BlogPostCreateInput,
  type BlogPostDraftPatch,
  type BlogPostRecord,
  type BlogPostStatus,
} from '../../abstracts';

const POST_STATUSES: readonly BlogPostStatus[] = ['DRAFT', 'PUBLISHED'];

/** Raw D1 blog_posts row. */
interface D1BlogPostRow {
  readonly id: number;
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly body_markdown: string;
  readonly status: string;
  readonly rate_dataset_version: string | null;
  readonly published_at: string | null;
  readonly created_at: string;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): BlogPostStatus {
  if (!POST_STATUSES.includes(value as BlogPostStatus)) {
    throw new Error(
      `blog_posts.status "${value}" is not a known blog-post lifecycle state`,
    );
  }
  return value as BlogPostStatus;
}

function toContractPost(row: D1BlogPostRow): BlogPostRecord {
  return {
    id: row.id,
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    status: toStatus(row.status),
    rateDatasetVersion: row.rate_dataset_version,
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    createdAt: new Date(row.created_at),
  };
}

const POST_COLUMNS = `
  id, slug, locale, title, body_markdown, status, rate_dataset_version,
  published_at, created_at`;

const INSERT_SQL = `
  INSERT INTO blog_posts (slug, locale, title, body_markdown, rate_dataset_version, status)
  VALUES (?, ?, ?, ?, ?, 'DRAFT')
  RETURNING ${POST_COLUMNS}`;

const FIND_BY_ID_SQL = `
  SELECT ${POST_COLUMNS} FROM blog_posts WHERE id = ?`;

const FIND_BY_SLUG_AND_LOCALE_SQL = `
  SELECT ${POST_COLUMNS} FROM blog_posts WHERE slug = ? AND locale = ?`;

const LIST_BY_LOCALE_SQL = `
  SELECT ${POST_COLUMNS} FROM blog_posts WHERE locale = ? ORDER BY id ASC`;

const LIST_BY_LOCALE_AND_STATUS_SQL = `
  SELECT ${POST_COLUMNS} FROM blog_posts WHERE locale = ? AND status = ?
  ORDER BY id ASC`;

// COALESCE keeps absent patch keys at their current values; the DRAFT
// guard makes published posts immutable at the SQL level.
const UPDATE_DRAFT_SQL = `
  UPDATE blog_posts SET
    title = COALESCE(?, title),
    body_markdown = COALESCE(?, body_markdown),
    rate_dataset_version = COALESCE(?, rate_dataset_version)
  WHERE id = ? AND status = 'DRAFT'
  RETURNING ${POST_COLUMNS}`;

/** Guarded transition — only a DRAFT can publish, exactly once. */
const PUBLISH_SQL = `
  UPDATE blog_posts SET status = 'PUBLISHED', published_at = ?
   WHERE id = ? AND status = 'DRAFT'
  RETURNING ${POST_COLUMNS}`;

const DELETE_SQL = `
  DELETE FROM blog_posts WHERE id = ?`;

@Injectable()
export class D1BlogPostRepository extends BlogPostRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: BlogPostCreateInput): Promise<BlogPostRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        input.slug,
        input.locale,
        input.title,
        input.bodyMarkdown,
        input.rateDatasetVersion ?? null,
      )
      .first<D1BlogPostRow>();
    if (!row) {
      throw new Error('blog_posts INSERT .. RETURNING returned no row');
    }
    return toContractPost(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<BlogPostRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1BlogPostRow>();
    return row ? toContractPost(row) : null;
  }

  /** @inheritdoc */
  async findBySlugAndLocale(
    slug: string,
    locale: string,
  ): Promise<BlogPostRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_SLUG_AND_LOCALE_SQL)
      .bind(slug, locale)
      .first<D1BlogPostRow>();
    return row ? toContractPost(row) : null;
  }

  /** @inheritdoc */
  async listByLocale(
    locale: string,
    status?: BlogPostStatus,
  ): Promise<BlogPostRecord[]> {
    const rows = status
      ? (
          await this.d1
            .prepare(LIST_BY_LOCALE_AND_STATUS_SQL)
            .bind(locale, status)
            .all<D1BlogPostRow>()
        ).results
      : (
          await this.d1
            .prepare(LIST_BY_LOCALE_SQL)
            .bind(locale)
            .all<D1BlogPostRow>()
        ).results;
    return rows.map(toContractPost);
  }

  /** @inheritdoc */
  async updateDraft(
    id: number,
    patch: BlogPostDraftPatch,
  ): Promise<BlogPostRecord | null> {
    const row = await this.d1
      .prepare(UPDATE_DRAFT_SQL)
      .bind(
        patch.title ?? null,
        patch.bodyMarkdown ?? null,
        patch.rateDatasetVersion ?? null,
        id,
      )
      .first<D1BlogPostRow>();
    return row ? toContractPost(row) : null;
  }

  /** @inheritdoc */
  async publish(id: number, publishedAt?: Date): Promise<BlogPostRecord | null> {
    const row = await this.d1
      .prepare(PUBLISH_SQL)
      .bind((publishedAt ?? new Date()).toISOString(), id)
      .first<D1BlogPostRow>();
    return row ? toContractPost(row) : null;
  }

  /** @inheritdoc */
  async delete(id: number): Promise<boolean> {
    const result = await this.d1.prepare(DELETE_SQL).bind(id).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}

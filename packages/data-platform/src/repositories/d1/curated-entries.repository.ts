/**
 * D1 CuratedEntriesRepository — operator-managed editorial content
 * behind the public curated lists (task 7.1, change
 * product-roadmap-phases-1-4, design R10, spec: curated-lists),
 * backed by the `curated_entries` table. Co-located abstract +
 * concrete (ferry-offers/producer-links precedent — a D1-only table
 * with no pg counterpart).
 *
 * LIFECYCLE (binding spec difference from ferry_offers /
 * producer_links): the spec mandates entries are "created, updated,
 * and unpublished through the audited operator console" and that
 * content changes SHALL NOT require code changes or deploys.
 * Therefore:
 *
 * - **Create** — rows always land DRAFT: curation work in progress is
 *   invisible to the public list.
 * - **Update** — allowed in ANY status, including PUBLISHED (editing
 *   published content through the console is exactly the "no deploys"
 *   requirement). Every edit bumps `updated_at`; the console audits
 *   before/after values so the editorial history stays in the audit
 *   trail.
 * - **Publish** — the DRAFT → PUBLISHED transition (console action).
 * - **Unpublish** — the PUBLISHED → DRAFT transition (console
 *   action): content comes off the public list without deleting the
 *   editorial record. PUBLISHED is therefore NOT terminal (unlike the
 *   ferry/producer precedents).
 * - **Delete** — any status; the console records the audit event,
 *   this class only removes the row.
 *
 * Evidence discipline (R10): rationale and reviewer are NOT NULL and
 * non-empty at the schema level. evidence_links is a JSON column with
 * a schema-level json_valid() CHECK plus repository-level STRUCTURE
 * validation ({@link evidenceLinksSchema}, exported zod — the single
 * source of truth the console DTO reuses): a non-empty array of
 * {label, url} links with http(s) URLs. An unevidenced entry is
 * unrepresentable.
 *
 * Target discipline: an entry points at exactly one thing — a
 * product_master row OR an external reference, never both, never
 * neither (schema CHECK; the console mirrors it for early 400s).
 *
 * Slug handling: {@link normalizeListSlug} is the single
 * normalization rule (trim + lowercase), exported pure and applied on
 * write AND lookup — the stored form is always normalized, the 7.2
 * public lookup is a plain indexed equality on (list_slug, status).
 *
 * Ordering: the console list orders DRAFT-first, then (listSlug, id);
 * public reads order by id — deterministic regardless of insert order.
 *
 * @module D1CuratedEntriesRepository
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { D1DatabaseLike } from '../../d1/executor';

/** Lifecycle states — DRAFT work in progress, PUBLISHED publicly visible. */
export const CURATED_ENTRY_STATUSES = ['DRAFT', 'PUBLISHED'] as const;

export type CuratedEntryStatus = (typeof CURATED_ENTRY_STATUSES)[number];

/** One evidence link — a human label plus a verifiable http(s) source. */
export interface EvidenceLink {
  readonly label: string;
  readonly url: string;
}

/**
 * THE evidence-links structure (single source of truth): a non-empty
 * array of labeled http(s) links. Exported so the console DTO parses
 * the exact same shape the repository enforces — no drift between the
 * 400 surface and the storage guard.
 */
export const evidenceLinkSchema = z.object({
  label: z
    .string({
      required_error: 'evidence link label must be a non-empty string (max 256 chars)',
      invalid_type_error: 'evidence link label must be a non-empty string (max 256 chars)',
    })
    .min(1, 'evidence link label must be a non-empty string (max 256 chars)')
    .max(256, 'evidence link label must be a non-empty string (max 256 chars)'),
  url: z
    .string({
      required_error: 'evidence link url must be an http(s) URL (max 2048 chars)',
      invalid_type_error: 'evidence link url must be an http(s) URL (max 2048 chars)',
    })
    .min(1, 'evidence link url must be an http(s) URL (max 2048 chars)')
    .max(2048, 'evidence link url must be an http(s) URL (max 2048 chars)')
    .regex(/^https?:\/\//, 'evidence link url must be an http(s) URL (max 2048 chars)'),
});

export const evidenceLinksSchema = z
  .array(evidenceLinkSchema)
  .min(1, 'evidenceLinks must be a non-empty array of {label, url} links')
  .max(50, 'evidenceLinks must be a non-empty array of {label, url} links');

/**
 * Thrown when evidence links fail the structural validation — a
 * storage-facing guard the console maps to a 400 (the schema-level
 * json_valid CHECK is the last line of defense behind it).
 */
export class InvalidEvidenceLinksError extends Error {
  constructor(readonly issues: string) {
    super(`evidenceLinks failed validation: ${issues}`);
    this.name = 'InvalidEvidenceLinksError';
  }
}

/** Parse + validate an evidence-links value, returning frozen plain links. */
export function parseEvidenceLinks(value: unknown): EvidenceLink[] {
  const parsed = evidenceLinksSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidEvidenceLinksError(
      parsed.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  return parsed.data.map((link) => ({ label: link.label, url: link.url }));
}

/**
 * The slug normalization rule, exported pure — the ONLY normalization
 * this module performs, shared by writes and lookups. Idempotent:
 * `normalizeListSlug(normalizeListSlug(x)) === normalizeListSlug(x)`.
 */
export function normalizeListSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Contract row — camelCase projection of the snake_case table row. */
export interface CuratedEntryRecord {
  readonly id: number;
  /** Owning list slug (normalized form). */
  readonly listSlug: string;
  /** The referenced product — null exactly when externalRef is set. */
  readonly productId: number | null;
  /** The external reference — null exactly when productId is set. */
  readonly externalRef: string | null;
  /** The mandatory editorial justification. */
  readonly rationale: string;
  /** Validated evidence links (non-empty array of {label, url}). */
  readonly evidenceLinks: readonly EvidenceLink[];
  /** Operator who reviewed the entry. */
  readonly reviewer: string;
  readonly status: CuratedEntryStatus;
  readonly createdAt: Date;
  /** Moves on every console edit — the no-deploy content-update face. */
  readonly updatedAt: Date;
}

/** Input for appending a new entry. The slug may arrive in any case —
 * it is normalized before persistence (see module docs). Exactly one
 * of productId / externalRef must be present. */
export interface CuratedEntryInsert {
  readonly listSlug: string;
  readonly productId?: number;
  readonly externalRef?: string;
  readonly rationale: string;
  readonly evidenceLinks: readonly EvidenceLink[];
  readonly reviewer: string;
}

/** Editable fields of an entry. Status and timestamps are not directly
 * editable. Target rule: providing ONE target side replaces the whole
 * target (the other side clears) — the exactly-one invariant makes
 * partial target patching meaningless. */
export interface CuratedEntryUpdate {
  readonly listSlug?: string;
  readonly productId?: number;
  readonly externalRef?: string;
  readonly rationale?: string;
  readonly evidenceLinks?: readonly EvidenceLink[];
  readonly reviewer?: string;
}

/** Raw D1 curated_entries row. */
interface D1CuratedEntryRow {
  readonly id: number;
  readonly list_slug: string;
  readonly product_id: number | null;
  readonly external_ref: string | null;
  readonly rationale: string;
  readonly evidence_links: string;
  readonly reviewer: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): CuratedEntryStatus {
  if (!(CURATED_ENTRY_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `curated_entries.status "${value}" is not a known curated-entry lifecycle state`,
    );
  }
  return value as CuratedEntryStatus;
}

/**
 * Enforce the exactly-one-target invariant on INPUT (the schema CHECK
 * is the at-rest guard; this fails the write before SQLite does).
 */
function requireExactlyOneTarget(
  productId: number | undefined,
  externalRef: string | undefined,
): void {
  if ((productId === undefined) === (externalRef === undefined)) {
    throw new Error(
      'curated_entries target is ambiguous — exactly one of productId or externalRef is required',
    );
  }
}

function toContract(row: D1CuratedEntryRow): CuratedEntryRecord {
  return {
    id: row.id,
    listSlug: row.list_slug,
    productId: row.product_id,
    externalRef: row.external_ref,
    rationale: row.rationale,
    // Parse + validate on every read too — a row that somehow bypassed
    // the write-time validation cannot leak out as unvalidated JSON.
    evidenceLinks: parseEvidenceLinks(JSON.parse(row.evidence_links)),
    reviewer: row.reviewer,
    status: toStatus(row.status),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const COLUMNS =
  'id, list_slug, product_id, external_ref, rationale, evidence_links, ' +
  'reviewer, status, created_at, updated_at';

const FIND_BY_ID_SQL = `SELECT ${COLUMNS} FROM curated_entries WHERE id = ?`;

/** Console listing: DRAFT first, then deterministic curation order. */
const LIST_ALL_SQL = `
  SELECT ${COLUMNS} FROM curated_entries
   ORDER BY status ASC, list_slug ASC, id ASC`;

/** Console per-slug read (any status). */
const LIST_BY_SLUG_SQL = `
  SELECT ${COLUMNS} FROM curated_entries
   WHERE list_slug = ?
   ORDER BY status ASC, id ASC`;

/**
 * THE public read path (7.2 will expose it): ONLY PUBLISHED entries
 * of one slug, deterministic id order. Draft (or unpublished) entries
 * never surface here — spec "Draft entries hidden".
 */
const LIST_PUBLISHED_BY_SLUG_SQL = `
  SELECT ${COLUMNS} FROM curated_entries
   WHERE list_slug = ? AND status = 'PUBLISHED'
   ORDER BY id ASC`;

const INSERT_SQL = `
  INSERT INTO curated_entries (
    list_slug, product_id, external_ref, rationale, evidence_links,
    reviewer, status
  )
  VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')
  RETURNING ${COLUMNS}`;

const PUBLISH_SQL = `
  UPDATE curated_entries SET status = 'PUBLISHED'
   WHERE id = ? AND status = 'DRAFT'
   RETURNING ${COLUMNS}`;

const UNPUBLISH_SQL = `
  UPDATE curated_entries SET status = 'DRAFT'
   WHERE id = ? AND status = 'PUBLISHED'
   RETURNING ${COLUMNS}`;

const DELETE_SQL = `DELETE FROM curated_entries WHERE id = ?`;

/**
 * The curated-list content store. Console-only writes; the public
 * list API (task 7.2) consumes only {@link listPublishedBySlug}.
 */
@Injectable()
export abstract class CuratedEntriesRepository {
  /** Append a new entry. Always lands DRAFT — never auto-publishes. */
  abstract create(input: CuratedEntryInsert): Promise<CuratedEntryRecord>;

  /** One entry by id, any status — or null. */
  abstract findById(id: number): Promise<CuratedEntryRecord | null>;

  /** Every row (DRAFT + PUBLISHED) — the console listing. */
  abstract listAll(): Promise<CuratedEntryRecord[]>;

  /** Every row of one slug (any status) — the console's per-list view. */
  abstract listBySlug(listSlug: string): Promise<CuratedEntryRecord[]>;

  /**
   * THE public read path: ONLY PUBLISHED entries of the NORMALIZED
   * slug. Drafts (and unpublished rows) never appear — spec
   * "Draft entries hidden".
   */
  abstract listPublishedBySlug(listSlug: string): Promise<CuratedEntryRecord[]>;

  /**
   * Edit an entry's content/evidence fields — allowed in ANY status
   * (spec: published content is updatable without deploys). Bumps
   * `updated_at`. Returns null when the row is unknown.
   */
  abstract update(id: number, patch: CuratedEntryUpdate): Promise<CuratedEntryRecord | null>;

  /**
   * The DRAFT → PUBLISHED transition. Returns null when the entry is
   * unknown or not DRAFT (republishing a published entry is a no-op
   * null — use unpublish first to rework it).
   */
  abstract publish(id: number): Promise<CuratedEntryRecord | null>;

  /**
   * The PUBLISHED → DRAFT transition (spec "created, updated, and
   * unpublished"). Returns null when the entry is unknown or not
   * PUBLISHED.
   */
  abstract unpublish(id: number): Promise<CuratedEntryRecord | null>;

  /** Remove an entry (any status). Returns whether a row was removed. */
  abstract remove(id: number): Promise<boolean>;
}

@Injectable()
export class D1CuratedEntriesRepository extends CuratedEntriesRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: CuratedEntryInsert): Promise<CuratedEntryRecord> {
    requireExactlyOneTarget(input.productId, input.externalRef);
    // Validated (and canonically stringified) before the write — the
    // raw form is never persisted; the json_valid CHECK is the backstop.
    const evidenceLinks = JSON.stringify(parseEvidenceLinks(input.evidenceLinks));
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        // Normalized on write — the raw form is never persisted.
        normalizeListSlug(input.listSlug),
        input.productId ?? null,
        input.externalRef ?? null,
        input.rationale,
        evidenceLinks,
        input.reviewer,
      )
      .first<D1CuratedEntryRow>();
    if (!row) {
      throw new Error(
        `curated_entries insert for slug "${input.listSlug}" returned no row`,
      );
    }
    return toContract(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<CuratedEntryRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1CuratedEntryRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async listAll(): Promise<CuratedEntryRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_ALL_SQL).all<D1CuratedEntryRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async listBySlug(listSlug: string): Promise<CuratedEntryRecord[]> {
    const rows = (
      await this.d1
        .prepare(LIST_BY_SLUG_SQL)
        .bind(normalizeListSlug(listSlug))
        .all<D1CuratedEntryRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async listPublishedBySlug(listSlug: string): Promise<CuratedEntryRecord[]> {
    const rows = (
      await this.d1
        .prepare(LIST_PUBLISHED_BY_SLUG_SQL)
        // Normalized on lookup — the exact-match contract.
        .bind(normalizeListSlug(listSlug))
        .all<D1CuratedEntryRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async update(id: number, patch: CuratedEntryUpdate): Promise<CuratedEntryRecord | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }
    // Target resolution: providing one side IS the new target (the
    // other clears) — the exactly-one invariant leaves no partial
    // patch to merge. The guard below fails impossible resolutions
    // (it is unreachable for well-formed patches, and the schema
    // CHECK is the at-rest backstop).
    const productId =
      patch.externalRef !== undefined
        ? null
        : patch.productId !== undefined
          ? patch.productId
          : existing.productId;
    const externalRef =
      patch.productId !== undefined
        ? null
        : patch.externalRef !== undefined
          ? patch.externalRef
          : existing.externalRef;
    requireExactlyOneTarget(productId ?? undefined, externalRef ?? undefined);
    const evidenceLinks =
      patch.evidenceLinks !== undefined
        ? JSON.stringify(parseEvidenceLinks(patch.evidenceLinks))
        : JSON.stringify(existing.evidenceLinks);
    const row = await this.d1
      .prepare(
        `UPDATE curated_entries
            SET list_slug = ?, product_id = ?, external_ref = ?, rationale = ?,
                evidence_links = ?, reviewer = ?, updated_at =
                  (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          WHERE id = ?
          RETURNING ${COLUMNS}`,
      )
      .bind(
        patch.listSlug !== undefined
          ? normalizeListSlug(patch.listSlug)
          : existing.listSlug,
        productId ?? null,
        externalRef ?? null,
        patch.rationale ?? existing.rationale,
        evidenceLinks,
        patch.reviewer ?? existing.reviewer,
        id,
      )
      .first<D1CuratedEntryRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async publish(id: number): Promise<CuratedEntryRecord | null> {
    // Constrained UPDATE: only a DRAFT row flips. Unknown/not-draft
    // both surface as null — the console distinguishes via findById
    // first (ferry parity).
    const row = await this.d1
      .prepare(PUBLISH_SQL)
      .bind(id)
      .first<D1CuratedEntryRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async unpublish(id: number): Promise<CuratedEntryRecord | null> {
    // Constrained UPDATE: only a PUBLISHED row flips back (spec
    // "created, updated, and unpublished"); unknown/not-published
    // both surface as null.
    const row = await this.d1
      .prepare(UNPUBLISH_SQL)
      .bind(id)
      .first<D1CuratedEntryRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async remove(id: number): Promise<boolean> {
    const result = await this.d1.prepare(DELETE_SQL).bind(id).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}

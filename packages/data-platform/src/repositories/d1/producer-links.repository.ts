/**
 * D1 ProducerLinksRepository — curated sibling-product evidence for the
 * producer dupe finder (task 6.1, change product-roadmap-phases-1-4,
 * design R9, spec: producer-matching), backed by the `producer_links`
 * table. Co-located abstract + concrete (ferry-offers precedent — a
 * D1-only table with no pg counterpart).
 *
 * EXACT-MATCHING ARCHITECTURE (binding, spec "No similarity scoring"):
 * the matching path is an exact lookup on normalized producer keys —
 * plain indexed equality. No scoring, no similarity, no embedding, no
 * fuzzy path exists in this module, and no schema column could carry
 * one (data minimization). {@link normalizeProducerKey} is the single
 * normalization rule, exported pure so the 6.2 seed importer reuses
 * the identical rule; it is pinned by tests. Near-miss keys CANNOT
 * match — the lookup is `producer_key = normalize(?)`, nothing else.
 *
 * Normalization rule (exact, idempotent):
 *
 *   1. trim leading/trailing whitespace,
 *   2. lowercase (ECMAScript `toLowerCase`),
 *   3. collapse every internal whitespace run (spaces, tabs, newlines)
 *      into one space.
 *
 * The column stores the NORMALIZED key; writes normalize too, so a raw
 * form is never persisted and the lookup needs no SQL expression.
 *
 * Evidence discipline (R9): producer key, manufacturer, and source URL
 * plus reviewer and reviewed-at are NOT NULL and non-empty at the
 * schema level — an unevidenced row is unrepresentable. Every record
 * this repository returns carries the complete evidence.
 *
 * Lifecycle (ferry_offers precedent, audited at the console layer):
 *
 * - **Create** — rows always land DRAFT: curation work in progress is
 *   invisible to the public dupes API.
 * - **Update** — DRAFT rows only. A PUBLISHED row is immutable
 *   ({@link ProducerLinkImmutableError}); corrections delete and
 *   re-create through the audited console, so every state the public
 *   ever saw is fully explained by the audit trail.
 * - **Publish** — the only DRAFT → PUBLISHED transition, the console's
 *   explicit publish action. PUBLISHED is terminal: republish is a
 *   no-op null (ferry/consumption-norms parity).
 * - **Delete** — any status; how content comes down. The console
 *   records the audit event; this class only removes the row.
 *
 * Ordering: the console list orders by (status, producerKey,
 * alkoProductId, id) ascending — deterministic regardless of insert
 * order. The exact lookups return rows by id ascending.
 *
 * @module D1ProducerLinksRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/**
 * The normalization rule, exported pure — the ONLY normalization this
 * module performs, shared by writes, lookups, and the 6.2 seed
 * importer. See the module docs for the exact rule. Idempotent:
 * `normalizeProducerKey(normalizeProducerKey(x)) === normalizeProducerKey(x)`.
 */
export function normalizeProducerKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Lifecycle states — DRAFT work in progress, PUBLISHED publicly visible. */
export const PRODUCER_LINK_STATUSES = ['DRAFT', 'PUBLISHED'] as const;

export type ProducerLinkStatus = (typeof PRODUCER_LINK_STATUSES)[number];

/** Contract row — camelCase projection of the snake_case table row. */
export interface ProducerLinkRecord {
  readonly id: number;
  /** The Alko product the link starts from. */
  readonly alkoProductId: number;
  /** The foreign-shop sibling product it evidences. */
  readonly siblingProductId: number;
  /** Producer key in normalized form — the exact-lookup matching key. */
  readonly producerKey: string;
  /** Manufacturer behind the link — evidence presented with every sibling. */
  readonly manufacturer: string;
  /** Verifiable source URL for the sibling claim. */
  readonly sourceUrl: string;
  /** Operator who reviewed the link. */
  readonly reviewer: string;
  /** When the review happened. */
  readonly reviewedAt: Date;
  readonly status: ProducerLinkStatus;
  readonly createdAt: Date;
}

/** Input for appending a new link. The producer key may arrive in any
 * form — it is normalized before persistence (see module docs). */
export interface ProducerLinkInsert {
  readonly alkoProductId: number;
  readonly siblingProductId: number;
  readonly producerKey: string;
  readonly manufacturer: string;
  readonly sourceUrl: string;
  readonly reviewer: string;
  /** ISO-8601 instant of the recorded review (validated at the DTO layer). */
  readonly reviewedAt: string;
}

/** Editable fields of a DRAFT link. Status and createdAt are not editable. */
export interface ProducerLinkUpdate {
  readonly alkoProductId?: number;
  readonly siblingProductId?: number;
  readonly producerKey?: string;
  readonly manufacturer?: string;
  readonly sourceUrl?: string;
  readonly reviewer?: string;
  readonly reviewedAt?: string;
}

/**
 * Thrown by `update` when the target link is PUBLISHED — published
 * curated evidence is immutable (ferry precedent); the console
 * surfaces this as a 409 rather than silently rewriting what the
 * public saw.
 */
export class ProducerLinkImmutableError extends Error {
  readonly linkId: number;

  constructor(linkId: number) {
    super(
      `producer_links row ${linkId} is PUBLISHED — published curated evidence is ` +
        'immutable; delete and re-create it through the operator console',
    );
    this.name = 'ProducerLinkImmutableError';
    this.linkId = linkId;
  }
}

/** Raw D1 producer_links row. */
interface D1ProducerLinkRow {
  readonly id: number;
  readonly alko_product_id: number;
  readonly sibling_product_id: number;
  readonly producer_key: string;
  readonly manufacturer: string;
  readonly source_url: string;
  readonly reviewer: string;
  readonly reviewed_at: string;
  readonly status: string;
  readonly created_at: string;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): ProducerLinkStatus {
  if (!(PRODUCER_LINK_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `producer_links.status "${value}" is not a known producer-link lifecycle state`,
    );
  }
  return value as ProducerLinkStatus;
}

function toContract(row: D1ProducerLinkRow): ProducerLinkRecord {
  return {
    id: row.id,
    alkoProductId: row.alko_product_id,
    siblingProductId: row.sibling_product_id,
    producerKey: row.producer_key,
    manufacturer: row.manufacturer,
    sourceUrl: row.source_url,
    reviewer: row.reviewer,
    reviewedAt: new Date(row.reviewed_at),
    status: toStatus(row.status),
    createdAt: new Date(row.created_at),
  };
}

const COLUMNS =
  'id, alko_product_id, sibling_product_id, producer_key, manufacturer, ' +
  'source_url, reviewer, reviewed_at, status, created_at';

const FIND_BY_ID_SQL = `SELECT ${COLUMNS} FROM producer_links WHERE id = ?`;

/** Console listing: DRAFT first, then deterministic curation order. */
const LIST_ALL_SQL = `
  SELECT ${COLUMNS} FROM producer_links
   ORDER BY status ASC, producer_key ASC, alko_product_id ASC, id ASC`;

/**
 * THE matching path (spec "No similarity scoring"): exact equality on
 * the normalized key, PUBLISHED rows only. No LIKE, no scoring, no
 * similarity function — a near-miss key matches nothing.
 */
const FIND_PUBLISHED_BY_KEY_SQL = `
  SELECT ${COLUMNS} FROM producer_links
   WHERE producer_key = ? AND status = 'PUBLISHED'
   ORDER BY id ASC`;

/** The matching path scoped to one Alko product (the dupes endpoint's query). */
const FIND_PUBLISHED_BY_PRODUCT_AND_KEY_SQL = `
  SELECT ${COLUMNS} FROM producer_links
   WHERE alko_product_id = ? AND producer_key = ? AND status = 'PUBLISHED'
   ORDER BY id ASC`;

/** Product-scoped console read (any status). */
const LIST_BY_PRODUCT_SQL = `
  SELECT ${COLUMNS} FROM producer_links
   WHERE alko_product_id = ?
   ORDER BY status ASC, producer_key ASC, id ASC`;

const INSERT_SQL = `
  INSERT INTO producer_links (
    alko_product_id, sibling_product_id, producer_key, manufacturer,
    source_url, reviewer, reviewed_at, status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT')
  RETURNING ${COLUMNS}`;

const PUBLISH_SQL = `
  UPDATE producer_links SET status = 'PUBLISHED'
   WHERE id = ? AND status = 'DRAFT'
   RETURNING ${COLUMNS}`;

const DELETE_SQL = `DELETE FROM producer_links WHERE id = ?`;

/**
 * The curated sibling-product evidence store. Console-only writes; the
 * public dupes API (task 6.3) consumes only the exact lookups.
 */
@Injectable()
export abstract class ProducerLinksRepository {
  /** Append a new link. Always lands DRAFT — never auto-publishes. */
  abstract create(input: ProducerLinkInsert): Promise<ProducerLinkRecord>;

  /** One link by id, any status — or null. */
  abstract findById(id: number): Promise<ProducerLinkRecord | null>;

  /** Every row (DRAFT + PUBLISHED) — the console listing. */
  abstract listAll(): Promise<ProducerLinkRecord[]>;

  /** Every row of one Alko product (any status) — console/product reads. */
  abstract listByAlkoProductId(alkoProductId: number): Promise<ProducerLinkRecord[]>;

  /**
   * THE matching path: PUBLISHED links whose stored key equals the
   * NORMALIZED form of the given key — exact equality only. A
   * near-miss key returns [] (never a similarity substitute).
   */
  abstract findPublishedByProducerKey(producerKey: string): Promise<ProducerLinkRecord[]>;

  /** The matching path scoped to one Alko product (same exact-match contract). */
  abstract findPublishedByAlkoProductAndKey(
    alkoProductId: number,
    producerKey: string,
  ): Promise<ProducerLinkRecord[]>;

  /**
   * Edit a DRAFT link's content/evidence fields. Returns null when the
   * row is unknown; throws {@link ProducerLinkImmutableError} when it
   * is PUBLISHED (module docs — delete and re-create instead).
   */
  abstract update(id: number, patch: ProducerLinkUpdate): Promise<ProducerLinkRecord | null>;

  /**
   * The manual publish transition (operator confirmation path). Returns
   * null when the link is unknown or not DRAFT (PUBLISHED is terminal —
   * republish is a no-op null, ferry parity).
   */
  abstract publish(id: number): Promise<ProducerLinkRecord | null>;

  /** Remove a link (any status). Returns whether a row was removed. */
  abstract remove(id: number): Promise<boolean>;
}

@Injectable()
export class D1ProducerLinksRepository extends ProducerLinksRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: ProducerLinkInsert): Promise<ProducerLinkRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        input.alkoProductId,
        input.siblingProductId,
        // Normalized on write — the raw form is never persisted.
        normalizeProducerKey(input.producerKey),
        input.manufacturer,
        input.sourceUrl,
        input.reviewer,
        input.reviewedAt,
      )
      .first<D1ProducerLinkRow>();
    if (!row) {
      throw new Error(
        `producer_links insert for product ${input.alkoProductId} returned no row`,
      );
    }
    return toContract(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<ProducerLinkRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1ProducerLinkRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async listAll(): Promise<ProducerLinkRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_ALL_SQL).all<D1ProducerLinkRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async listByAlkoProductId(alkoProductId: number): Promise<ProducerLinkRecord[]> {
    const rows = (
      await this.d1
        .prepare(LIST_BY_PRODUCT_SQL)
        .bind(alkoProductId)
        .all<D1ProducerLinkRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async findPublishedByProducerKey(
    producerKey: string,
  ): Promise<ProducerLinkRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_PUBLISHED_BY_KEY_SQL)
        // Normalized on lookup — the exact-match contract.
        .bind(normalizeProducerKey(producerKey))
        .all<D1ProducerLinkRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async findPublishedByAlkoProductAndKey(
    alkoProductId: number,
    producerKey: string,
  ): Promise<ProducerLinkRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_PUBLISHED_BY_PRODUCT_AND_KEY_SQL)
        .bind(alkoProductId, normalizeProducerKey(producerKey))
        .all<D1ProducerLinkRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async update(id: number, patch: ProducerLinkUpdate): Promise<ProducerLinkRecord | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }
    if (existing.status === 'PUBLISHED') {
      throw new ProducerLinkImmutableError(id);
    }
    const row = await this.d1
      .prepare(
        `UPDATE producer_links
            SET alko_product_id = ?, sibling_product_id = ?, producer_key = ?,
                manufacturer = ?, source_url = ?, reviewer = ?, reviewed_at = ?
          WHERE id = ?
          RETURNING ${COLUMNS}`,
      )
      .bind(
        patch.alkoProductId ?? existing.alkoProductId,
        patch.siblingProductId ?? existing.siblingProductId,
        patch.producerKey !== undefined
          ? normalizeProducerKey(patch.producerKey)
          : existing.producerKey,
        patch.manufacturer ?? existing.manufacturer,
        patch.sourceUrl ?? existing.sourceUrl,
        patch.reviewer ?? existing.reviewer,
        patch.reviewedAt ?? existing.reviewedAt.toISOString(),
        id,
      )
      .first<D1ProducerLinkRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async publish(id: number): Promise<ProducerLinkRecord | null> {
    // Constrained UPDATE: only a DRAFT row flips. Unknown/not-draft both
    // surface as null — the console distinguishes via findById first
    // (ferry parity).
    const row = await this.d1
      .prepare(PUBLISH_SQL)
      .bind(id)
      .first<D1ProducerLinkRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async remove(id: number): Promise<boolean> {
    const result = await this.d1.prepare(DELETE_SQL).bind(id).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}

/**
 * D1 AccountPreferencesRepository — the per-account onboarding answer row
 * (task 1.2, change add-onboarding-preferences; design D2/D7/D8). CRUD
 * over the `account_preferences` singleton (UNIQUE account_id).
 *
 * ## Partial-update semantics (design D2)
 *
 * put() takes a sparse patch: unspecified fields retain their stored
 * values, and an absent row is created on first write. Because a patch
 * may also explicitly CLEAR a nullable answer (`channel: null` = back to
 * unanswered, design D8), the merge cannot ride SQL COALESCE — the
 * stored row is read, the patch is merged in the contract layer, and the
 * full merged row is written through one upsert. D1's single-writer
 * execution makes the read-merge-write window benign: the last
 * completed write wins with a complete row, never a torn merge.
 *
 * ## Category tags (design D7)
 *
 * `categoryTags` is a JSON array of canonical PRODUCT_CATEGORIES keys,
 * validated element-wise here against the shared constant — the single
 * definition of the vocabulary (deliberately no per-element schema
 * CHECK). The empty array is VALID and means "follows no category".
 * An unknown tag raises UnknownCategoryTagError — a domain error the
 * route layer maps to 400 (the FavoritesCapReachedError convention).
 *
 * ## Reset and erasure
 *
 * reset() writes the unanswered shape over the existing row — UPDATE,
 * never DELETE — so id and created_at survive and only the answers
 * clear. getByAccount()/reset() on an account without a row return the
 * unanswered shape without materializing one (data minimization:
 * a row appears on first real write only). Deleting the account row
 * cascades here (GDPR erasure, migration 0031) — exercised in the
 * repository tests.
 *
 * The abstract class is co-located with the single concrete
 * implementation (the merchant-reliability / account-favorites
 * precedent — no pg counterpart, so no abstracts.ts contract).
 *
 * @module D1AccountPreferencesRepository
 */
import { Injectable } from '@nestjs/common';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../../d1/schema';
import type { D1DatabaseLike } from '../../d1/executor';

/**
 * The closed audience-answer set — the repository-side mirror of the
 * `account_preferences_channel_check` CHECK in d1/schema.ts (null =
 * unanswered). The CHECK stays the schema-level authority; this copy
 * gives validation and the route layer one importable constant.
 */
export const ACCOUNT_CHANNELS = ['TRAVEL', 'DELIVERY', 'BOTH'] as const;

export type AccountChannel = (typeof ACCOUNT_CHANNELS)[number];

/** Stored row — the D2 contract shape after contract-layer conversion. */
export interface AccountPreferencesRecord {
  readonly id: number;
  readonly accountId: number;
  /** null = the audience question was left unanswered (design D8). */
  readonly channel: AccountChannel | null;
  /** Followed categories, element-wise canonical keys (design D7). */
  readonly categoryTags: ProductCategory[];
  /** Weekly digest consent — false until explicit opt-in (design D3). */
  readonly digestEnabled: boolean;
  /** Quiz completion or explicit skip; null = still pending (design D6). */
  readonly onboardedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The no-row answer: every question unanswered, consent off. The literal
 * types make the defaults static — a caller can never read a answered
 * field off an account that never wrote the row.
 */
export interface UnansweredAccountPreferences {
  readonly accountId: number;
  readonly channel: null;
  readonly categoryTags: [];
  readonly digestEnabled: false;
  readonly onboardedAt: null;
}

/** getByAccount/reset return either the stored row or the unanswered shape. */
export type AccountPreferencesView =
  | AccountPreferencesRecord
  | UnansweredAccountPreferences;

/**
 * One digest-consent enumeration row (task 4.2, change
 * add-onboarding-preferences): the account's contact address plus the
 * raw preference answers the digest cron gates on. `emailVerifiedAt` is
 * the accounts-column read this table deliberately does not duplicate —
 * the JOIN is what makes the enumeration one query instead of a
 * per-account re-read.
 */
export interface DigestConsentRow {
  readonly accountId: number;
  /** The verified-or-not contact address from `accounts.email`. */
  readonly email: string;
  /** `accounts.email_verified_at` — null = unverified (the cron skips). */
  readonly emailVerifiedAt: Date | null;
  /** Followed categories as stored (canonical keys, design D7). */
  readonly categoryTags: ProductCategory[];
  /** Onboarding completion — null = still pending (the cron skips). */
  readonly onboardedAt: Date | null;
}

/** Sparse put() patch — unspecified fields retain their stored values (design D2). */
export interface AccountPreferencesPatch {
  /** Pass null to clear the answer back to unanswered (design D8). */
  readonly channel?: AccountChannel | null;
  readonly categoryTags?: readonly ProductCategory[];
  readonly digestEnabled?: boolean;
  /** Pass null to clear a recorded onboarding completion (design D6). */
  readonly onboardedAt?: Date | null;
}

/**
 * Thrown by put() when a category tag is not a canonical
 * PRODUCT_CATEGORIES key (design D7) — the route maps it to 400.
 */
export class UnknownCategoryTagError extends Error {
  constructor(readonly tag: string) {
    super(
      `unknown category tag "${tag}" — valid categories: ${PRODUCT_CATEGORIES.join(', ')}`,
    );
    this.name = 'UnknownCategoryTagError';
  }
}

/**
 * Thrown by put() when channel is outside the closed set — the
 * repository-side mirror of the schema CHECK, so the route answers 400
 * instead of a raw constraint failure.
 */
export class InvalidChannelError extends Error {
  constructor(readonly channel: string) {
    super(
      `invalid channel "${channel}" — valid channels: ${ACCOUNT_CHANNELS.join(', ')}`,
    );
    this.name = 'InvalidChannelError';
  }
}

/** The unanswered shape for one account (no row implied). */
export function unansweredAccountPreferences(
  accountId: number,
): UnansweredAccountPreferences {
  return {
    accountId,
    channel: null,
    categoryTags: [],
    digestEnabled: false,
    onboardedAt: null,
  };
}

/** Account-preferences contract (design D2), shared by the onboarding routes (task 1.3). */
@Injectable()
export abstract class AccountPreferencesRepository {
  /**
   * The account's preference row, or the unanswered shape when the
   * account has never written one.
   */
  abstract getByAccount(accountId: number): Promise<AccountPreferencesView>;

  /**
   * Merge a sparse patch into the account's row (unspecified fields
   * retained; absent row created on first write). Rejects with
   * UnknownCategoryTagError on a non-canonical tag (validated
   * element-wise, empty array valid) and with InvalidChannelError on a
   * channel outside the closed set.
   */
  abstract put(
    accountId: number,
    patch: AccountPreferencesPatch,
  ): Promise<AccountPreferencesRecord>;

  /**
   * Write the unanswered shape over the row — the row itself is kept
   * (id/created_at preserved, updated_at bumped). An account without a
   * row gets the unanswered shape and no new row.
   */
  abstract reset(accountId: number): Promise<AccountPreferencesView>;

  /**
   * Enumerate the digest-consented accounts — the narrow weekly-sweep
   * read (task 4.2): every row with `digest_enabled` true, joined to
   * `accounts` for the contact address and its verification instant.
   * This is ENUMERATION ONLY — the remaining eligibility conditions
   * (verified address, ≥ 1 tag, onboarded) are the digest cron's policy
   * and stay out of the SQL, so the sweep and its tests gate on the
   * predicate in one place. Order is unspecified; callers sort.
   */
  abstract listDigestConsents(): Promise<readonly DigestConsentRow[]>;
}

/** Raw D1 account_preferences row (digest_enabled is 0/1 CHECK-constrained). */
interface D1AccountPreferencesRow {
  readonly id: number;
  readonly account_id: number;
  readonly channel: string | null;
  readonly category_tags: string;
  readonly digest_enabled: number;
  readonly onboarded_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Raw joined consent row — accounts ⋈ account_preferences (task 4.2). */
interface D1DigestConsentRow {
  readonly account_id: number;
  readonly email: string;
  readonly email_verified_at: string | null;
  readonly category_tags: string;
  readonly onboarded_at: string | null;
}

function toContractConsent(row: D1DigestConsentRow): DigestConsentRow {
  return {
    accountId: row.account_id,
    email: row.email,
    emailVerifiedAt:
      row.email_verified_at === null ? null : new Date(row.email_verified_at),
    categoryTags: parseCategoryTags(row.category_tags),
    onboardedAt: row.onboarded_at === null ? null : new Date(row.onboarded_at),
  };
}

/** JSON.parse the tags column with a shape guard — bypass-writes fail loudly, not silently. */
function parseCategoryTags(json: string): ProductCategory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`account_preferences.category_tags holds invalid JSON: ${json}`);
  }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== 'string')) {
    throw new Error(
      'account_preferences.category_tags must be a JSON array of category keys',
    );
  }
  return parsed as ProductCategory[];
}

function toContractPreferences(row: D1AccountPreferencesRow): AccountPreferencesRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    channel: row.channel as AccountChannel | null,
    categoryTags: parseCategoryTags(row.category_tags),
    digestEnabled: row.digest_enabled !== 0,
    onboardedAt: row.onboarded_at === null ? null : new Date(row.onboarded_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Element-wise D7 validation against the shared constant; empty array is valid. */
function validateCategoryTags(tags: readonly unknown[]): ProductCategory[] {
  if (!Array.isArray(tags)) {
    throw new UnknownCategoryTagError(String(tags));
  }
  for (const tag of tags) {
    if (typeof tag !== 'string' || !(PRODUCT_CATEGORIES as readonly string[]).includes(tag)) {
      throw new UnknownCategoryTagError(String(tag));
    }
  }
  return [...tags] as ProductCategory[];
}

function validateChannel(channel: AccountChannel | null): AccountChannel | null {
  if (channel !== null && !(ACCOUNT_CHANNELS as readonly string[]).includes(channel)) {
    throw new InvalidChannelError(String(channel));
  }
  return channel;
}

// The preferences columns in SELECT/RETURNING order.
const PREFERENCE_COLUMNS = `
  id, account_id, channel, category_tags, digest_enabled, onboarded_at,
  created_at, updated_at`;

const FIND_BY_ACCOUNT_SQL = `
  SELECT ${PREFERENCE_COLUMNS} FROM account_preferences WHERE account_id = ?`;

// Full-row upsert off the merged values: the conflict target is the
// UNIQUE(account_id) index (migration 0031) — the idempotent-create
// guard. The update branch bumps updated_at only (created_at is
// immutable); the insert branch lets both ride the column defaults.
const UPSERT_SQL = `
  INSERT INTO account_preferences (account_id, channel, category_tags, digest_enabled, onboarded_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (account_id) DO UPDATE SET
    channel = excluded.channel,
    category_tags = excluded.category_tags,
    digest_enabled = excluded.digest_enabled,
    onboarded_at = excluded.onboarded_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  RETURNING ${PREFERENCE_COLUMNS}`;

// UPDATE, never DELETE — reset keeps the row (id/created_at preserved)
// and only clears the answers (design D2's row semantics).
const RESET_SQL = `
  UPDATE account_preferences
     SET channel = NULL,
         category_tags = '[]',
         digest_enabled = 0,
         onboarded_at = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE account_id = ?
RETURNING ${PREFERENCE_COLUMNS}`;

// The consent enumeration (task 4.2): consent flag in the WHERE, the
// accounts JOIN supplies the contact address + verification instant the
// preferences row intentionally does not copy (schema doc, design D3).
const LIST_DIGEST_CONSENTS_SQL = `
  SELECT p.account_id AS account_id,
         a.email AS email,
         a.email_verified_at AS email_verified_at,
         p.category_tags AS category_tags,
         p.onboarded_at AS onboarded_at
    FROM account_preferences p
    JOIN accounts a ON a.id = p.account_id
   WHERE p.digest_enabled = 1`;

@Injectable()
export class D1AccountPreferencesRepository extends AccountPreferencesRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async getByAccount(accountId: number): Promise<AccountPreferencesView> {
    const row = await this.d1
      .prepare(FIND_BY_ACCOUNT_SQL)
      .bind(accountId)
      .first<D1AccountPreferencesRow>();
    return row ? toContractPreferences(row) : unansweredAccountPreferences(accountId);
  }

  /** @inheritdoc */
  async put(
    accountId: number,
    patch: AccountPreferencesPatch,
  ): Promise<AccountPreferencesRecord> {
    // D7 validation fires BEFORE any read/write: a rejected patch never
    // creates or mutates a row.
    const channel =
      patch.channel === undefined ? undefined : validateChannel(patch.channel);
    const categoryTags =
      patch.categoryTags === undefined ? undefined : validateCategoryTags(patch.categoryTags);

    const existing = await this.d1
      .prepare(FIND_BY_ACCOUNT_SQL)
      .bind(accountId)
      .first<D1AccountPreferencesRow>();
    const current = existing ? toContractPreferences(existing) : null;

    // Sparse merge (design D2): unspecified = retained; a fresh row
    // merges onto the unanswered defaults.
    const merged = {
      channel: channel !== undefined ? channel : (current?.channel ?? null),
      categoryTags:
        categoryTags !== undefined ? categoryTags : (current?.categoryTags ?? []),
      digestEnabled:
        patch.digestEnabled !== undefined ? patch.digestEnabled : (current?.digestEnabled ?? false),
      onboardedAt:
        patch.onboardedAt !== undefined ? patch.onboardedAt : (current?.onboardedAt ?? null),
    };

    const row = await this.d1
      .prepare(UPSERT_SQL)
      .bind(
        accountId,
        merged.channel,
        JSON.stringify(merged.categoryTags),
        merged.digestEnabled ? 1 : 0,
        merged.onboardedAt === null ? null : merged.onboardedAt.toISOString(),
      )
      .first<D1AccountPreferencesRow>();
    if (!row) {
      throw new Error('account_preferences upsert .. RETURNING returned no row');
    }
    return toContractPreferences(row);
  }

  /** @inheritdoc */
  async reset(accountId: number): Promise<AccountPreferencesView> {
    const row = await this.d1
      .prepare(RESET_SQL)
      .bind(accountId)
      .first<D1AccountPreferencesRow>();
    return row ? toContractPreferences(row) : unansweredAccountPreferences(accountId);
  }

  /** @inheritdoc */
  async listDigestConsents(): Promise<readonly DigestConsentRow[]> {
    const rows = (
      await this.d1
        .prepare(LIST_DIGEST_CONSENTS_SQL)
        .all<D1DigestConsentRow>()
    ).results;
    return rows.map(toContractConsent);
  }
}

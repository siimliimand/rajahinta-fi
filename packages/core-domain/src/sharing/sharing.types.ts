/**
 * Share-snapshot types — frozen calculation-result copies behind
 * unguessable public ids (spec share-permalinks, design D6).
 *
 * A snapshot is a WRITE-ONCE copy: later changes (or the retention
 * prune) of the original record never affect it. It carries NO account
 * identifiers — assembly strips them and the strip is asserted before
 * persistence — so the public share page needs no auth and no retention
 * exception (the 12-month hygiene sweep applies anyway).
 *
 * @module SharingTypes
 */

/** Exact public-id length — base64url of 16 random bytes, unpadded. */
export const PUBLIC_ID_LENGTH = 22;

/**
 * Hygiene-sweep cap for share snapshots (design D6): 12 months. The
 * snapshot holds no personal data, so this is hygiene, not retention
 * law — the constant exists so the sweep (repository
 * `deleteOlderThan`) and every test agree on the window.
 */
export const SHARE_SNAPSHOT_RETENTION_DAYS = 365;

/** The charset of a syntactically valid public id (base64url). */
export const PUBLIC_ID_CHARSET = /^[A-Za-z0-9_-]+$/;

/** 128 bits of randomness — the entropy behind the 22-char id. */
export const PUBLIC_ID_RANDOM_BYTES = 16;

/**
 * Snapshot assembly input — the record facts the public copy carries.
 * Deliberately a CLOSED shape: there is no passthrough of raw record
 * rows, so an account column cannot ride along by accident.
 */
export interface ShareSnapshotSource {
  readonly productName: string;
  readonly productBrand: string | null;
  readonly productCategory: string;
  readonly quantity: number;
  readonly totalCents: number;
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly destination: string;
  /** The structural disclaimer object — part of every copy. */
  readonly disclaimer: unknown;
  /** The record's calculation timestamp (ISO string) — provenance. */
  readonly calculatedAt: string;
}

/** The frozen public copy as stored and rendered (JSON-safe). */
export interface ShareSnapshotPayload {
  readonly type: 'landed-cost-snapshot';
  readonly product: {
    readonly name: string;
    readonly brand: string | null;
    readonly category: string;
  };
  readonly quantity: number;
  readonly totalCents: number;
  readonly currency: 'EUR';
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly destination: string;
  readonly disclaimer: unknown;
  readonly calculatedAt: string;
}

/**
 * A personal-data field survived assembly — the pre-persistence
 * assertion refuses to store the snapshot. This is an invariant
 * violation of the no-account-identifier rule (spec share-permalinks),
 * not a validation nuance: the route fails the request rather than
 * publishing identity data under a public URL.
 */
export class PersonalDataFieldError extends Error {
  /** Dot-path of the offending key, e.g. `items[0].userId`. */
  readonly path: string;

  constructor(path: string) {
    super(
      `share snapshot contains a personal-data field at "${path}" — ` +
        'snapshots must carry no account identifiers',
    );
    this.name = 'PersonalDataFieldError';
    this.path = path;
  }
}

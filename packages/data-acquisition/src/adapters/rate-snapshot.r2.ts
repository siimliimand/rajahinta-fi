/**
 * R2-backed rate-snapshot source (task 4.4, design D6/D9) — the Workers
 * counterpart of ConfigBackedRateChangeSource: instead of reading a local
 * snapshot file, it reads the configured snapshot OBJECT from an R2
 * bucket and runs the SAME detection — SHA-256 of the content compared
 * against the hash stored on the most recent review entry.
 *
 * Parity contract (pinned by rate-snapshot.r2.test.ts against the
 * file-based implementation):
 * - same bytes → same verdict and the same `snapshot-hash:<12hex>`
 *   detected-version label;
 * - no prior review entries → new rates detected (first-check semantics);
 * - latest entry hash equal to the content hash → no change;
 * - lookup precedence pending-then-resolved, newest first;
 * - missing object / read or lookup failure → no-change (fail-safe
 *   degradation — the scheduler loop never breaks on an outage).
 *
 * The hash is computed with WebCrypto (`crypto.subtle`) — available in
 * Workers AND Node ≥ 18 — producing the identical hex digest as the
 * Node-crypto path in ConfigBackedRateChangeSource over the same UTF-8
 * bytes.
 *
 * Logging goes through an injected logger (default console) rather than
 * the Nest Logger: the Worker's @nestjs/common shim is silent, and this
 * adapter must be constructible without any Nest runtime.
 *
 * Rates are NEVER auto-published here — detection only reports; the
 * caller creates the manual-review entry.
 *
 * NOTE (worker composition): no D1-backed IRateReviewRepository exists
 * yet (the schema has no rate-review table), so the cron composes this
 * source over the in-memory repository — see
 * apps/api-worker/src/cron/tax-dataset-review.ts for the consequence.
 * The port is drop-in ready for a persistent repository.
 *
 * @module R2RateSnapshotSource
 */

import type {
  RateChangeSourcePort,
  IRateReviewRepository,
} from '../interfaces/rate-review-repository.port';
import type {
  RateReviewEntry,
  RateReviewResult,
} from '../interfaces/rate-review.types';

// ---------------------------------------------------------------------------
// Bucket contract (structural — the real R2Bucket satisfies it)
// ---------------------------------------------------------------------------

/** The one object operation the source needs (R2ObjectBody shape). */
export interface RateSnapshotObject {
  text(): Promise<string>;
}

/**
 * Read view over the snapshot bucket — structurally satisfied by a real
 * R2Bucket binding; tests pass plain objects.
 */
export interface RateSnapshotBucket {
  get(key: string): Promise<RateSnapshotObject | null>;
}

/** Minimal logging surface (Workers Logger compatible; all levels optional). */
export interface RateSnapshotLogger {
  info?(fields: { message: string }): void;
  warn?(fields: { message: string }): void;
  error?(fields: { message: string }): void;
}

/**
 * Default snapshot object key — the R2 counterpart of the file-based
 * default (config/rate-snapshot.json next to the package sources).
 */
export const DEFAULT_RATE_SNAPSHOT_OBJECT_KEY = 'config/rate-snapshot.json';

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex digest of a string's UTF-8 bytes — WebCrypto, so the same
 * code runs in Workers and Node. Byte-for-byte parity with
 * `crypto.createHash('sha256').update(content).digest('hex')`.
 */
export async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export interface R2RateSnapshotSourceOptions {
  /** Logging sink; defaults to console. */
  readonly logger?: RateSnapshotLogger;
}

/**
 * R2-backed implementation of {@link RateChangeSourcePort}.
 *
 * Reads the configured snapshot object, computes the content hash, and
 * compares it against the `contentHash` of the most recent review entry
 * (pending preferred over resolved, newest first — the ConfigBacked
 * precedence). A missing object is the fail-safe: no-change + warning,
 * exactly the documented ConfigBacked behavior for an unreadable
 * snapshot.
 */
export class R2RateSnapshotSource implements RateChangeSourcePort {
  private readonly logger: RateSnapshotLogger;

  constructor(
    private readonly bucket: RateSnapshotBucket,
    private readonly objectKey: string,
    private readonly repository: IRateReviewRepository,
    options: R2RateSnapshotSourceOptions = {},
  ) {
    this.logger = options.logger ?? console;
  }

  async checkForChanges(): Promise<RateReviewResult> {
    const checkedAt = new Date().toISOString();

    let content: string;
    try {
      const object = await this.bucket.get(this.objectKey);
      if (object === null) {
        this.logger.warn?.({
          message:
            `Rate snapshot object "${this.objectKey}" not found in the bucket — ` +
            'degrading to no-change (fail-safe)',
        });
        return { checkedAt, newRatesDetected: false };
      }
      content = await object.text();
    } catch (err) {
      this.logger.error?.({
        message:
          'Failed to read rate snapshot from R2 — degrading to no-change: ' +
          (err instanceof Error ? err.message : String(err)),
      });
      return { checkedAt, newRatesDetected: false };
    }

    const hash = await sha256Hex(content);

    // Retrieve the last-known hash from the most recent review entry
    // (may be pending — active review — or resolved and actioned).
    let lastEntry: RateReviewEntry | null;
    try {
      lastEntry = await this.getLatestEntry();
    } catch (err) {
      this.logger.error?.({
        message:
          'Failed to look up the last rate-review entry — degrading to no-change: ' +
          (err instanceof Error ? err.message : String(err)),
      });
      return { checkedAt, newRatesDetected: false };
    }
    const lastHash = lastEntry?.contentHash;

    if (lastHash === hash) {
      this.logger.info?.({
        message: 'Snapshot content unchanged — no new rates detected',
      });
      return { checkedAt, newRatesDetected: false };
    }

    this.logger.warn?.({
      message: 'Snapshot content changed — new rates detected',
    });
    return {
      checkedAt,
      newRatesDetected: true,
      reviewId: crypto.randomUUID(),
      detectedVersions: [`snapshot-hash:${hash.slice(0, 12)}`],
    };
  }

  /**
   * Most recent review entry, preferring pending over resolved. Entries
   * are ordered newest-first by the repository implementation (same
   * precedence as ConfigBackedRateChangeSource).
   */
  private async getLatestEntry(): Promise<RateReviewEntry | null> {
    const pending = await this.repository.findByStatus('pending');
    if (pending.length > 0) return pending[0];
    const resolved = await this.repository.findByStatus('resolved');
    return resolved.length > 0 ? resolved[0] : null;
  }
}

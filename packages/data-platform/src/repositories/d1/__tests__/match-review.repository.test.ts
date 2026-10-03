/**
 * D1MatchReviewRepository — real-SQLite tests (task 1.2, change
 * alko-reference-matching-pipeline) on the node:sqlite harness with the
 * committed migrations applied (0000 → 0026).
 *
 * The load-bearing cases are the matching pass's idempotency contract
 * (design D5): enqueue converges per (foreign, alko) pair — created →
 * refreshed → skipped — and decision immutability (design D2/D5): a
 * decided pair is never refreshed, never re-decided, and can never
 * re-enter the queue.
 *
 * @module D1MatchReviewRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1MatchReviewRepository } from '../match-review.repository';
import {
  MatchReviewAlreadyDecidedError,
  MatchReviewScoreRangeError,
  MissingDecisionAttributionError,
  ReferenceLinkSelfLinkError,
  type MatchReviewEnqueueInput,
} from '../../../abstracts';
import type { D1DatabaseLike } from '../../../d1/executor';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRepo(): {
  d1: D1DatabaseLike;
  repo: D1MatchReviewRepository;
} {
  const { d1 } = openMigratedD1();
  return { d1, repo: new D1MatchReviewRepository(d1) };
}

async function seedProduct(d1: D1DatabaseLike, id: number): Promise<void> {
  // match_review carries FKs to product_master on both sides — seed the parents.
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (?, 'Karhu III', 'Hartwall', 'Karhu', 'beer', 0.33, 'metal', 'beer')`,
    )
    .bind(id)
    .run();
}

/** One scored candidate, as the matching pass emits it. */
function candidate(
  overrides: Partial<MatchReviewEnqueueInput> = {},
): MatchReviewEnqueueInput {
  return {
    foreignProductId: 7,
    alkoProductId: 2,
    confidence: 'HIGH',
    matchMethod: 'fuzzy',
    score: 82,
    foreignName: 'Karhu III 0,33 l  %4.7',
    foreignBrand: 'Karhu',
    foreignAbv: 4.7,
    foreignVolume: 0.33,
    alkoName: 'Karhu III',
    alkoBrand: 'Karhu',
    alkoAbv: 4.7,
    alkoVolume: 0.33,
    ...overrides,
  };
}

describe('D1MatchReviewRepository.enqueue', () => {
  it('inserts a new pair as PENDING with both sides frozen, and reports created', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const result = await repo.enqueue(candidate());
    expect(result.outcome).toBe('created');
    expect(result.id).toBeGreaterThan(0);

    const queue = await repo.listByStatus('PENDING');
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: result.id,
      foreignProductId: 7,
      alkoProductId: 2,
      confidence: 'HIGH',
      matchMethod: 'fuzzy',
      score: 82,
      foreignName: 'Karhu III 0,33 l  %4.7',
      foreignBrand: 'Karhu',
      foreignAbv: 4.7,
      foreignVolume: 0.33,
      alkoName: 'Karhu III',
      alkoBrand: 'Karhu',
      alkoAbv: 4.7,
      alkoVolume: 0.33,
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
    });
  });

  it('re-enqueue of a PENDING pair refreshes in place: same id, new scoring, updated_at bumped, no duplicate', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const first = await repo.enqueue(candidate());
    const before = await repo.listByStatus('PENDING');
    await sleep(5); // strftime timestamps carry ms precision — make the bump observable
    const second = await repo.enqueue(
      candidate({
        confidence: 'MEDIUM',
        score: 61,
        foreignName: 'Karhu III 0. 7 l', // scrape-noise re-parse
        foreignVolume: 0.7,
      }),
    );

    expect(second.outcome).toBe('refreshed');
    expect(second.id).toBe(first.id);

    const queue = await repo.listByStatus('PENDING');
    expect(queue).toHaveLength(1); // converged, never duplicated
    expect(queue[0].confidence).toBe('MEDIUM');
    expect(queue[0].score).toBe(61);
    expect(queue[0].foreignName).toBe('Karhu III 0. 7 l');
    expect(queue[0].foreignVolume).toBe(0.7);
    expect(queue[0].status).toBe('PENDING');
    expect(queue[0].createdAt).toEqual(before[0].createdAt); // birth fields frozen
    expect(queue[0].updatedAt.getTime()).toBeGreaterThan(
      before[0].createdAt.getTime(),
    );
  });

  it('re-enqueue of a decided pair is skipped: decision untouched, fields untouched', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const { id } = await repo.enqueue(candidate());
    const decided = await repo.decide(id, 'CONFIRMED', 'ops-1');
    expect(decided?.status).toBe('CONFIRMED');

    const again = await repo.enqueue(
      candidate({ score: 99, confidence: 'EXACT', matchMethod: 'ean' }),
    );
    expect(again.outcome).toBe('skipped');
    expect(again.id).toBe(id);

    const confirmed = await repo.listByStatus('CONFIRMED');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].score).toBe(82); // the re-score never landed
    expect(confirmed[0].decidedBy).toBe('ops-1');
    expect(await repo.listByStatus('PENDING')).toEqual([]);
  });

  it('a rejected pair is equally skipped — both decisions are terminal', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const { id } = await repo.enqueue(candidate());
    await repo.decide(id, 'REJECTED', 'ops-1');

    const again = await repo.enqueue(candidate({ score: 95 }));
    expect(again.outcome).toBe('skipped');
    const rejected = await repo.listByStatus('REJECTED');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].score).toBe(82);
  });

  it('treats different pairs sharing a foreign side as distinct rows', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);
    await seedProduct(d1, 3);

    const a = await repo.enqueue(candidate({ alkoProductId: 2 }));
    const b = await repo.enqueue(candidate({ alkoProductId: 3, score: 40 }));
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.id).not.toBe(b.id);
    expect(await repo.listByStatus('PENDING')).toHaveLength(2);
  });

  it.each([-1, 101, 4.5])(
    'refuses a score outside the pinned integer 0–100 contract (%s)',
    async (bad) => {
      const { d1, repo } = makeRepo();
      await seedProduct(d1, 7);
      await seedProduct(d1, 2);

      await expect(repo.enqueue(candidate({ score: bad }))).rejects.toBeInstanceOf(
        MatchReviewScoreRangeError,
      );
      expect(await repo.listByStatus('PENDING')).toEqual([]); // nothing written
    },
  );

  it('refuses a self pair before any write', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);

    await expect(
      repo.enqueue(candidate({ foreignProductId: 7, alkoProductId: 7 })),
    ).rejects.toBeInstanceOf(ReferenceLinkSelfLinkError);
  });

  it('enqueue against an unknown product is refused by the foreign key', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7); // the Alko side stays missing

    await expect(repo.enqueue(candidate({ alkoProductId: 999 }))).rejects.toThrow(
      /FOREIGN KEY/i,
    );
  });
});

describe('D1MatchReviewRepository.listByStatus', () => {
  it('orders deterministically: score desc, then foreign_product_id asc, then alko_product_id asc', async () => {
    const { d1, repo } = makeRepo();
    for (const id of [7, 2, 5, 9, 1, 3, 4]) {
      await seedProduct(d1, id);
    }

    // Inserted deliberately out of the expected order.
    await repo.enqueue(candidate({ foreignProductId: 7, alkoProductId: 2, score: 82 }));
    await repo.enqueue(candidate({ foreignProductId: 5, alkoProductId: 9, score: 90 }));
    await repo.enqueue(candidate({ foreignProductId: 5, alkoProductId: 3, score: 82 }));
    await repo.enqueue(candidate({ foreignProductId: 5, alkoProductId: 1, score: 82 }));
    await repo.enqueue(candidate({ foreignProductId: 4, alkoProductId: 9, score: 60 }));

    const queue = await repo.listByStatus('PENDING');
    expect(queue.map((r) => [r.score, r.foreignProductId, r.alkoProductId])).toEqual([
      [90, 5, 9],
      [82, 5, 1],
      [82, 5, 3],
      [82, 7, 2],
      [60, 4, 9],
    ]);
  });

  it('returns empty for a status with no rows', async () => {
    const { repo } = makeRepo();
    expect(await repo.listByStatus('PENDING')).toEqual([]);
    expect(await repo.listByStatus('CONFIRMED')).toEqual([]);
  });
});

describe('D1MatchReviewRepository.decide', () => {
  it('moves PENDING → CONFIRMED with attribution stamped', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const { id } = await repo.enqueue(candidate());
    const decided = await repo.decide(id, 'CONFIRMED', 'ops-1');

    expect(decided).not.toBeNull();
    expect(decided!.status).toBe('CONFIRMED');
    expect(decided!.decidedBy).toBe('ops-1');
    expect(decided!.decidedAt).toBeInstanceOf(Date);
    expect(decided!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      decided!.createdAt.getTime(),
    );
    expect(await repo.listByStatus('PENDING')).toEqual([]);
    expect(await repo.listByStatus('CONFIRMED')).toHaveLength(1);
  });

  it('a second decide is a typed error carrying the current status', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const { id } = await repo.enqueue(candidate());
    await repo.decide(id, 'CONFIRMED', 'ops-1');

    await expect(repo.decide(id, 'REJECTED', 'ops-2')).rejects.toBeInstanceOf(
      MatchReviewAlreadyDecidedError,
    );
    // The original decision stands.
    const rows = await repo.listByStatus('CONFIRMED');
    expect(rows[0].decidedBy).toBe('ops-1');
  });

  it('a second decide after reject is equally refused', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const { id } = await repo.enqueue(candidate());
    await repo.decide(id, 'REJECTED', 'ops-1');

    await expect(repo.decide(id, 'CONFIRMED', 'ops-2')).rejects.toThrowError(
      MatchReviewAlreadyDecidedError,
    );
    expect(await repo.listByStatus('REJECTED')).toHaveLength(1);
    expect(await repo.listByStatus('CONFIRMED')).toEqual([]);
  });

  it('returns null for an unknown id', async () => {
    const { repo } = makeRepo();
    expect(await repo.decide(4242, 'REJECTED', 'ops-1')).toBeNull();
  });

  it('refuses a blank operator attribution before any write', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, 7);
    await seedProduct(d1, 2);

    const { id } = await repo.enqueue(candidate());
    await expect(repo.decide(id, 'CONFIRMED', '  ')).rejects.toBeInstanceOf(
      MissingDecisionAttributionError,
    );
    expect(await repo.listByStatus('PENDING')).toHaveLength(1); // untouched
  });
});

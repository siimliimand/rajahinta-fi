/**
 * D1ReferenceLinkRepository — real-SQLite tests (task 1.2, change
 * alko-reference-matching-pipeline) on the node:sqlite harness with the
 * committed migrations applied (0000 → 0026).
 *
 * The load-bearing cases: the transactional confirm (a per-side
 * live-link conflict must roll the whole promotion back and leave the
 * review row PENDING), the partial-unique conflicts surfaced as typed
 * errors, and the supersede → re-confirm path — the only legal route to
 * a replacement CONFIRMED link per side (design D1).
 *
 * @module D1ReferenceLinkRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1ReferenceLinkRepository } from '../reference-link.repository';
import { D1MatchReviewRepository } from '../match-review.repository';
import {
  MatchReviewAlreadyDecidedError,
  MissingDecisionAttributionError,
  ReferenceLinkConflictError,
  ReferenceLinkSelfLinkError,
  type MatchReviewEnqueueInput,
} from '../../../abstracts';
import type { D1DatabaseLike } from '../../../d1/executor';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRepos(): {
  d1: D1DatabaseLike;
  links: D1ReferenceLinkRepository;
  reviews: D1MatchReviewRepository;
} {
  const { d1 } = openMigratedD1();
  return {
    d1,
    links: new D1ReferenceLinkRepository(d1),
    reviews: new D1MatchReviewRepository(d1),
  };
}

async function seedProduct(d1: D1DatabaseLike, id: number): Promise<void> {
  // Both tables carry FKs to product_master on both sides — seed the parents.
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (?, 'Karhu III', 'Hartwall', 'Karhu', 'beer', 0.33, 'metal', 'beer')`,
    )
    .bind(id)
    .run();
}

/** Seed the product ids a test touches, in one go. */
async function seedProducts(d1: D1DatabaseLike, ...ids: number[]): Promise<void> {
  for (const id of ids) {
    await seedProduct(d1, id);
  }
}

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

describe('D1ReferenceLinkRepository.create', () => {
  it('creates an attributed CONFIRMED link', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 2);

    const link = await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });

    expect(link.id).toBeGreaterThan(0);
    expect(link.status).toBe('CONFIRMED');
    expect(link.foreignProductId).toBe(7);
    expect(link.alkoProductId).toBe(2);
    expect(link.confirmedBy).toBe('ops-1');
    expect(link.confirmedAt).toBeInstanceOf(Date);

    const confirmed = await links.listConfirmed();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].id).toBe(link.id);
  });

  it.each(['', '   '])(
    'refuses blank attribution before any write (%j)',
    async (blank) => {
      const { d1, links } = makeRepos();
      await seedProducts(d1, 7, 2);

      await expect(
        links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: blank }),
      ).rejects.toBeInstanceOf(MissingDecisionAttributionError);
      expect(await links.listConfirmed()).toEqual([]); // nothing written
    },
  );

  it('refuses a self pair before any write', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7);

    await expect(
      links.create({ foreignProductId: 7, alkoProductId: 7, confirmedBy: 'ops-1' }),
    ).rejects.toBeInstanceOf(ReferenceLinkSelfLinkError);
  });

  it('a second live link on the foreign side is a typed conflict', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 2, 3);

    await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    await expect(
      links.create({ foreignProductId: 7, alkoProductId: 3, confirmedBy: 'ops-1' }),
    ).rejects.toBeInstanceOf(ReferenceLinkConflictError);
    expect(await links.listConfirmed()).toHaveLength(1);
  });

  it('a second live link on the Alko side is a typed conflict', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 8, 2);

    await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    await expect(
      links.create({ foreignProductId: 8, alkoProductId: 2, confirmedBy: 'ops-1' }),
    ).rejects.toBeInstanceOf(ReferenceLinkConflictError);
    expect(await links.listConfirmed()).toHaveLength(1);
  });

  it('distinct pairs on both sides coexist', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 8, 2, 3);

    await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    await links.create({ foreignProductId: 8, alkoProductId: 3, confirmedBy: 'ops-2' });
    expect(await links.listConfirmed()).toHaveLength(2);
  });

  it('a link to an unknown product is refused by the foreign key', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7); // the Alko side stays missing

    await expect(
      links.create({ foreignProductId: 7, alkoProductId: 999, confirmedBy: 'ops-1' }),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe('D1ReferenceLinkRepository.confirm', () => {
  it('promotes a PENDING review row transactionally: attributed link + attributed review flip', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    const { id } = await reviews.enqueue(candidate());
    const decision = await links.confirm(id, 'ops-1');

    expect(decision).not.toBeNull();
    expect(decision!.link).toMatchObject({
      foreignProductId: 7,
      alkoProductId: 2,
      status: 'CONFIRMED',
      confirmedBy: 'ops-1',
    });
    expect(decision!.link.confirmedAt).toBeInstanceOf(Date);
    expect(decision!.review).toMatchObject({
      id,
      status: 'CONFIRMED',
      decidedBy: 'ops-1',
    });
    expect(decision!.review.decidedAt).toBeInstanceOf(Date);
    expect(await links.listConfirmed()).toHaveLength(1);
    expect(await reviews.listByStatus('PENDING')).toEqual([]);
  });

  it('returns null for an unknown review row', async () => {
    const { links } = makeRepos();
    expect(await links.confirm(4242, 'ops-1')).toBeNull();
  });

  it('confirm of a decided review is a typed error', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    const { id } = await reviews.enqueue(candidate());
    await reviews.decide(id, 'REJECTED', 'ops-1');

    await expect(links.confirm(id, 'ops-1')).rejects.toBeInstanceOf(
      MatchReviewAlreadyDecidedError,
    );
    expect(await links.listConfirmed()).toEqual([]); // no link appeared
  });

  it('refuses blank attribution before any write', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    const { id } = await reviews.enqueue(candidate());
    await expect(links.confirm(id, '')).rejects.toBeInstanceOf(
      MissingDecisionAttributionError,
    );
    expect(await reviews.listByStatus('PENDING')).toHaveLength(1);
    expect(await links.listConfirmed()).toEqual([]);
  });

  it('a foreign-side conflict rolls the promotion back: the review row stays PENDING', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2, 9);

    // A live link already occupies the foreign side.
    await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });

    const { id } = await reviews.enqueue(candidate({ alkoProductId: 9 }));
    await expect(links.confirm(id, 'ops-2')).rejects.toBeInstanceOf(
      ReferenceLinkConflictError,
    );

    // The batch rolled back whole: the candidate is still queueable.
    const queue = await reviews.listByStatus('PENDING');
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(id);
    expect(queue[0].status).toBe('PENDING');
    expect(queue[0].decidedBy).toBeNull();
    expect(await links.listConfirmed()).toHaveLength(1); // the pre-existing link
  });

  it('an Alko-side conflict rolls the promotion back the same way', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 8, 2);

    // A live link already occupies the Alko side.
    await links.create({ foreignProductId: 8, alkoProductId: 2, confirmedBy: 'ops-1' });

    const { id } = await reviews.enqueue(candidate({ foreignProductId: 7 }));
    await expect(links.confirm(id, 'ops-2')).rejects.toBeInstanceOf(
      ReferenceLinkConflictError,
    );

    const queue = await reviews.listByStatus('PENDING');
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('PENDING');
  });
});

describe('D1ReferenceLinkRepository.reject', () => {
  it('marks the review row REJECTED with attribution and creates no link', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    const { id } = await reviews.enqueue(candidate());
    const rejected = await links.reject(id, 'ops-1');

    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe('REJECTED');
    expect(rejected!.decidedBy).toBe('ops-1');
    expect(rejected!.decidedAt).toBeInstanceOf(Date);
    expect(await links.listConfirmed()).toEqual([]); // the D2 honesty path: no link
    expect(await reviews.listByStatus('REJECTED')).toHaveLength(1);
  });

  it('a second reject is a typed error and the first decision stands', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    const { id } = await reviews.enqueue(candidate());
    await links.reject(id, 'ops-1');

    await expect(links.reject(id, 'ops-2')).rejects.toBeInstanceOf(
      MatchReviewAlreadyDecidedError,
    );
    const rows = await reviews.listByStatus('REJECTED');
    expect(rows[0].decidedBy).toBe('ops-1');
  });

  it('returns null for an unknown review row and refuses blank attribution', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    expect(await links.reject(4242, 'ops-1')).toBeNull();

    const { id } = await reviews.enqueue(candidate());
    await expect(links.reject(id, '')).rejects.toBeInstanceOf(
      MissingDecisionAttributionError,
    );
    expect(await reviews.listByStatus('PENDING')).toHaveLength(1);
  });
});

describe('D1ReferenceLinkRepository.supersede', () => {
  it('supersedes the live link, keeps attribution history, and stamps updated_at', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 2);

    const link = await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    await sleep(5); // updated_at is stamped explicitly — make the bump observable

    const superseded = await links.supersede(link.id);
    expect(superseded).not.toBeNull();
    expect(superseded!.status).toBe('SUPERSEDED');
    expect(superseded!.confirmedBy).toBe('ops-1'); // history, not erased
    expect(superseded!.confirmedAt).toEqual(link.confirmedAt);
    expect(superseded!.updatedAt.getTime()).toBeGreaterThan(link.createdAt.getTime());
    expect(await links.listConfirmed()).toEqual([]); // no longer live
  });

  it('a superseded link cannot be superseded again — terminal-once', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 2);

    const link = await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    await links.supersede(link.id);
    expect(await links.supersede(link.id)).toBeNull();
  });

  it('supersede of an unknown id returns null', async () => {
    const { links } = makeRepos();
    expect(await links.supersede(4242)).toBeNull();
  });

  it('supersede is the only legal path to a replacement CONFIRMED link on a side', async () => {
    const { d1, links } = makeRepos();
    await seedProducts(d1, 7, 2, 3);

    const first = await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    await expect(
      links.create({ foreignProductId: 7, alkoProductId: 3, confirmedBy: 'ops-1' }),
    ).rejects.toBeInstanceOf(ReferenceLinkConflictError);

    await links.supersede(first.id);
    const replacement = await links.create({ foreignProductId: 7, alkoProductId: 3, confirmedBy: 'ops-2' });

    // The replacement is live; the superseded row coexists as history.
    const confirmed = await links.listConfirmed();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({
      id: replacement.id,
      foreignProductId: 7,
      alkoProductId: 3,
      confirmedBy: 'ops-2',
    });
    const total = await d1
      .prepare(`SELECT COUNT(*) AS n FROM product_reference_links WHERE foreign_product_id = 7`)
      .first<{ n: number }>();
    expect(total?.n).toBe(2);
  });
});

describe('D1ReferenceLinkRepository.listConfirmed', () => {
  it('orders by foreign_product_id ascending and reads only live links', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 9, 5, 2, 3, 7, 4);

    // Inserted out of id order on purpose.
    await links.create({ foreignProductId: 9, alkoProductId: 2, confirmedBy: 'ops-1' });
    const doomed = await links.create({ foreignProductId: 5, alkoProductId: 3, confirmedBy: 'ops-1' });
    await links.create({ foreignProductId: 7, alkoProductId: 4, confirmedBy: 'ops-1' });

    await links.supersede(doomed.id);
    // A rejected review row must never appear as a link.
    const { id } = await reviews.enqueue(candidate({ foreignProductId: 5, alkoProductId: 2 }));
    await reviews.decide(id, 'REJECTED', 'ops-1');

    const confirmed = await links.listConfirmed();
    expect(confirmed.map((l) => l.foreignProductId)).toEqual([7, 9]);
    expect(confirmed.every((l) => l.status === 'CONFIRMED')).toBe(true);
  });

  it('returns empty before any link exists', async () => {
    const { links } = makeRepos();
    expect(await links.listConfirmed()).toEqual([]);
  });
});

describe('supersede → re-confirm path', () => {
  it('a replacement candidate confirms once the old link is superseded', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2, 3);

    await links.create({ foreignProductId: 7, alkoProductId: 2, confirmedBy: 'ops-1' });
    const { id } = await reviews.enqueue(candidate({ alkoProductId: 3 }));

    // The promotion is blocked while the foreign side has a live link...
    await expect(links.confirm(id, 'ops-2')).rejects.toBeInstanceOf(
      ReferenceLinkConflictError,
    );

    // ...the operator supersedes the old link, and the promotion succeeds.
    const [oldLink] = await links.listConfirmed();
    await links.supersede(oldLink.id);

    const decision = await links.confirm(id, 'ops-2');
    expect(decision).not.toBeNull();
    expect(decision!.link).toMatchObject({
      foreignProductId: 7,
      alkoProductId: 3,
      status: 'CONFIRMED',
      confirmedBy: 'ops-2',
    });
    expect(decision!.review.status).toBe('CONFIRMED');

    const confirmed = await links.listConfirmed();
    expect(confirmed.map((l) => [l.foreignProductId, l.alkoProductId])).toEqual([[7, 3]]);
  });

  it('a decided review row can never be confirmed twice, even via the link path', async () => {
    const { d1, links, reviews } = makeRepos();
    await seedProducts(d1, 7, 2);

    const { id } = await reviews.enqueue(candidate());
    await links.confirm(id, 'ops-1');
    await expect(links.confirm(id, 'ops-2')).rejects.toBeInstanceOf(
      MatchReviewAlreadyDecidedError,
    );
    expect(await links.listConfirmed()).toHaveLength(1);
  });
});

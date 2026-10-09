/**
 * Journey 5 — homepage live observed-difference section
 * (homepage-live-gap-hero task 4.3).
 *
 * The homepage's hero rows are WHOLE-ROW links into the product pages
 * and the section degrades honestly. Which state renders depends on the
 * harness's data state, and the CI suite runs TWO harnesses, so — like
 * the account-export journey — this journey accepts each harness's real
 * outcome and pins the invariants that hold in every state:
 *
 *  - Populated (Workers harness: boot-workers-stack.sh applies
 *    seed-savings-snapshot.d1.sql) — the hero table lists the two
 *    fixture rows in the deterministic basis-point order, each row's
 *    link resolves to /tuotteet/{id} (the localized fi href of the
 *    /products/[id] route), and the row is ONE link (a point
 *    in the row clear of the link text still resolves to the anchor —
 *    the ::after overlay construction). The ≥44 px touch-target
 *    measurement of the same rows lives in the mobile journey.
 *  - Pending (Workers harness with E2E_SAVINGS_SNAPSHOT=0 — no snapshot
 *    day) — the pending state renders with its fi copy and the
 *    /saastolista link, and NO figure renders.
 *  - Unavailable (legacy compose harness — its backend has no savings
 *    routes, so the server read fails) — the unavailable state renders
 *    and NO figure renders.
 *
 * The how-it-works strip (task 2.3) must render BELOW the live section
 * in every state — asserted structurally (DOM order), not by pixels.
 *
 * @module HomepageFlowJourney
 */

import { test, expect } from '@playwright/test';
import { COPY, SEED, acceptAgeGate } from './helpers';

test.describe('homepage live gap hero', () => {
  test.beforeEach(async ({ page }) => {
    await acceptAgeGate(page);
  });

  test('renders its harness state honestly; the how-it-works strip follows', async ({
    page,
  }) => {
    await page.goto('/');

    const hero = page.getByTestId('home-gap-hero');
    await expect(hero).toBeVisible();
    await expect(
      hero.getByRole('heading', { name: COPY.liveGapHeading, exact: true }),
    ).toBeVisible();

    const rows = hero.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      // ── Degraded states: pending or unavailable ─────────────────────
      // Both are real outcomes (see the module doc); the section must
      // name its state and render NO figure. The poll mirrors the
      // account-export journey's either-outcome wait.
      const pending = page.getByTestId('home-gap-hero-pending');
      const unavailable = page.getByTestId('home-gap-hero-unavailable');
      await expect
        .poll(async () => {
          if ((await pending.count()) > 0) return 'pending';
          if ((await unavailable.count()) > 0) return 'unavailable';
          return 'neither';
        })
        .not.toBe('neither');

      if ((await pending.count()) > 0) {
        // Snapshot day absent/empty: the pending body names the state
        // and links the listing that does render the current state.
        await expect(
          pending.getByText(COPY.liveGapPendingBody, { exact: true }),
        ).toBeVisible();
        const listingLink = pending.getByRole('link', {
          name: COPY.liveGapPendingLink,
          exact: true,
        });
        await expect(listingLink).toBeVisible();
        await expect(listingLink).toHaveAttribute('href', '/saastolista');
      } else {
        // Failed/stale read: the unavailable body, and no /saastolista link
        // dressed up as data either.
        await expect(
          unavailable.getByText(COPY.liveGapUnavailableBody, { exact: true }),
        ).toBeVisible();
      }
      // No figures in a degraded state — no euro amount anywhere in the
      // live section.
      await expect(hero.getByText('€')).toHaveCount(0);
    } else {
      // ── Populated state (Workers harness + snapshot fixture) ────────
      // Exactly the fixture's two rows — the top-N never pads (its unit
      // suite pins that); no degraded body may coexist with figures.
      await expect(rows).toHaveCount(2);
      await expect(page.getByTestId('home-gap-hero-pending')).toHaveCount(0);
      await expect(page.getByTestId('home-gap-hero-unavailable')).toHaveCount(
        0,
      );

      // Provenance beside the figures: the as-of line.
      await expect(
        hero.getByText(COPY.liveGapAsOfPrefix, { exact: false }),
      ).toBeVisible();

      // Deterministic order (gap basis points ascending): wine first,
      // beer second — and each row's link resolves to its product page.
      const wineRow = rows.nth(0);
      const beerRow = rows.nth(1);
      await expect(wineRow).toContainText(SEED.wine.name);
      await expect(
        wineRow.getByRole('link', { name: SEED.wine.name }),
      ).toHaveAttribute('href', `/tuotteet/${SEED.savings.wineId}`);
      await expect(beerRow).toContainText(SEED.beer.name);
      await expect(
        beerRow.getByRole('link', { name: SEED.beer.name }),
      ).toHaveAttribute('href', `/tuotteet/${SEED.savings.beerId}`);

      // The row is ONE link: the anchor's ::after overlay covers the row,
      // so a point in the row clear of the link text still resolves to
      // the anchor (the full-row-link contract the touch-target journey
      // measures at phone viewports).
      const hitOutsideText = await wineRow.evaluate((row) => {
        row.scrollIntoView({ block: 'center' });
        const box = row.getBoundingClientRect();
        const el = document.elementFromPoint(
          box.right - 8,
          box.top + box.height / 2,
        );
        return el?.closest('a')?.getAttribute('href') ?? null;
      });
      expect(hitOutsideText).toBe(`/tuotteet/${SEED.savings.wineId}`);

      // Figures render in the populated state (the gap column alone
      // carries a signed euro amount).
      await expect(wineRow).toContainText('€');
    }

    // ── How-it-works strip (task 2.3) ─────────────────────────────────
    // Renders below the live section in every state — structurally, in
    // DOM order, not just visually.
    await expect(
      page.getByRole('heading', { name: COPY.howItWorksHeading, exact: true }),
    ).toBeVisible();
    const stripAfterHero = await page.evaluate(() => {
      const hero = document.querySelector('[data-testid="home-gap-hero"]');
      const strip = document
        .getElementById('home-example-heading')
        ?.closest('section');
      if (hero === null || strip === null || strip === undefined) return null;
      return (
        (hero.compareDocumentPosition(strip) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0
      );
    });
    expect(stripAfterHero).toBe(true);
  });
});

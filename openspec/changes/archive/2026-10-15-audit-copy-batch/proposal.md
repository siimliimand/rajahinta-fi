# Audit copy batch

## Why

The 2026-10-14 client audit's lower-severity findings are mostly real and all cheap. Verified against the code on 2026-10-15:

- The methodology accuracy section renders "Loading the accuracy statistic…" until user-reported outcomes exist. The publication-on-outcomes contract is deliberate and honest, but the indefinite loading state reads as a broken page — the audit read it exactly that way ("lubadus ilma sisuta").
- Enforced tool limits have no disclosure: the basket caps at 30 items (`MAX_ITEMS = 30`), comparison at 10 (`MAX_ITEMS = 10`), scenario products at 20 (`maxProducts: 20`), and the group-order session lives 7 days (server-set TTL). The audit's test user asked "miksi juuri 30?" — there is no proximity warning and no at-limit explanation or alternative affordance.
- Authority links exist in the calculator's declaration guidance panel (vero.fi/Tulli), but not near the calculation result totals where a user is effectively told "confirm with the authorities" — the audit called the result a dead-end ("dead-end ilma uustega").
- The homepage example card honestly discloses its fixed fictional figures ("Luvut ovat kuvitteellisia esimerkkiarvoja") but offers no path from the example to a real calculation.

Audit claims verified stale and NOT addressed here: newsletter placement (footer island already), decimal formats (disciplined fi-FI/en-IE chokepoint), age-gate flicker (pre-paint cookie script already), contact SLA quote (string doesn't exist).

## What Changes

- **Accuracy placeholder honesty**: until outcomes exist, the methodology accuracy section shows the publication-threshold copy instead of an indefinite loading state; the `#accuracy` anchor is preserved for existing cross-links.
- **Limit disclosure**: proximity indication before each enforced limit (e.g. 25/30 basket items) and an at-limit message explaining the limit with the applicable alternative affordance (group order for baskets, scenario share for scenario products).
- **Contextual authority links**: the vero.fi/Tulli links appear alongside the calculator result totals, reusing the declaration guidance panel's link set.
- **Example card path**: the homepage example links to `/laskuri` so the reader can run the same structure on real inputs.

## Non-goals

- Replacing the fictional example with live data (product decision; the current disclosure is honest).
- Raising any enforced limit (the group-order TTL is a server contract; basket/compare/scenario caps are deliberate).
- Newsletter placement, number formatting, age-gate behavior (audit claims stale — code already correct).

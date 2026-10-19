# Legacy URL redirect strategy

## Why

The 2026-10-14 client audit's top finding: paths from the previous site generation (`/ukk`, `/menetelma`, `/fi/ukk`, `/ota-yhteytta`, `/tietosuoja`, `/palvelut`, `/saavutettavuus`, `/hintaheratykset`, `/tilit`, `/hintahistoria`) answer the localized 404. Confirmed against the codebase: none of these routes exist anywhere in this app's git history (pickaxe over the frontend source finds nothing), and no redirect table exists in any layer (no `_redirects`, no `next.config` redirects; the middleware handles locale negotiation only) — the 404s are real.

But the audit cannot tell us whether any of these paths earn search traffic. Its own citations mix live URLs with paths that never existed here: it describes `/hintaheratykset` as "indexed with only newsletter content" while the path has no route at all, and its mangled-name examples turned out to be crawler truncations. Redirect engineering for zero-traffic paths is waste; losing genuinely ranked traffic is worse. The decision is therefore data-gated: pull Search Console data for the legacy set, map what has impressions, and document the deliberate let-die for the rest.

## What Changes

- **Data pull**: the operator exports Search Console page/query data for the legacy path set; task 1.1 processes it into an in-repo redirect map document with per-path evidence (impressions/clicks) and a mapped target from the current localized route vocabulary (`routing.ts`), plus an explicit keep/let-die recommendation per path.
- **Middleware redirect map**: an explicit legacy→canonical table applied before locale negotiation, permanent 301s, unit-tested; the map is a plain data module so additions need no route changes.
- **Localized 404 affordances**: the catch-all not-found page carries navigation affordances (site search entry, calculator and catalog links) so unmapped legacy paths land somewhere useful.

## Non-goals

- Reinstating any legacy page as content.
- Wildcard or pattern redirects (exact-path table only — predictable and auditable).
- Changing locale negotiation semantics (`routing.ts` stays authoritative for locale paths).

## Dependencies

Task 1.1 is blocked on the operator-provided Search Console export. If the export shows no impressions for the whole set, tasks 2.1–2.2 become the documented let-die (the map module ships empty with the decision recorded) — task 3.1 (404 affordances) proceeds regardless.

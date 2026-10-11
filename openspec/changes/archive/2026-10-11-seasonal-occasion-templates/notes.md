# Notes — seasonal-occasion-templates

## 4.1 Dataset publication — executed 2026-10-11 (UTC)

Owner-approved full ship: PR → merge → staging → production, dataset publication on both
environments. All gates green; no guardrail deviations on the publication itself (audited
console path used for every confirmation on both environments).

### Ship + deploys

| Step | Result |
|---|---|
| PR | [#120](https://github.com/siimliimand/rajahinta-fi/pull/120), merged **2026-10-11T05:08:47Z** as merge commit `d201c5e` (repo merge-commit convention) |
| CI on PR | all required checks green (Lint, Content policy, Build, Unit, Golden-dataset, Data-quality, Compliance, E2E, Composition smoke, Integration, D1 suite, Worker checks, Wrangler config validation, Browser E2E); `Artillery HTTP suite (Workers staging)` was `skipping` — by design, it targets staging deploys, not PRs |
| Staging deploy | run **38113848179**, 2026-10-11T05:08:50Z → 05:11:34Z, **success**: migrate (0033) → seed → deploy workers → health gate green |
| Production deploy | run **38114212134**, 2026-10-11T05:15:36Z → 05:18:06Z, **success** (gated `confirm_deploy=yes`): migrate (0033) → deploy workers → health gate green (production is never auto-seeded, per spec) |

### Migration 0033 (CHECK widening)

Applied through the pipelines on both environments (staging step "Apply D1 migrations",
production likewise). The SQLite table rebuild preserved published history verbatim:
production `consumption_norms` still held exactly 18 × `standard-drink-fi-2026.1` /
`PUBLISHED` rows immediately after the production migrate — nothing lost, nothing
re-timestamped.

### Seed self-population

- **Staging**: automatic — the deploy pipeline's seed step regenerated and applied the
  seed files (`SEED_SQL_FILES`), failing loudly on verification mismatches. After deploy,
  the pending queue showed `seasonal-occasions-fi-2026.1` with 24 `PENDING_CONFIRMATION`
  rows (ids 19–42) alongside the pre-existing 18 pending standard rows.
- **Production**: manual by doctrine (only staging auto-seeds). Applied the generated
  `consumption-norms.d1.sql` via the documented owner-directed path
  (`wrangler d1 execute DB --remote --env production --file …`). Pre-flight checks
  recorded: (a) regeneration with `db:seed:d1:generate` produced a **byte-identical**
  file (byte-determinism doctrine holds); (b) the upsert's `DO UPDATE … WHERE status =
  'PENDING_CONFIRMATION'` guard means re-applying can never rewrite a `PUBLISHED` row —
  verified post-apply: 18 standard rows still `PUBLISHED`, 24 seasonal rows landed
  `PENDING_CONFIRMATION` (ids 19–42, same numbering as staging).

### Publication (operator path: ops console, audited)

The ops console API path (option (i) in the eventcalc-reference-seed-wiring runbook) was
available and used for **every** confirmation on **both** environments — no direct-D1
publication fallback was needed, so both environments get `audit_events` entries
(entityType `consumption_norm`, action `confirmed`, author `owner-approved (agent session
2026-10-11)`). Procedure per environment: `GET /ops/console/confirmations` to list the
pending queue with per-row citations → review against the committed seed
(`consumption-norms.seed.ts`; spot-checks: juhannus beer 1.25 × 15.2 ml ÷ 4.7 % ≈ 0.40 l ✓,
vappu sparkling 0.75 × 15.2 ÷ 11.5 ≈ 0.10 l ✓, citations carry the occasion pacing basis)
→ `POST /ops/console/confirmations/consumption-norms/:id/confirm` with
`{"operator": "owner-approved (agent session 2026-10-11)", "note": …}` for ids 19–42
(24 rows), 0.3 s spacing.

- Staging (`rajahinta-api-staging.siim-liimand.workers.dev`): 24/24 confirms → 200,
  0 failures; pending queue afterwards showed only the untouched standard dataset.
- Production (`api.rajahinta.fi`): 24/24 confirms → 200, 0 failures; pending queue
  afterwards **empty**; D1 final state: 24 × `seasonal-occasions-fi-2026.1` `PUBLISHED` +
  18 × `standard-drink-fi-2026.1` `PUBLISHED`.
- Token hygiene: `OPS_BEARER_TOKEN` read inline via `"$(cat /root/.ops-token)"`; never
  echoed, logged, or persisted anywhere.

### Live verification (POST /api/v1/event-calc)

Guard chain as documented: the route is anonymous, `requireRateLimit('CALCULATOR')`
(10/min per IP) → handler; the age gate is scoped to `/api/v1/calculator`, products and
declaration routes, not event-calc (route-coverage map in `middleware/guards.ts`).
Requests spaced ≥ 8 s. All responses below were HTTP 200 with the structural
norms-are-estimates `disclaimer` field present.

| Env | eventProfile | eventDate | guests × hours | status | normsVersion | Spot math |
|---|---|---|---|---|---|---|
| staging (pre-publish) | juhannus | 2027-06-25 | 12 × 4 | `NO_PUBLISHED_NORMS` | null | calm expected state before publication ✓ |
| staging | juhannus | 2027-06-25 | 12 × 4 | `COMPUTED` | `seasonal-occasions-fi-2026.1` | beer `needLitres` 19.2 = 12×4×0.40 ✓; every line's `versionLabel` = seasonal dataset ✓ |
| staging | vappu | 2027-04-30 | 20 × 6 | `COMPUTED` | `seasonal-occasions-fi-2026.1` | sparkling 12.0 = 20×6×0.10 ✓, beer 19.2 = 20×6×0.16 ✓ |
| staging | casual_gathering | 2026-12-31 | 12 × 4 | `NO_PUBLISHED_NORMS` | null | **unchanged** — the standard dataset remains pending on staging (pre-existing state); seasonal publication did not leak into standard profiles ✓ |
| production | juhannus | 2027-06-25 | 12 × 4 | `COMPUTED` | `seasonal-occasions-fi-2026.1` | beer 19.2 ✓; line provenance all seasonal ✓ |
| production | talkoot | 2026-04-19 | 10 × 3 | `COMPUTED` | `seasonal-occasions-fi-2026.1` | beer 4.8 = 10×3×0.16 ✓ |
| production | vappu | 2027-04-30 | 20 × 6 | `COMPUTED` | `seasonal-occasions-fi-2026.1` | sparkling 12.0 ✓ |
| production | casual_gathering | 2026-12-31 | 12 × 4 | `COMPUTED` | `standard-drink-fi-2026.1` | **unchanged** — beer 15.36 = 12×4×0.32, still on the standard dataset; seasonal rows did not perturb existing profiles ✓ |

Response shape (per line): `{drinkType, needMl, needLitres, plannedUnits[], totalUnits,
purchasedMl, surplusMl, surplusLitres, versionLabel}`; top-level `normsVersion` carries
the dataset version. Note the version-aware idempotency cache keys embed the norms
version, so pre-publication `NO_PUBLISHED_NORMS` states cannot be served stale after
publication (that path is not cached by design).

## Seasonal-guide content follow-ups (operator content acts, not code)

Guides-hub machinery exists (create/edit GUIDE drafts via
`POST /ops/console/blog/guides`). These are the owner's editorial follow-ups, recorded
here so 5.1 / campaign planning can track them:

- [ ] **Vappu guide post** (guides-hub, FI + EN): May Day street celebration — sparkling
  wine + sima-tradition pacing, the `/event?occasion=vappu` deep link, budget tips for
  student budgets. Target publish window: early April 2027.
- [ ] **Juhannus guide post** (guides-hub, FI + EN): midsummer grilling day away from
  retail hours — beer-led pacing, midsummer eve Friday 2027-06-25, the
  `/event?occasion=juhannus` deep link, midsummer retail-hours warning. Target: early
  June 2027.
- [ ] **Rapujuhlat guide post** (guides-hub): crayfish-party season (July–August) —
  spirits/snaps tradition pacing, table-heavy format, the
  `/event?occasion=rapujuhlat` deep link. Target: late June 2027 (before the season).
- [ ] **Talkoot guide post** (guides-hub): communal work-bee refreshment norms — modest
  beer/sim adjacent pacing, the `/event?occasion=talkoot` deep link. Target: spring
  2027 work-season start.
- [ ] Campaign checklist — **vappu 2027-04-30**: guide post live → verify deep link
  renders templates → spot-check event-calc answers on the day → social/newsletter
  push with `?occasion=vappu`.
- [ ] Campaign checklist — **juhannus 2027-06-25**: same cadence with
  `?occasion=juhannus`; include the retail-hours caveat (midsummer eve Friday — most
  Alko stores close early/last full day is Thu 2027-06-24; verify against that year's
  announced hours before publishing).

## Deviations / risks

- None on gates or publication. The only doctrine nuance: production **seeding** (not
  publication) used the sanctioned owner-directed direct-D1 path because production
  is never auto-seeded by the pipeline (spec: staging-only seed). History preservation
  was verified before and after; publication itself went through the audited console
  on both environments.
- Staging's standard dataset (`standard-drink-fi-2026.1`, 18 rows) remains
  `PENDING_CONFIRMATION` — pre-existing state, out of scope for this change.

## 5.1 Full verification — executed 2026-10-11 (UTC)

Full matrix on `master` at `ee31ec7` (post-PR-#120 integration state, pulled first),
Node 24.21.0 via the repo's pnpm scripts (shell-default Node 22 lacks FTS5). Every
command exited 0; no suite skipped or weakened.

### Gates

| Gate | Command | Result |
|---|---|---|
| core-domain rebuild (convention) | `pnpm --filter @rajahinta/core-domain build` | exit 0 |
| Typecheck (all workspaces) | `pnpm typecheck` | exit 0, 0 `error TS` |
| Lint | `pnpm lint` (`eslint .`) | exit 0, clean |
| Content lint (FI/EN + content-policy) | `pnpm lint:content` | exit 0, clean |
| Unit suites (all 8 workspaces) | `pnpm test` | exit 0 — **7,069 passed / 3 skipped** (pre-existing skips) across 447 files |
| D1 integration (node:sqlite harness) | `pnpm test:d1` | exit 0 — **190 passed** (19 files) |
| Compliance (`COMPLIANCE_ENFORCED`) | `pnpm test:compliance` | exit 0 — **248 passed** (23 files), incl. `group-order-accounting-only` (3.2) |
| Golden dataset | `pnpm test:golden` | exit 0 — "Golden-dataset tests PASSED" |

Unit per-workspace: frontend 1,538 · core-domain 1,722 · api-worker 1,352 ·
data-platform 924 · data-acquisition 649 · application-api 745 (+3 skipped) ·
email-worker 120 · backend 19.

### Deep-link + handoff journey (component-level evidence)

Focused verbose run over the event + group-order surfaces —
`vitest run` on `event/page.test.tsx`, `event/templates.test.tsx`,
`event/estimate-handoff.test.ts`, `group-order/page.test.tsx`,
`group-order/[token]/page.test.tsx`: **5 files, 59/59 passed**. Key named assertions:

- **2.2 deep link** — "?occasion= deep link": *applies the deep-linked template exactly
  as if selected by hand* ✓; *renders the default state silently for an unknown slug —
  no error surface* (the `?occasion=nonsense` contract) ✓; absent param → default state ✓.
- **2.1 templates** — four seasonal occasion chips render; applying fills guests,
  duration, and the seasonal profile; inputs stay editable and the estimate derives
  from the edited values; seasonal profile submits through to the estimate ✓.
- **3.1 handoff** — `estimateHandoffItems` reduces a COMPUTED estimate to one
  name+quantity row per purchasable line (drops nothing-to-buy, carries nothing for
  `NO_PUBLISHED_NORMS`); group-order create-view populates prefill rows as ordinary
  editable/removable/extendable rows; creation transmits nothing extra vs. no-prefill ✓.
- **3.2 accounting-only** — compliance suite green (above); group-order surface asserts
  the API payment-field rejection verbatim with the named field ✓.

No Playwright journey exists for the event/group-order flows (the e2e-browser
`calculator-flow` specs cover the landed-cost calculator, not this surface), so
component-level evidence is the journey record per the task's allowance. Staging and
production live behavior (deep-linked profiles answering `COMPUTED` on the seasonal
dataset) is evidenced in the **4.1 live-verification table above** — referenced, not
duplicated.

### Campaign checklist confirmation

The **vappu 2027-04-30** and **juhannus 2027-06-25** campaign checklists are present in
the "Seasonal-guide content follow-ups" section above (guide post live → deep link
renders templates → day-of event-calc spot-check → push with `?occasion=`), the juhannus
one carrying the midsummer-eve retail-hours caveat. Together with the four guide-post
follow-ups they remain the owner's editorial track — intentionally unchecked here.

### Verdict

All gates green, journey verified end-to-end at component level, publication state live
on both environments (4.1). Change `seasonal-occasion-templates` verification complete;
no blockers.

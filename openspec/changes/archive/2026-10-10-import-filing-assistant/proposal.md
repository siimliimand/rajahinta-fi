# Proposal: import-filing-assistant

## Why

The MyTax advance-notice assistant pitch overvalues what is new: the
applicability question and the pre-commit costing are already built (verified
against the repo 2026-10-07). `TransactionClassificationService` already
classifies the self-arranged-shipping case as Distance Buying ("Buyer arranged
transport via independent carrier") with advance-notice and liability flags,
and the landed-cost calculator already produces the excise and container-duty
figures with the display-only Alko benchmark.

What the site does not cover is the filing window between order and dispatch —
exactly where the user is most anxious and least served:

- `ExciseDeclarationService` computes the advance-notice requirement, the
  due-date logic, and an ordered MyTax entry checklist, but never mentions the
  guarantee to lodge: "guarantee" appears in the module only as the
  no-submission code guarantee. A guarantee (vakuus) amount is computed
  nowhere in the workspace.
- The checklist carries no packaging-notice step (zero matches for
  packaging/pakkaus in `packages/core-domain/src/declaration/`), no
  reference-number-to-carrier step, and no dated countdown — the deadline is
  derived from classification, not anchored to a dispatch date the user
  actually plans around.
- Calculation records are age-capped at 180 days and hold no filing state, so
  the "keeps your records straight" value cannot ride existing storage.
- Four load-bearing facts in the pitch are unverified against official
  sources: the guarantee rule, the two-notice claim, the reference-number
  lifecycle, and penalty mechanics. The repo's credibility convention
  (verbatim citations, versioned datasets, manual publish gates) does not
  permit shipping them unchecked.

## What Changes

**Stage 0 — domain-verification spike (gate).** Verify the four facts against
vero.fi with verbatim citations recorded in `change-notes.md`:

1. The guarantee rule for private advance taxation — is the security the
   calculated tax amount itself, or a separate schedule?
2. The notice structure — must alcohol excise and beverage-packaging duty be
   filed as separate notices for private imports?
3. The reference-number lifecycle — issued at which step, passed to the
   carrier at which point?
4. Penalty mechanics for a missed or late filing.

Each finding branches the design: guarantee-as-calculated-tax → pure
function; guarantee-schedule → versioned dataset behind the existing manual
publish gate. Two-notice claim unverified → single-notice checklist with
citation. Findings are decisions, not assumptions.

**Stage 1 — dated filing guidance (this change's implementation).** Extend
the existing read-only declaration guidance:

- Guarantee figure computed in core-domain, reliability-status-carrying, no
  plausible fallback (the `FALLBACK`/`ESTIMATED` precedent).
- Dated pre-dispatch checklist in `ExciseDeclarationService`: order → notices
  → guarantee → reference number to carrier, anchored to a user-supplied
  dispatch date, deadline semantics "before dispatch", `ESTIMATED` status on
  the date-derived figures, and a post-deadline state phrased in the
  observed-pattern register ("deadline has passed; verify your obligations
  with official sources") — never an uncited penalty assertion.
- Additive guidance-endpoint fields accepting an optional dispatch date;
  absent date degrades to the undated checklist.
- `DeclarationGuidancePanel` on the calculator result gains the dispatch-date
  input, dated checklist, guarantee line, and reference-number step (fi/en).
- A GUIDE-kind post drafted from the verified facts for ops-console
  publication, cross-linked from the panel and `/guides`.

Stage 1 remains fully read-only: no submission to MyTax, no new persistence —
the dispatch date lives in the request, never in a table.

## Risks

- **Process drift.** Rate changes are detected by the daily review job;
  process changes (notice structure, reference-number handling) are not
  detected by anything. Mitigation: verbatim citations in code, an owner
  review calendar entry, and no process-dataset machinery until demand
  justifies it.
- **Verification may invalidate a checklist step.** Mitigation: honest
  degraded-state rendering — a step whose fact is unverified renders nothing,
  per the reliability vocabulary.
- **Legal-advice drift.** Deadline and penalty language can drift into
  binding-sounding claims. Mitigation: the observed-pattern phrasing register
  enforced by the declaration safety suite, plus a recorded legal-review
  delta for the written-opinion holder.

## Capabilities

### New

- `import-filing-assistant`: guarantee figure, dated pre-dispatch checklist,
  reference-number step, phrasing register, honest degraded states, and the
  unchanged read-only no-submission guarantee.

### Amended

- `web-application`: dispatch-date input and dated-checklist rendering on the
  declaration guidance panel with honest empty states, fi/en parity.

## Out of Scope (gated follow-up changes)

- **`import-filing-tracker`** — per-order filing records (reference numbers,
  guarantee payments, order dates). Contingent on: Stage-0 findings, a
  Stage-1 usage signal, and the owner's custody decision between the
  dossier-first option (exportable JSON/PDF, no new server-side custody) and
  server-side records with a short retention cap. Design decision recorded
  now so the follow-up inherits it: a filing snapshots its inputs at creation
  (`shareSnapshots` frozen-copy precedent), because calculation records
  age-cap at 180 days and would leave filings dangling.
- **`filing-reminders`** — dispatch-date countdown emails. Would reuse the
  notification intent-log + cooldown pattern and a filing-anchored cron
  (Europe/Helsinki), not a fifth price-alert kind. Only viable if
  server-side custody (option B) is accepted, since reminders need a stored
  dispatch date.
- Any entitlement or tier change: guidance stays free; tracker and reminders
  are the future premium-tier seam (`FEATURE_TIER_MAP`), designed but not
  activated.

## Sequencing Notes

Independent of the in-progress changes (`onboard-araxes-merchant`,
`nonalcoholic-catalog-hygiene`). Stage 2/3 work items must not be scheduled
until their gates resolve: verified facts (task 1.1), a Stage-1 usage signal,
and the owner custody decision.

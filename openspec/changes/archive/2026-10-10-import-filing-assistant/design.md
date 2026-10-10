# Design: import-filing-assistant

## Context

The declaration module already answers "does this apply to me" and "what does
MyTax entry look like" from the persisted classification and calculation
record, read-only. The uncovered slice is temporal (a dated walkthrough around
the user's dispatch date) and quantitative (the guarantee figure). Four
load-bearing process facts are unverified; the repo's citation conventions do
not allow building them in unchecked. Stage 1 must therefore be able to ship
degraded rather than wrong.

## Goals

- The user leaving the calculator result knows: what to lodge as guarantee,
  what to file before dispatch and in which order, and which reference number
  goes to the carrier — each figure and step traceable to a cited source.
- No new persistence, no submission path, no new cron.
- Every unverified or absent fact degrades to an honest empty state instead of
  a plausible sentence.

## Non-goals

- No server-side filing records, no reminders, no dossier export (gated
  follow-up changes).
- No stretch of the price-alert kind taxonomy.
- No entitlement changes; guidance stays free.
- No change to the structural disclaimer or the single-render rule.

## Decisions

### D1: Staged delivery with explicit gates

This change implements Stage 0 (verification spike) and Stage 1 (dated
guidance) only. Stage 2 (tracker) and Stage 3 (reminders) exist as named
follow-up changes in the proposal and become schedulable only when their
gates resolve: verified facts (task 1.1), a Stage-1 usage signal, and the
owner custody decision.

### D2: Stage 1 stays read-only

The dispatch date is a request parameter, never a column. The no-submission
runtime guarantee (`excise-declaration.service.ts`) is unchanged and stays
attached to every service result. This preserves the data-minimization
invariant: no new sensitive data class is introduced by this change.

### D3: Guarantee computation branches on task 1.1

If the verified rule is "security equals the calculated tax", the guarantee
figure is a pure function over the existing excise + container-duty results
(`packages/core-domain/src/declaration/`), carrying the underlying
reliability status. If the rule is a separate schedule, the schedule is a
versioned dataset with effective windows behind the existing manual publish
gate (the `travellerAllowanceDatasets` precedent). Either way: no plausible
fallback — a missing rule yields an unavailable figure, never a substituted
number.

### D4: Deadline semantics

The obligation is tied to dispatch (post-reform, per the existing guidance
logic). The user supplies the planned dispatch date; the checklist orders
steps backward from it and marks date-derived figures `ESTIMATED`. When the
supplied date is in the past relative to the filing state, the panel renders
the post-deadline state: "deadline has passed; verify your obligations with
official sources" plus the citation — never a penalty assertion beyond what
task 1.1 cited.

### D5: Phrasing register

All new strings follow the observed-pattern register the declaration safety
suite already enforces: described as observed patterns and cited facts, not
advice or legal consequence. The safety suite gains cases for every new
string family (checklist steps, guarantee line, post-deadline state).

### D6: Process-knowledge maintenance

Process facts are cited inline (verbatim quote plus URL in
`change-notes.md`, citation reference in code) and carried by an owner review
calendar entry. A versioned process dataset (the rates treatment) is
deliberately not built until the tracker change justifies the machinery. The
GUIDE-kind post is drafted in this change and published through the existing
ops console flow — publication stays a human operator action.

### D7: Filing entity (future, recorded now)

The Stage-2 filing snapshots its inputs at creation — classification label,
figures, rate-version labels — rather than referencing the live calculation
record, which age-caps at 180 days. This is the `shareSnapshots`
frozen-copy precedent (strip/assert at assembly). Recorded here so the
follow-up change inherits the decision.

### D8: Reminders (future, recorded now)

Deadline reminders anchor to filings, not products: a filing-anchored cron
scan (Europe/Helsinki, error-isolated) writing notification intent rows
before send and marking outcomes after — the newsletter intent-log pattern.
They do not extend the price-alert kind closed set. Reminders require a
stored dispatch date, hence server-side custody (option B), which only the
owner can accept; the dossier-first option delivers the records value with
near-zero custody.

## Contingency branches (resolved by task 1.1)

| Fact             | If verified as X                        | If verified as Y                                    |
| ---------------- | --------------------------------------- | --------------------------------------------------- |
| Guarantee        | = calculated tax → pure function (D3a)  | separate schedule → versioned dataset (D3b)         |
| Notices          | two filings → checklist shows both, cited | single filing → single-notice checklist, cited; pitch corrected in guide copy |
| Reference number | issued at filing → captured at that step | issued later → step shows the verified point        |
| Penalties        | cited mechanics → post-deadline copy may name them | unclear → copy stays at "verify with official sources" |

## Migration / rollout

No schema migration. Additive DTO fields only; unknown/absent dispatch date
and unverified facts degrade to existing behavior. Frontend renders nothing
new until the corresponding API field is present.

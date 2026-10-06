# Design

## Context

All UI copy lives in two message catalogs — `apps/frontend/src/messages/fi.json` and `en.json` (1868 lines each, mirrored keys). The ranking methodology layers render frontend-only from the catalogs (`ranking-view.tsx`); the API serves structure, not Finnish. Several pinned tests assert exact strings. The archived `fi-locale-surface-hardening` change (2026-10-05) established the precedent of deliberate pinned-test updates and rendering-only unit presentation with byte-identity verification of computed figures. The `content-vocabulary-linting` capability bans promotional adjectives — new copy must pass it.

## Goals / Non-Goals

**Goals:**

- One canonical term per concept, enforced by a permanent glossary doc.
- Native consumer register on all Finnish surfaces; legal/informational intent preserved verbatim.
- Fix the value-table header/cell unit contradiction (rendering-only).
- Bring ranking transparency copy into full compliance with `ranking-sorting` "Documentable logic".

**Non-Goals:**

- No API/wire changes, no computation changes (€/g stays the computed and transported unit).
- No retranslation of `en.json` wholesale — EN gets targeted fixes only.
- No restructuring of pages, keys, or components beyond the unit-chip explanation surface.
- No colloquial term variants (e.g. *tuliaisrajat*) — one canonical term per concept.

## Decisions

### D1: Glossary lives in `docs/fi-copy-glossary.md`

JSON catalogs cannot carry comments; the glossary needs a reviewable home outside code. The change's proposal records the decisions; the doc is the living source of truth for future copy.

### D2: Canonical terms (user-confirmed 2026-10-06)

| Concept | Canonical FI | Replaces | Rationale |
|---|---|---|---|
| Drink demand | `juomatarve` | `juonetarve` | Site already uses *juomat*; compound parses correctly |
| Basket feature | `Ostoskorilaskuri` | `Ostoskorioptimointori` | Parallels *Matkalaskuri* / *Tilaisuuslaskuri* naming family |
| Ranking page | `Miten järjestys muodostuu` (title), `Järjestysperiaatteet` (nav slot) | `Miten järjestäminen toimii` | *Järjestys* = order of a list; *järjestäminen* = organizing an event |
| Allowance limits | `tullivapaat määrät` / `tullivapaa määrä` | `tullimäärärajat` | Tulli's official phrasing; already on `/allowances`; one term everywhere |
| Ethanol unit price | `etanolin grammahinta` (display unit `snt/g`) | `Etanoli-€/g`, `€/g-arvo` prose | One unit everywhere; analog of the standard *litrahinta* |
| Price sort | `halvin ensin` | `matalin ensin` | Natural price phrasing |
| Daily snapshot | `päivittäin päivitetty aineisto` | `materialisoitu tilannekuva` | Consumer register; *materialisoitu* is DB jargon |
| Informational framing | `vain tiedoksi` | `tiedollinen` | Rare administrative word; *— ei neuvontaa* disclaimers stay |

### D3: Register rule for the ranking page

Lead with the consumer sentence (already present: *"Sama aineisto tuottaa aina saman järjestyksen"*), then the mechanism in plain-but-precise Finnish: *"Laskenta näkee vain välttämättömän tiedon — kenttää maksulliselle sijoittelua varten ei ole olemassa"*; the three enforcement layers keep their checkable claims (bounded input, test-pinned shape, unknown-field rejection) but lose the engineering nouns (`Rajattu syöte`, `Testeillä lukittu muoto`, `Odottamattoman tiedon hylkäys`) and the `Deterministinen: Kyllä` badge (the fact is stated in prose). The `enforcementP1/P2`, layer, and tiebreaker keys all rewrite; no key is added or removed.

### D4: EN asymmetry is deliberate

EN methodology copy keeps *deterministic*, *bounded input*, etc. — spec-register language is conventional on English methodology pages. EN receives: unit unification (language-independent bug), terminology parity (e.g. one term for allowance limits), and fixes for the wrong-word equivalents. The glossary records this asymmetry so future edits don't "fix" it by mirroring.

### D5: Unit display renders the computed value verbatim

*Corrected during apply (wave 2):* the pure function already computes **cents per gram** — `centsPerGram = priceCents / ethanolGrams` (`packages/core-domain/src/unitprice/eur-per-gram.ts:157`) — so `snt/g` presentation renders the computed value verbatim. There is no conversion and none is introduced; the value-page header bug was label-only. The explore session's ×100-rendering assumption was wrong. (Pre-existing, out of scope: the base spec's *Price per gram of pure ethanol* requirement says "euro per gram" while the code computes cents — worth a future spec-hygiene pass.) Compliance: every rendered `snt/g` figure equals the API `centsPerGram` value exactly.

## Risks / Trade-offs

- **SEO**: metaTitles change (`Tilaisuuslaskuri: juomatarve ja ostoslista`, value page). The current metaTitles contain malformed Finnish — fixing them improves what searchers see; short-term SERP churn accepted.
- **Pinned tests**: ~9 test files assert exact copy; updates are deliberate and enumerated in tasks.
- **Legal doc sync**: `docs/legal-briefing-package.md:218` quotes the old ranking page title; task 4.1 updates the reference in the same commit.
- **Vocabulary lint**: replacements like *halvin ensin* are factual/comparative, not promotional; task 6.1 runs the content-vocabulary lint over the new copy to prove it.
- **Serialization**: most tasks touch the shared catalogs, so `ob-plan-apply` runs them mostly sequentially via `touches` — inherent to a copy change; glossary-first ordering keeps every wave consistent.

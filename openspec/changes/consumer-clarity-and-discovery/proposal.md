# Proposal: consumer-clarity-and-discovery

## Why

Five verified consumer-experience gaps share one root pattern: the pipeline
and engine layers are Finnish-first and honest, but the last mile — the
strings, the hierarchy, the entry points — leaks internal English, buries the
decision-relevant number, or hides finished features. Verified 2026-10-04
against the repo:

1. **What-if shows an English legal disclaimer to Finnish users.**
   `calculateWhatIfExcise` hardcodes `WHATIF_DISCLAIMER_EN`
   (`packages/core-domain/src/whatif/whatif.ts:88`); `WHATIF_DISCLAIMER_FI`
   exists, is exported, is content-tested — and is called by nothing. The
   route passes no locale, the frontend renders the disclaimer verbatim by
   pinned contract ("rendered as returned, never a UI-only string"), so the
   fix cannot be UI-side. `event-calc` pins `language: 'fi'`; what-if pinning
   `'en'` is the inconsistent twin.
2. **Finnish search dies on brand typos and category words.** Zero-result
   did-you-mean exists and works (`koskenkrova` → "Koskenkorva" is a pinned
   test), but `suggestBrand` compares only against `SELECT DISTINCT brand`.
   `votka` → no brand within edit distance 2 → dead end with no suggestion.
   The curated synonym map covers category recall for exact words
   (`vodka`↔`viina`) but not misspellings of them, by deliberate design D5
   ("brand-level misspellings are did-you-mean territory").
3. **The calculator leads the Tallinn-ferry user with the wrong number.**
   The buying-mode fork already exists ("Toimitus" default / "Otan itse
   mukaan", task 2.1 of finnish-first-client-experience), but a delivery-mode
   result renders the stacked carrier total (€379.66-class) as the hero with
   a LOW confidence badge and demotes the traveller allowance figure
   (€107.94-class) to a callout far below. Both numbers are legally correct
   for their transaction types; the presentation answers the wrong question
   for the dominant persona. The card also renders raw English API strings:
   `classification` ("DistanceBuying via carrier: alks (DE→FI)") and
   `evidenceSummary` go to the page untranslated.
4. **Group-order is an orphan.** The full feature (shared 7-day session,
   nicknames, cost splitting) has zero nav/footer links, is absent from the
   sitemap, and robots disallows all of `/group-order` — broader than
   necessary: token *sessions* merit exclusion, the *create page* does not.
   The spec still carries a `enable_group_order_ledger` feature-gating
   requirement; the flag system left the repo on 2026-09-07 and the code has
   no flag — the spec is stale, not the code.
5. **The allowances table is legally careful but consumer-hostile.** Every
   category row repeats a ~300-character English EUR-Lex citation inline on
   a Finnish page (currently spec-pinned as "rendered verbatim" per row),
   and the volume-only caps force can/bottle math onto the reader.

## What Changes

- **What-if disclaimer language (① fix 2):** the scenario input gains an
  optional `language` (`'fi' | 'en'`, default `'fi'`); the pure module selects
  from the existing versioned FI/EN constant pair — no new wording. The route
  accepts it, the client sends it from `[locale]`, and the embed route derives
  it from its own locale segment. The disclaimer still travels on every 200.
- **Search suggestion vocabulary (① fix 1):** the zero-result suggestion
  compares against the union of brand tokens, distinct product-name tokens,
  and curated synonym-group members. Bound (≤ 2), diacritic folding,
  (distance, alphabetical) ordering, zero-result-only firing, and the
  advisory 0+chip contract all stand; D5 ("suggestion, not auto-correct")
  is untouched — no fuzzy result matching.
- **Calculator result hierarchy (① fix 3):** display-layer only. The
  traveller alternative is promoted from a below-fold callout to a co-equal
  labeled block beside the hero for delivery-mode results; amounts stay
  byte-identical. The classification label localizes via the existing enum
  and evidence localizes via an additive machine-readable `code` on
  `EvidenceDetail` — the frontend composes locale prose; core-domain stays
  locale-free; `evidenceSummary` remains unchanged on the wire. Buying-mode
  copy states the price fork plainly.
- **Group-order launch (① fix 4):** footer link, sitemap entry, robots
  narrowed to token subpaths (`/group-order/*`), create page crawlable. The
  stale feature-gating requirement is removed from the spec. Header nav
  deliberately stays closed (curated 9-item desktop / 4-item mobile set).
- **Allowances citation hierarchy (① fix 5):** per-category Finnish summary
  lines; verbatim citations move into an expandable evidence disclosure —
  stored text unmodified, evidence link preserved, dataset citation still
  verbatim. Static container-equivalent helper lines (e.g. 10 l ≈ 20 ×
  0,5 l) render as display-only math with lint-safe phrasing.

## Non-goals

- No fuzzy auto-correcting search: a misspelled query still returns zero
  results plus an advisory suggestion; nothing is applied implicitly.
- No engine math changes anywhere: every monetary figure this change touches
  stays byte-identical (display-layer moves only), pinned by the existing
  compliance suites.
- No catalog data enrichment (e.g. `sahti` products) — that is a data-acquisition
  follow-up, not a code change; `sahti` may still return zero results.
- No header-nav entry for group-order and no sitemap/robots change for token
  session pages (they stay non-indexable).

## Decision log (explore, 2026-10-04)

- One combined change (owner choice), five separate ones rejected.
- Search: strengthen did-you-mean, keep 0+chip (owner choice).
- Calculator: scenario switcher direction, refined to result-card hierarchy
  after code review showed the switcher already exists (explore finding).
- Group-order: launch (owner choice).
- Disclaimer default language: `fi` (proposer decision — event-calc
  precedent, Finnish-first product; `en` on explicit request).

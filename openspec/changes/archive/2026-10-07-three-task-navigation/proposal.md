# Proposal: three-task-navigation

## Why

The layout header offers nine parallel destinations, five of which are
near-duplicates: calculator, compare, basket, and scenario (what-if) are
one tax/transport engine wearing different input forms, and trip/event
already wrap the basket optimizer. The nav speaks system vocabulary
(Laskuri, Vertailu, Ostoskori, Skenaariolaskuri) while visitors think in
tasks ("is this bottle worth it?", "I'm going to Tallinn", "I'm hosting
a party"). The homepage tells a third story (four task cards: basket,
trip, event, what-if) and the footer a fourth (the full tool sitemap).
Meanwhile `/savings` — the factual answer to "what is worth buying" —
and `/value` are built surfaces reachable from nowhere in the header,
and the header's "Miten järjestäminen toimii" link duplicates the
footer's methodology link.

## What Changes

- Header collapses to three task disclosure groups, reusing the
  existing tested Planning-dropdown pattern (parameterized, not
  rewritten):
  - **Mitä kannattaa ostaa?** — savings (lead), value, products,
    calculator, compare
  - **Suunnittele matka** — trip (lead), basket, allowances
  - **Suunnittele juhlat** — event (lead), basket
- Skenaariolaskuri and "Miten järjestäminen toimii" leave the header.
  The ranking link is removed outright (footer already carries the
  duplicate); Skenaariolaskuri is added to the footer's Tietoa column —
  it is a tax-transparency tool, not a shopping tool.
- No route changes: every URL, share permalink, and the sitemap stay
  as-is. The footer keeps the complete tool sitemap, so demotion
  removes no reachability.
- Homepage task cards mirror the same three paths; the savings card
  keeps its pending/unavailable state variants and the what-if card is
  removed.
- Compliance guardrail: the shopping path is a question answered by
  factual gap lists — no merchant ranking or recommendation framing may
  appear beneath it (legal-briefing wording rules; content-policy lint).

Sequencing note: `homepage-live-gap-hero` (pending) modifies the hero
slot of the same homepage file; the task annotations serialize the two.

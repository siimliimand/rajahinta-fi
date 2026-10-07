# Design: three-task-navigation

## Context

`SiteHeader.tsx` renders nine destinations from a flat `NAV_ITEMS`
array. Desktop hides trip/event/what-if behind one hardcoded
"Suunnittelu" disclosure; mobile shows all nine flat. The footer
already renders the complete tool sitemap (Palvelut column) plus
methodology/blog/guides/about (Tietoa column), so every route stays
reachable regardless of the header. The homepage task cards prototype
task framing with four cards. The disclosure pattern (button trigger,
`aria-expanded`, ArrowUp/Down cycling, Escape and tab-out close,
active-state propagation from child routes) exists once, tested, in
`SiteHeader.tsx`.

## Decisions

### D1: Header = tasks, footer = sitemap

The header carries the three task groups; the footer remains the
complete sitemap. Demoting items from the header is therefore a no-op
for reachability — verified against `SiteFooter.tsx`, whose Palvelut
column already links calculator, compare, basket, trip, event,
group-order, and value.

### D2: Reuse the disclosure pattern, parameterized

The tested Planning dropdown becomes a reusable group component
instantiated three times. Rewriting the interaction (or switching to a
hover mega-menu) was rejected: the current pattern already handles
keyboard operation, focus visibility, tab-out, and active propagation,
and its tests encode those guarantees.

### D3: No route changes

All seven tool routes keep their URLs. No redirects, no sitemap churn,
share permalinks untouched, per-page metadata untouched. Route
consolidation (merging calculator/compare, trip/event) was rejected for
this change: it multiplies blast radius (redirects, eight e2e journeys,
compliance suites) for a fraction of the user-facing benefit.

### D4: Strict two-level vocabulary

Group triggers speak task language ("Mitä kannattaa ostaa?",
"Suunnittele matka", "Suunnittele juhlat"); panel items keep tool names
("Säästölista", "Matkalaskuri", …). The two-level structure is the IA
fix — mixing tool names into trigger labels would recreate the
system-vocabulary problem one level up.

### D5: Ostoskori lives in panels 2 and 3 only

Generic basket building without a trip or event is a step inside the
planners, not a standalone task; it stays reachable via the footer and
the planners. Adding it to panel 1 was rejected: appearing in all three
panels re-creates the pseudo-destination this change removes.

### D6: Skenaariolaskuri joins the footer Tietoa column

It simulates duty-rate changes — policy transparency, not shopping —
so it sits next to methodology rather than inside any task panel.
Today it exists only in the header and a homepage card; without this
addition it would become footer-unreachable.

### D7: Neutrality guardrail on the shopping label

"Mitä kannattaa ostaa?" survives only while everything beneath it is a
factual gap list: category price gaps, never merchant rankings,
editor picks, or recommendation labels (legal-briefing wording rules).
The constraint travels with the message-catalog copy so the
content-policy lint guards it; if any future surface wants editorial
framing, the label must change first.

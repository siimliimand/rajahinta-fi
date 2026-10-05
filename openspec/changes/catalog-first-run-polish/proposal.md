# Proposal: catalog-first-run-polish

## Why

The 2026-10-04 walkthrough documented first-run friction on the two
surfaces every visitor touches — the catalog and the calculator:

1. The catalog's absent-sort default is `LOWEST_PRICE` (deliberate
   `first-impression-pass` decision). With today's 9,494-product catalog
   — dominated at the cheap end by €0.49 German 2-cl mini bottles (St.
   Hubertus, Kleiner Klopfer, Ficken) — that decision's premise ("the
   listing leads with the lowest observed prices") now fronts a wall of
   miniatures as the site's face. The premise changed; the default needs
   re-evaluation, not blind retention.
2. The calculator search dropdown shows only the absolute
   "Halvin havaittu hinta", so a €105.50 10-pack sits beside a €9.99
   single with nothing normalizing them — even though the listing API
   already computes the €/g embed for every row.
3. On mobile, tapping "Laske kokonaiskustannus" leaves the viewport on
   the form: the result renders below the fold with no scroll, and the
   inline result list stays open after a selection.
4. Terminology drift: the dropdown says "Halvin havaittu hinta" while the
   quantities step says "Alin havaittu hinta" — same screen, two words.
5. The footer newsletter "Tilaa" button is silently disabled until the
   consent checkbox is ticked — no message tells the visitor why.
6. The hero badge claims "WCAG AA -saavutettava" while the trust line's
   small light text on dark blue is an unverified contrast risk.

## What Changes

- Absent-sort default flips to `ALPHABETICAL` on the API (blank counts as
  absent; unknown values still 400; `LOWEST_PRICE` remains an explicit
  option) and in the products page's default select state. This
  deliberately revises the `first-impression-pass` decision, with the
  catalog-composition evidence recorded in design.md.
- Search dropdown rows surface the existing per-listing €/g embed plus an
  "≈ x,xx €/kpl" helper on pack rows, derived client-side from the
  read-time package-units parser — no new API surface.
- After a successful calculation the result card scrolls into view
  (honoring `prefers-reduced-motion`), and the inline result list
  collapses on selection.
- Terminology unified on "Halvin havaittu hinta".
- Consent hint text beside the still-locked Tilaa button.
- Computed contrast audit of the hero trust line; token/markup fix only
  if a pair fails AA.

## Capabilities

- `product-search` — MODIFIED *Server-side catalog sorting*: the default
  becomes alphabetical.
- `product-catalog` — MODIFIED *Browsable catalog page*: the catalog page
  default follows the API default.
- `web-application` — MODIFIED *Calculator UI* (mobile result visibility,
  dropdown behavior); ADDED *Per-unit price context on pack rows*;
  ADDED *Newsletter consent affordance*.

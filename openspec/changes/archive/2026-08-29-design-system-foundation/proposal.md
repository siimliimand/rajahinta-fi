# Design System Foundation

## Why

The frontend is functional but has no visual design layer. Verified state of the code:

- `tailwind.config.ts` defines one custom token, a `primary` palette that is Tailwind's stock blue scale renamed. No typography, spacing, radii, or shadow tokens exist. `globals.css` is the three Tailwind directives and nothing else. No `next/font` is used, so the site renders in the default system font stack.
- There is no `public/` directory: no logo, no favicon, no Open Graph image. The header logo is styled text.
- Button and badge class strings are copy-pasted in every component. Reliability color maps (`RELIABILITY_BADGE`, `RELIABILITY_DOT`, `CONFIDENCE_META`) live inside `CalculatorResult.tsx` and similar per-component duplicates exist elsewhere.
- DESIGN.md and the code disagree on status colors: the doc says ESTIMATED blue and UNAVAILABLE gray, the code uses ESTIMATED amber and UNAVAILABLE red.
- The home page is a placeholder: a title, a subtitle, four buttons. Nothing tells a first-time visitor what the service does or why its numbers are trustworthy.
- There are no designed states for empty search results, API errors, rate-limit responses, or the production launch gates being closed (all three gates ship closed, so a pre-launch visitor currently sees an unexplained void).

DESIGN.md states the intended positioning: an explainable financial-intelligence tool where data legibility beats marketing polish. That intent was never built out. This change implements it.

## What Changes

The design direction is data-first Nordic utility: calm, restrained, credibility-focused. It must read as a trustworthy tax tool, not a shop. No ranking behavior changes; comparison and ranking views stay visually neutral, and the design system gains no "featured" or "sponsored" card style at all.

Decisions taken where the analysis left a choice:

- **D1**: UNAVAILABLE becomes neutral gray. Red is reserved for actual errors and danger. This resolves the DESIGN.md versus code conflict in the doc's favor and updates the doc.
- **D2**: ESTIMATED becomes blue (informational); amber stays exclusive to STALE.
- **D3**: Inter via `next/font` with tabular numerals mandatory for all money display.
- **D4**: Tokens are CSS variables mapped into the Tailwind theme, so dark mode can land later without rework.
- **D5**: UI primitives are hand-rolled; shadcn/ui stays out until component count justifies it (per DESIGN.md's own future note).
- **D6**: Homepage trust content is static copy (data sources, reliability model, methodology link). No new backend endpoints or calls.

### Token foundation

A semantic status palette (VERIFIED green, ESTIMATED blue, STALE amber, UNAVAILABLE gray, red for errors), a neutral gray scale, radii, and shadows become CSS variables mapped into the Tailwind theme. Base styles and typography land in `globals.css`. Inter is wired through the root layout with a tabular-numeral utility for the money-heavy UI. Brand assets arrive as code: a logo wordmark component, an app icon favicon, and an Open Graph image generated with `next/og`.

### Shared primitives

Button, Badge (reliability and confidence variants), Card, Input, and state components (empty, error, loading skeleton) are extracted to `components/ui/`. A canonical status module replaces every per-component color map, which settles the status-color vocabulary in exactly one place.

### Layout chrome

The header gains an active-page indicator, a keyboard-operable mobile menu, and the logo. The footer gets a structured legal layout while keeping the structural disclaimer text intact.

### Homepage

A hero answers "what does importing alcohol from Sweden actually cost" in one sentence, with the calculator as the primary call to action and a trust row covering data sources (Systembolaget feed, official Vero rate datasets), the reliability model, and the methodology link. Copy lives in the fi and en catalogs and must pass the content-policy lint, which forbids marketing phrases in both locales.

### Designed states

Empty, error, loading, and rate-limited (429 with surfaced `Retry-After`) states are designed and wired into search, calculator, and result views. A launch-gate-closed notice replaces the current void when production gates are shut.

## Impact

- **Apps/frontend only.** No backend, package, or infra changes. No new API calls from the homepage (D6).
- **Ranking untouched.** Comparison, basket, and ranking views keep their order logic and neutral presentation; they only adopt the shared primitives and status module mechanically.
- **Compliance surface intact.** The structural disclaimer stays on every result view; the compliance suite must stay green.
- **Documentation**: DESIGN.md is regenerated at the end (token frontmatter filled, canonical status colors, component and route inventory).
- **Deferred**: dark mode and a print stylesheet. The token layer (D4) makes both cheap follow-ups rather than rework.

## Task mapping

| Group | Change tasks |
|---|---|
| Token foundation | 1.1 to 1.3 |
| Shared primitives | 2.1 to 2.4 |
| Layout chrome | 3.1 to 3.3 |
| Homepage | 4.1, 4.2 |
| Designed states | 5.1 to 5.3 |
| Docs and verification | 6.1, 6.2 |

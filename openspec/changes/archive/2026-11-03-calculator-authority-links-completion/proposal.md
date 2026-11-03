# Proposal: calculator-authority-links-completion

## Why

`audit-copy-batch` task 3.1 was recorded as partially met: the audit named two authority links
(vero.fi **Alkoholiverolaskuri**, **Tulli reisijän ohjeet**) that did not exist in the repo's link
set, so the shipped `AuthoritySourceLinks` rendered only the declaration panel's two vero.fi pages.
This change completes the audit's intent with the two named links, now that both URLs are verified
live (2026-10-16).

## What changes

- `AuthoritySourceLinks` becomes the calculator-surface authority set: the two existing vero.fi
  guidance links + the verified traveller-duty calculator (vero.fi) + the verified Tulli traveller
  alcohol-import guidance. Order: existing set first, audit links appended.
- **Design decision**: the core-domain `OFFICIAL_SOURCES` (declaration payload) stays vero.fi-only —
  its test pins every entry to `www.vero.fi` deliberately (Tax Administration filing context), and a
  Customs URL would ripple payload pins. The mirror's docblock contract is rewritten accordingly:
  the component curates the calculator-surface set, provenance-documented, no longer a verbatim
  mirror.
- fi/en labels for the two new links in the `AuthorityLinks` namespace.

## Verification

- Frontend suite green (updated component test: 4 links, order, hrefs, labels).
- tsc + eslint + content-policy lint clean.
- URLs verified live 2026-10-16: vero.fi alkoholiverolaskuri (fi/en), tulli.fi traveller-imports
  guidance (fi/en) — search-index verified; tulli.fi 403s plain fetchers (CDN posture, same as
  Posti's documented block).

## Out of scope

- Declaration payload changes (none — the declaration guidance surface keeps its two vero.fi links).

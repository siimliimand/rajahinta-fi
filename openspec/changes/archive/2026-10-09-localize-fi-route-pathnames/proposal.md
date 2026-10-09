# Proposal: localize-fi-route-pathnames

## Why

Finnish is the default locale and serves from bare paths, but every URL
segment is the English filesystem name — the Finnish-language site
advertises `/products`, `/calculator`, `/basket` to the Finnish market it
serves, and the natural Finnish URL (`/tuotteet`) 404s. This is a direct
consequence of the next-intl setup (commit `da7f4bf`): the routing config
has no `pathnames` mapping, so segments never localized when `fi` was
enabled.

The fix is next-intl's `pathnames` — and exploration (2026-10-08)
established the negotiation the owner requires comes free with it: the
stock middleware already redirects locale-mismatched segments, verified
against the live site (an `en` browser requesting bare `/products` gets
`307 → /en/products` today) and by decoding `next-intl@4.14.1` middleware
source ("wrong localized pathname" → redirect to the detected locale's
canonical URL). Once `pathnames` exist:

- an `en`-browser user clicking Google's `/tuotteet` result gets `307 →
  /en/products`, once, then the locale cookie pins them;
- crawlers send no `Accept-Language` and no cookie, so they are served the
  segment-owning (Finnish) page and index `/tuotteet` as the fi URL;
- every currently indexed bare URL (`/products`, `/calculator`, …)
  consolidates automatically into the new localized URLs with zero
  hand-written redirect rules.

## What Changes

- **Localized pathnames** (`routing.ts` `pathnames` config): 21 localized
  + 12 shared entries per the owner-approved vocabulary (design D1) —
  `/tuotteet`, `/laskuri`, `/vertailu`, `/ostoskori`, `/matka`,
  `/tilaisuus`, `/skenaario`, `/grammahinta`, `/jarjestys`, `/saastolista`,
  `/tullivapaat`, `/ryhmatilaus`, `/blogi/[slug]`, `/oppaat/[slug]`,
  `/listat/[slug]`, `/tietoja`, `/yhteystiedot`, `/tuotteet/[id]` — every
  segment sourced from the site's own Finnish nav/footer/page labels, ASCII
  transliteration (no ä/ö). Machine/tokenized/private/email-lifecycle
  routes (login, register, account, age gate, calculator result records,
  group-order tokens, share permalinks, newsletter confirm/unsubscribe,
  ops) keep one shared segment across locales.
- **Negotiation behavior (no middleware code):** the stock next-intl
  middleware provides the smart-redirect contract unchanged. Internal App
  Router route names do not move; no hand-written redirect map (verified:
  zero collisions between new fi segments and existing bare routes).
- **Localized URL emitters:** `sitemap.ts` emits the localized URL per
  locale with hreflang alternates pairing localized variants (the
  content-gated advertisement contract is preserved); every
  `generateMetadata` canonical uses the active locale's segment; the 13
  files that build raw paths (`href={`/…`}`, `router.push/replace`)
  move to typed i18n navigation. URL query parameters (`?category=`,
  `?page=`, `?sort=`, `?q=`) stay English — API contract values.
- **Language switcher** (new): site-header switcher using the
  cookie-first pattern (`useRouter().replace(pathname, { locale })`) so
  the switch updates `NEXT_LOCALE` before navigation and the middleware
  does not bounce it back. The catalog label already exists
  (`SiteHeader.localeSwitcherLabel`); no switcher component exists today.
- **Documentation:** ARCHITECTURE.md routing/i18n section and stale
  docblocks updated with the vocabulary and negotiation matrix.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-application`: adds four requirements — localized route pathnames
  (vocabulary, ASCII rule, shared-segment set, English query params),
  locale negotiation on localized pathnames (temporary redirects,
  crawler passthrough, cookie precedence, legacy consolidation), localized
  sitemap URLs and canonicals (per-locale URLs, hreflang alternates,
  canonical per active locale), and a locale switcher (cookie-first,
  both locales).

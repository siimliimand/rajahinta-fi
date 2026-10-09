# Design

## Context

The frontend runs next-intl 4.14 on Next 15 with `locales: ['fi', 'en']`,
`defaultLocale: 'fi'`, `localePrefix: 'as-needed'` and **no `pathnames`**
(`apps/frontend/src/i18n/routing.ts`, unchanged since its creation in
`da7f4bf`). Segments are filesystem names, so Finnish serves English
segments from bare paths. Exploration on 2026-10-08 grounded every load-
bearing claim:

- **Live behavior today:** `curl -H "Accept-Language: en"
  rajahinta.fi/products` → `307 → /en/products`; fi header → `200`. Bare
  paths are locale-*ambiguous* now, so the middleware negotiates via
  cookie → Accept-Language (priority order confirmed in
  `resolveLocale.js`: prefix match → cookie → Accept-Language → default).
- **With `pathnames`,** segments become locale-*identified*. The decoded
  middleware adds the "wrong localized pathname" rule: request a segment
  owned by locale A while locale B is negotiated → temporary redirect to
  B's canonical URL (official behavior matrix: `/ueber` (de) → `/about`
  (en)). `getInternalTemplate` maps an incoming segment to its owning
  locale and internal template; `formatTemplatePathname` rebuilds the URL
  in the negotiated locale.
- **Crawler safety:** Googlebot sends no `Accept-Language` and no cookie →
  resolution falls through to the default locale (fi) → crawlers are
  served the segment-owning Finnish page and index `/tuotteet` as the fi
  URL. This is the load-bearing SEO property of the whole design.
- **Strict typing consequence:** once `pathnames` is defined, hrefs passed
  to the i18n `Link`/`useRouter` are typed to the pathnames keys — every
  route navigated through i18n navigation needs an entry, localized *or*
  explicitly shared.

The internal route tree does not move. Only external URLs and the code
that emits URLs change.

## Decisions

### D1 — Segment vocabulary (owner-approved 2026-10-08)

Localized entries (fi segment ← internal route; en keeps the internal
name; sources are the site's own fi labels):

| Internal route | fi segment | Source label |
|---|---|---|
| `/` | `/` | — |
| `/calculator` | `/laskuri` | Nav "Laskuri" |
| `/compare` | `/vertailu` | Nav "Vertailu" |
| `/basket` | `/ostoskori` | Nav "Ostoskori" |
| `/products` | `/tuotteet` | Nav "Tuotteet" |
| `/products/[id]` | `/tuotteet/[id]` | |
| `/trip` | `/matka` | Nav "Matkalaskuri" (core noun) |
| `/event` | `/tilaisuus` | Nav "Tilaisuuslaskuri" |
| `/what-if` | `/skenaario` | Nav "Skenaariolaskuri" |
| `/value` | `/grammahinta` | ValuePage "Etanolin grammahinta" |
| `/ranking` | `/jarjestys` | Ranking "Miten järjestys muodostuu" |
| `/savings` | `/saastolista` | Nav "Säästölista" (ASCII) |
| `/allowances` | `/tullivapaat` | Nav "Tullivapaat määrät" |
| `/group-order` | `/ryhmatilaus` | Footer "Ryhmätilaus" (ASCII) |
| `/blog` | `/blogi` | Footer "Blogi" |
| `/blog/[slug]` | `/blogi/[slug]` | owner decision; `[slug]` is per-locale DB content |
| `/guides` | `/oppaat` | Footer "Oppaat" |
| `/guides/[slug]` | `/oppaat/[slug]` | owner decision |
| `/lists/[slug]` | `/listat/[slug]` | ListsPage "Listaukset" |
| `/about` | `/tietoja` | Footer "Tietoja" |
| `/contact` | `/yhteystiedot` | Footer "Yhteystiedot" |

### D2 — Shared segments (machine, tokenized, private, email)

| Group | Routes | Rationale |
|---|---|---|
| Auth/account | `/login`, `/register`, `/account/*`, `/age-gate*` | Private/noindex; zero SEO value |
| Machine/token URLs | `/calculator/result/[recordId]`, `/group-order/[token]`, `/share/[publicId]` | Baked into exported reports and shared invites; a rename would 404 them (legacy bare segments only auto-redirect while they still map to a route) |
| Email lifecycle | `/newsletter/confirm`, `/newsletter/unsubscribe` | Arrive from already-sent campaign emails; must not move |
| Internal | `/ops/*` | Staff console |

### D3 — Negotiation is stock middleware; no custom layer

The owner requirement ("Google click on `/tuotteet`, en browser →
`/en/products`") is the middleware's wrong-locale-pathname redirect.
Resulting matrix (fi = default, as-needed):

| Request | Negotiated | Result |
|---|---|---|
| `/tuotteet`, en browser, no cookie | en | `307 → /en/products` |
| `/tuotteet`, fi browser | fi | `200` Finnish page (rewrite, bare) |
| `/tuotteet`, no signals (crawler) | fi (default) | `200` Finnish page |
| legacy `/products`, fi signals | fi | `307 → /tuotteet` |
| legacy `/products`, en signals | en | `307 → /en/products` |
| `/en/products` | en (prefix) | `200` English page |

The redirects are `307` (temporary) — correct for header-dependent
negotiation; Google explicitly warns against caching `301`s of
locale-negotiated URLs. No hand-written redirect map: collision check
confirmed no new fi segment equals an existing bare route, so every
legacy combination resolves through the wrong-locale-pathname rule alone.

### D4 — ASCII slugs

`saastolista`, `ryhmatilaus`, `skenaario`, `jarjestys` — ASCII
transliteration (yle.fi convention), robust against messaging-app link
mangling. next-intl could serve `/säästölista`, but switching later would
be a second migration; the owner approved ASCII.

### D5 — Cookie precedence and the switcher pitfall

The middleware writes `NEXT_LOCALE` on its responses; the cookie outranks
Accept-Language on later navigations, so a negotiated redirect happens
once per browser and the choice persists. Documented pitfall: `<Link
locale={…}>` to the *default* locale renders the unprefixed href while
the cookie still says `en` — the middleware then redirects the switch
back to `/en/…`. The switcher therefore switches through
`useRouter().replace(pathname, { locale })`, which updates the cookie
client-side before navigation.

### D6 — Sitemap and canonicals emit localized URLs

`STATIC_PATHS` and the category/product/editorial URL builders in
`sitemap.ts` translate through the localized templates per locale; the
content-gated advertisement contract (editorial index URLs only when
published content exists; every emitted URL serves) is preserved — a
localized URL that 404s would be worse than an English one that serves.
Every `generateMetadata` canonical (e.g. `catalogCanonicalPath` in
`products/page.tsx`) emits the active locale's segment. Hreflang
alternates pair the localized variants; `x-default` keeps pointing at the
negotiating bare (fi) URL.

### D7 — Query parameters stay English

`?category=beer&sort=…` are API contract values validated by the worker
and used by analytics; slugs carry the SEO weight. Localizing params
would fork the API surface for no ranking gain. Owner confirmed.

## Risks

- **Middleware behavior is load-bearing and external** (next-intl
  patch releases could alter negotiation edge cases). Mitigation: the
  e2e negotiation matrix pins the contract; `next-intl` is pinned
  `^4.14.0` in lockstep with the matrix.
- **Raw-path audit completeness** — a missed `href={`/…`}` silently
  emits a legacy URL (works, but foreign-locale). Mitigation: the audit
  task greps the frontend for template/concatenated paths and the
  sitemap/canonical tests catch the structured emitters.

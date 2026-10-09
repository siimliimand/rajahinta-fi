# Spec Delta

## ADDED Requirements

### Requirement: Localized route pathnames

The frontend SHALL define localized external pathnames (next-intl
`pathnames`) so every public content route serves a Finnish segment for
`fi` and the English segment for `en`, per the approved vocabulary:
`/laskuri` (calculator), `/vertailu` (compare), `/ostoskori` (basket),
`/tuotteet` (products, including `/tuotteet/[id]`), `/matka` (trip),
`/tilaisuus` (event), `/skenaario` (what-if), `/grammahinta` (value),
`/jarjestys` (ranking), `/saastolista` (savings), `/tullivapaat`
(allowances), `/ryhmatilaus` (group-order), `/blogi/[slug]` (blog),
`/oppaat/[slug]` (guides), `/listat/[slug]` (curated lists), `/tietoja`
(about), `/yhteystiedot` (contact); the root `/` stays bare in both
locales. Every Finnish segment SHALL be ASCII (no diacritics). Machine,
tokenized, private, and email-lifecycle routes (`/login`, `/register`,
`/account/**`, `/age-gate**`, `/calculator/result/[recordId]`,
`/group-order/[token]`, `/share/[publicId]`, `/newsletter/**`, `/ops/**`)
SHALL keep one shared segment across locales. Internal App Router route
names SHALL NOT change. URL query parameters (`category`, `page`, `sort`,
`q`) SHALL remain the English API contract values in every locale.

#### Scenario: Finnish products URL serves the catalog

- **WHEN** a user requests `/tuotteet`
- **THEN** the product catalog renders in Finnish at that bare URL

#### Scenario: Segment vocabulary is ASCII-only

- **WHEN** the pathnames configuration is validated
- **THEN** every Finnish segment contains only ASCII slug characters (no ä/ö)

#### Scenario: Query parameters unchanged across locales

- **WHEN** a user filters or sorts the Finnish catalog
- **THEN** the URL is the localized segment with English parameter values (e.g. `/tuotteet?category=beer&sort=price_asc`)

### Requirement: Locale negotiation on localized pathnames

Requests for a localized pathname whose segment belongs to a locale other
than the negotiated locale SHALL be redirected to the negotiated locale's
canonical URL with a temporary redirect (307). Requests carrying no
negotiation signals (no locale cookie, no Accept-Language — typical
crawlers) SHALL be served the segment-owning locale's page so each
locale's URL is indexed by crawlers. The locale cookie SHALL take
precedence over Accept-Language on subsequent navigations so a negotiated
choice persists across visits. Legacy bare segment URLs (the pre-existing
English filesystem names) SHALL redirect to the negotiated locale's
localized URL without a hand-written redirect map.

#### Scenario: English browser clicking the Finnish URL

- **WHEN** a request without a locale cookie carries an Accept-Language preferring English for `/tuotteet`
- **THEN** the response is a 307 redirect to `/en/products`

#### Scenario: Finnish browser keeps the bare URL

- **WHEN** a request carries an Accept-Language preferring Finnish for `/tuotteet`
- **THEN** the Finnish page serves 200 without a redirect

#### Scenario: Crawlers see the segment-owning locale

- **WHEN** a request carries neither a locale cookie nor an Accept-Language header for `/tuotteet`
- **THEN** the Finnish page serves 200 so crawlers index the Finnish URL

#### Scenario: Cookie pins the negotiated choice

- **WHEN** a user whose locale cookie is `en` requests the bare homepage `/`
- **THEN** they are redirected to `/en` based on the cookie, regardless of browser language

#### Scenario: Legacy bare URLs consolidate

- **WHEN** a request hits the legacy bare URL `/products`
- **THEN** it redirects to `/tuotteet` under Finnish negotiation signals and to `/en/products` under English signals

### Requirement: Localized sitemap URLs and canonicals

The sitemap SHALL emit each public route's localized URL per locale
(Finnish bare, English under `/en`) and SHALL pair locale variants with
hreflang alternates pointing at the localized URLs. The content-gated
advertisement contract SHALL be preserved: an editorial index URL is
emitted only when its store has published content in that locale, and
every URL the sitemap emits SHALL serve a renderable page. Each page's
canonical URL SHALL use the active locale's pathname segment.

#### Scenario: Sitemap advertises the localized catalog URLs

- **WHEN** the sitemap is generated
- **THEN** it lists the Finnish catalog at its localized segment (`/tuotteet`) and the English catalog at `/en/products`, paired as hreflang alternates

#### Scenario: Canonical matches the active locale

- **WHEN** the Finnish catalog page renders with a category filter
- **THEN** its canonical URL uses the Finnish segment with the English query parameters

### Requirement: Locale switcher

The site header SHALL offer a locale switcher between Finnish and
English, rendered in both locales with copy from the message catalogs.
Switching SHALL update the locale cookie before navigation (client-side
router-based switch) so the middleware does not redirect the switch back,
and SHALL land the user on the equivalent page in the target locale at
its localized URL.

#### Scenario: Switch lands on the localized equivalent

- **WHEN** a user on `/en/products` switches to Finnish
- **THEN** they land on `/tuotteet` (bare, no `/fi` prefix) and subsequent navigation stays in Finnish

#### Scenario: Switcher copy comes from the catalogs

- **WHEN** the header renders in either locale
- **THEN** the switcher label resolves from the message catalogs ("Vaihda kieltä" / "Switch language")

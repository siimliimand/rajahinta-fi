# Task 5.3 — FAQ guide entries (design D4)

## Status: AUTHORED — NOT YET PUBLISHED (publishing blocked in this environment)

All 9 FAQ entries (the 8 required topics + transport estimate) are authored below in **both
locales (18 guide drafts)**, ready for the ops guides console. **They have NOT been published.**

### Blocker (exact)

Publishing requires the ops console mutation endpoints on the deployed API Worker
(`POST /ops/console/blog/guides`, then `POST /ops/console/blog/posts/:id/publish`). Those routes
sit behind the `/ops/console/*` access guard (`apps/api-worker/src/middleware/ops-access.ts`,
`packages/application-api/src/observability/ops-access.guard.ts`), which authenticates with the
per-environment **`OPS_BEARER_TOKEN`** Cloudflare secret (`wrangler secret put OPS_BEARER_TOKEN`,
per `docs/ingestion-runbook.md` §2) or an `OPS_IP_ALLOWLIST`. The guard **fails closed** when
unconfigured. The token is a secret held by the operator — it is not present in any local env
file in this checkout (verified; same blocker as recorded in
`openspec/changes/onboard-kippis-merchant/notes.md`). No bypass (direct D1 write, token guess)
was attempted: the console path is the audited, lint-gated publication route by design.

---

## Publishing mechanism (discovered)

- **Console UI:** `/ops/guides` (fi, default) or `/en/ops/guides` on the deployed frontend
  (`GuidesConsole` → `createGuideDraft` / `editGuideDraft` / `publishBlogPost` in
  `apps/frontend/src/app/[locale]/ops/`).
- **API:** on the deployed API Worker (`$API_URL`, the `NEXT_PUBLIC_API_URL` origin the frontend
  is built against):
  - `POST /ops/console/blog/guides` — creates a **DRAFT** row with `kind: GUIDE`, no
    rate-dataset provenance. Body: `{ operator, slug, locale: "fi"|"en", title, bodyMarkdown, note? }`.
  - `POST /ops/console/blog/posts/:id/publish` — DRAFT → **PUBLISHED** (terminal, one-way).
    Body: `{ operator, note? }`. Publication **fails with 400 `ContentPolicyViolation`** unless the
    body passes the content-policy lint (`packages/core-domain/src/content/content-lint.ts` —
    banned promotional terms; all entries below already pass, verified).
  - Auth header on both: `Authorization: Bearer $OPS_BEARER_TOKEN`.
  - `(slug, locale)` is the unique key → the same slug may exist per locale; re-running an entry
    returns 409 `SlugConflict` (idempotency boundary).
- **After publish:** `GET /api/v1/guides?locale=…` (900 s revalidation) picks the entries up; the
  guides index page, the **homepage FAQ section from task 3.4** (renders once ≥1 PUBLISHED guide
  exists, links each `/guides/:slug`), and the sitemap update automatically. No code change needed.

### Operator publishing steps

1. Retrieve the environment's `OPS_BEARER_TOKEN` (operator secret store; `wrangler secret list`
   confirms it is set — the value is never committed or printed).
2. Open `/ops/guides` on the deployed frontend. Enter operator name + ops bearer token → **Load
   guides** (empty list is expected initially).
3. For each entry below (9 topics × 2 locales = 18): fill **slug / locale / title / body**, click
   **Create draft**, then **Publish** on the new row. Publish runs the content-policy lint
   server-side; PUBLISHED is terminal, so verify title/body on the draft before publishing.
4. curl equivalent:

   ```bash
   curl -X POST "$API_URL/ops/console/blog/guides" \
     -H "Authorization: Bearer $OPS_BEARER_TOKEN" -H "Content-Type: application/json" \
     -d '{"operator":"<name>","slug":"opas-kokonaiskustannus","locale":"fi",
          "title":"Miten kokonaiskustannus lasketaan?","bodyMarkdown":"<body>"}'
   # → {"id":N,...}; then:
   curl -X POST "$API_URL/ops/console/blog/posts/N/publish" \
     -H "Authorization: Bearer $OPS_BEARER_TOKEN" -H "Content-Type: application/json" \
     -d '{"operator":"<name>","note":"price-intelligence-roadmap task 5.3"}'
   ```

5. Verify: `GET $API_URL/api/v1/guides?locale=fi` (and `en`) lists the entries; homepage FAQ
   section (`Usein kysytyt kysymykset` / `Frequently asked questions`) links them after the 900 s
   revalidation window.

### Intended slugs (AUTHORED / NOT YET PUBLISHED)

| # | Topic | fi slug | en slug |
|---|---|---|---|
| 1 | Landed cost | `opas-kokonaiskustannus` | `guide-landed-cost` |
| 2 | Freshness | `opas-tuoreus` | `guide-freshness` |
| 3 | Sources | `opas-lahteet` | `guide-sources` |
| 4 | Tax inclusion | `opas-verot-sisallytys` | `guide-tax-inclusion` |
| 5 | Allowance limits | `opas-tullivapaat-maarat` | `guide-allowance-limits` |
| 6 | Accuracy | `opas-tarkkuus` | `guide-accuracy` |
| 7 | Cadence | `opas-paivitystahti` | `guide-update-cadence` |
| 8 | Account purpose | `opas-tili` | `guide-account-purpose` |
| 9 | Transport estimate (extra) | `opas-kuljetusarvio` | `guide-transport-estimate` |

Slug convention follows the existing guide rows (`opas-*` fi / `guide-*` en, lowercase ASCII —
the create schema enforces `^[a-z0-9]+(?:-[a-z0-9]+)*$`).

---

## Entries

### 1. Landed cost — `opas-kokonaiskustannus` / `guide-landed-cost`

**fi title:** Miten kokonaiskustannus lasketaan?

**fi bodyMarkdown:**

```markdown
Rajahinta.fi laskee alkoholijuomien tuonnin arvioidun kokonaiskustannuksen Suomeen. Erittelyssä
näkyvät: ulkomainen vähittäishinta, kuljetuskustannus sekä arviot Suomen alkoholin
valmisteverosta ja pakkausverosta valitsemallesi määrälle ja määränpäälle.

Verot ja maksut lasketaan Verohallinnon virallisiin verokanta-aineistoihin perustuen. Jokainen
laskennassa käytetty aineisto on versioitu, ja laskelman yhteydessä näytetään, mitä
aineistoversioita on käytetty.

Lopputulos on arvio. Arvioitu kokonaiskustannus Suomessa on arvio, ei lopullinen verovelka —
lopulliset verot ja maksut määräytyvät tuonnin yhteydessä tuotteen todellisten tietojen
perusteella. Jokainen erittelyn luku kantaa luotettavuusmerkinnän (vahvistettu, arvioitu,
vanhentunut), jotta näet, mitkä osat perustuvat suoriin havaintoihin ja mitkä ovat johdettuja.
```

**en title:** How is the total cost calculated?

**en bodyMarkdown:**

```markdown
Rajahinta.fi estimates the total cost of importing alcoholic beverages to Finland. The breakdown
shows: the foreign retail price, the transport cost, and estimates of Finnish alcohol excise duty
and container tax for the quantity and destination you choose.

Taxes and duties are calculated from the Finnish Tax Administration's official rate datasets.
Every dataset used in a calculation is versioned, and the result shows which dataset versions it
was computed with.

The result is an estimate. The estimated total cost in Finland is an estimate, not a final tax
liability — the final duties and taxes are determined at import based on the actual details of
the goods. Every figure in the breakdown carries a reliability status (verified, estimated,
stale), so you can see which parts come from direct observations and which are derived.
```

### 2. Freshness — `opas-tuoreus` / `guide-freshness`

**fi title:** Kuinka tuoreita hintatiedot ovat?

**en title:** How fresh is the price data?

**fi bodyMarkdown:**

```markdown
Jokainen hinta sivustolla on havainto: se on kerätty myyjän julkaisemasta aineistosta tiettynä
ajankohtana, ja havainnolla on aikaleima. Tuoresuositusta ei tarvitse arvata — jokainen luku
kantaa luokan:

- **Vahvistettu** — hinta perustuu tuoreeseen havaintoon tuoreusikkunan sisällä.
- **Arvioitu** — luku on johdettu saatavilla olevasta aineistosta, ei suoraan havaittu.
- **Vanhentunut** — myyjän tuorein havainto on vanhempi kuin tuoreusikkuna; hinta näytetään
  edelleen, mutta merkintänä on vanhentunut eikä poistettu.

Tuotteen sivulla on myyjikohtainen tuoreusosio, jossa näkyy kunkin myyjän tuorein havainto.
Laskelman yhteydessä näytetään myös käytettyjen verokanta-aineistoversioiden tiedot, joten
myös veropuolen aineiston ajantasaisuuden voi tarkistaa.
```

**en bodyMarkdown:**

```markdown
Every price on the site is an observation: it was collected from a merchant's published dataset
at a specific time, and each observation carries a timestamp. You do not have to guess how fresh
a figure is — every number carries a status class:

- **Verified** — the price comes from a recent observation within the freshness window.
- **Estimated** — the figure is derived from the available data, not directly observed.
- **Stale** — the merchant's latest observation is older than the freshness window; the price is
  still shown, but marked stale rather than removed.

The product page has a per-merchant freshness section showing each merchant's latest observation.
The calculation result also shows the rate dataset versions it used, so you can check how current
the tax side of the data is as well.
```

### 3. Sources — `opas-lahteet` / `guide-sources`

**fi title:** Mistä tiedot tulevat?

**en title:** Where does the data come from?

**fi bodyMarkdown:**

```markdown
Tuotteiden hinnat perustuvat vähittäismyyjien julkaisemiin aineistoihin ja Alkon kotimaiseen
vertailuhintaan. Verot ja maksut lasketaan Verohallinnon virallisiin verokanta-aineistoihin
perustuen. Matkustajan tullivapaiden määrien arvot tulevat versioiduista määräraja-aineistoista,
joiden mukana näytetään kunkin määrän alkuperäinen lähdeviite.

Hintahavainnot kerätään rekisteröityjen myyjien aineistoista. Kullakin myyjällä on
kauppiäsrekisterissä lähde tietoineen, ja keruu etenee vain, jos lähteelle on olemassa
käyttöoikeustietue — ilman sitä myyjän aineistoa ei käsitellä.

Sivusto on laskuri ja indeksi, ei kauppa: hinnat ovat kerättyjä havaintoja, eivät myyjien
tarjoamia. Jokainen luvun lähde on selvitettävissä sivulta itsestään — versiotiedot,
aikaleimat ja luotettavuusmerkinnät kulkevat luvun mukana.
```

**en bodyMarkdown:**

```markdown
Product prices are based on datasets published by retailers and on the Alko domestic reference
price. Taxes and duties are calculated from the Finnish Tax Administration's official rate
datasets. Traveller duty-free allowance values come from versioned allowance datasets, shown
with each amount's original source citation as recorded.

Price observations are collected from registered merchants' datasets. Each merchant has a source
record in the merchant registry, and collection only proceeds when a permission record exists
for that source — without one, a merchant's dataset is not processed.

The site is a calculator and an index, not a shop: prices are collected observations, not
merchant offers. Every figure's origin can be traced on the page itself — version details,
timestamps, and reliability statuses travel with the number.
```

### 4. Tax inclusion — `opas-verot-sisallytys` / `guide-tax-inclusion`

**fi title:** Sisältyvätkö verot hintaan?

**en title:** Are taxes included in the price?

**fi bodyMarkdown:**

```markdown
Erittelyn ensimmäinen rivi on myyjän julkaisema vähittäishinta sellaisenaan. Suomen
valmistevero ja pakkausvero eivät sisälly siihen — ne lasketaan erikseen omiksi riveikseen
Verohallinnon virallisen verokanta-aineiston pohjalta valitsemallesi määrälle.

Kokonaisarvio kertoo, mitä tuonnin on arvioitu maksavan Suomeen asti. Arvioitu kokonaiskustannus
Suomessa on arvio, ei lopullinen verovelka: lopullisen summan määräävät tuonnin yhteydessä
tarkistettavat tuotetiedot ja voimassa olevat verokannat.

Verokanta-aineisto on versioitu. Laskelma näyttää käytetyn aineistoversion, ja verokantojen
muutokset tulevat laskentaan vain vahvistuksen jälkeen — vahvistetut muutokset julkaistaan
blogissa ennen voimaantuloa. Näin jokainen arvio on jäljitettävissä johonkin aikankohtaiseen,
julkaistuun aineistoon.
```

**en bodyMarkdown:**

```markdown
The first line of the breakdown is the merchant's published retail price as-is. Finnish excise
duty and container tax are not included in it — they are calculated as separate lines from the
Finnish Tax Administration's official rate dataset, for the quantity you selected.

The total estimate states what importing the goods to Finland is estimated to cost. The
estimated total cost in Finland is an estimate, not a final tax liability: the final amount is
determined at import, based on the product details verified then and the rates in force.

The rate dataset is versioned. Each calculation shows the dataset version it used, and rate
changes enter the calculation only after confirmation — confirmed changes are announced on the
blog before they take effect. That way every estimate is traceable to a dated, published
dataset.
```

### 5. Allowance limits — `opas-tullivapaat-maarat` / `guide-allowance-limits`

**fi title:** Mitkä ovat matkustajan tullivapaat määrät?

**en title:** What are the traveller duty-free allowances?

**fi bodyMarkdown:**

```markdown
Tullivapaat määrät -sivu näyttää valitun päivän kohdalla voimassa olevat tullivapaat määrät
tuoteryhmittäin: aineistoversion, voimassaoloajan ja jokaisen määrän alkuperäisen lähdeviitteen
sellaisenaan kuin se on tallennettu. Korvatut aineistoversiot säilyvät versiohistoriassa
listattuina.

Matkalaskuri soveltaa valitsemallesi matkapäivälle julkaistua määräraja-aineistoversiota. Jos
valittua päivää kattavaa julkaistua versiota ei ole, laskentaa ei tehdä, vaan sivu kertoo sen
suoraan — arvoja ei arvailla.

Määrät ovat ohjeistusta, ei oikeudellista neuvontaa. Rajalla noudatettavat määrät ja ehdot
vahvistaa aina viranomainen: tarkista tilanteesi voimassa olevat määrät suoraan Tullin
julkaisuista ennen matkaa, erityisesti jos tuot mukanaisi poikkeuksellisen suuria määriä.
```

**en bodyMarkdown:**

```markdown
The duty-free allowances page shows the allowances effective on your chosen date, by product
category: the dataset version, the validity period, and each amount's original source citation
as recorded. Superseded dataset versions remain listed in the version history.

The trip calculator applies the published allowance dataset version for the trip date you
select. If no published version covers that date, the calculation is not performed — the page
says so directly instead of guessing values.

The amounts are guidance, not legal advice. The limits and conditions enforced at the border are
always those of the authority: check the current allowances directly in the Finnish Customs
publications before you travel, especially if you are bringing unusually large quantities.
```

### 6. Accuracy — `opas-tarkkuus` / `guide-accuracy`

**fi title:** Kuinka tarkkoja arviot ovat?

**en title:** How accurate are the estimates?

**fi bodyMarkdown:**

```markdown
Tarkkuutta ei kuvata keksityllä pisteellä vaan julkisella tilastolla laskelman yhteydessä:
osuus raportoiduista loppusumista, jotka jäivät arviosta viiden prosentin sisään. Tilasto
näytetään aina otoskoon kanssa, jotta näet, mihin se perustuu.

Tilasto syntyy vierailijoiden raporteista. Laskelman jälkeen voit raportoida, paljonko
todellisuus maksoit — yksi raportti per laskelma. Kun raportoituja lopputuloksia ei vielä ole,
sivu sanoo sen suoraan eikä näytä mitään lukua.

Lisäksi jokainen erittelyn luku kantaa luotettavuusmerkinnän (vahvistettu, arvioitu,
vanhentunut). Voit siis nähdä sekä kokonaistarkkuuden historiallisen osuman että sen, mitkä
yksittäiset luvut ovat suoria havaintoja ja mitkä johdettuja.
```

**en bodyMarkdown:**

```markdown
Accuracy is not expressed as an invented score but as a public statistic shown with the
calculation result: the share of reported final totals that came within five percent of the
estimate. The statistic is always displayed together with its sample size, so you can see what
it is based on.

The statistic is built from visitor reports. After a calculation you can report what it actually
cost you — one report per calculation. When no reported outcomes exist yet, the page says so and
shows no number at all.

In addition, every figure in the breakdown carries a reliability status (verified, estimated,
stale). You can see both the historical hit rate of the overall estimate and which individual
figures are direct observations versus derived values.
```

### 7. Cadence — `opas-paivitystahti` / `guide-update-cadence`

**fi title:** Miten usein tiedot päivittyvät?

**en title:** How often does the data update?

**fi bodyMarkdown:**

```markdown
Päivitystahti on myyjäkohtainen. Kauppiäsrekisterissä jokaiselle lähteelle on kirjattu
keruuväli — tyypillisesti tunnin tai vuorokauden välein — ja keräys ajetaan automaattisesti
sen tahdissa. Tuoreimmat havainnot ovat siis käytettävissä heti, kun ne on noudettu.

Hintahavainnot tallennetaan lisäävästi: uusi havainto ei korvaa vanhaa, vaan historia säilyy.
Jos myyjän havaintoja ei ole päivitetty tuoreusikkunan sisällä, hinta merkitaan vanhentuneeksi
eikä poisteta.

Verokanta-aineistot, määräraja-aineistot ja kuljetusaineistot päivittyvät omien versioidensa
mukana. Uusi versio tulee laskentaan vasta vahvistuksen kautta, ja merkittävät verokantamuutokset
julkaistaan blogissa ennen voimaantuloa. Jokaisen laskelman yhteydessä näet, mitä versioita se
käyttää.
```

**en bodyMarkdown:**

```markdown
The update cadence is per merchant. The merchant registry records a collection interval for each
source — typically hourly or daily — and collection runs automatically on that schedule. The
latest observations are available as soon as they have been fetched.

Price observations are stored append-only: a new observation does not overwrite the old one, and
the history is preserved. If a merchant's observations have not been refreshed within the
freshness window, the price is marked stale rather than removed.

Rate datasets, allowance datasets, and transport datasets update on their own versioning
schedules. A new version enters calculations only through confirmation, and significant rate
changes are announced on the blog before they take effect. Every calculation shows which dataset
versions it used.
```

### 8. Account purpose — `opas-tili` / `guide-account-purpose`

**fi title:** Tarvitsenko tilin?

**en title:** Do I need an account?

**fi bodyMarkdown:**

```markdown
Ei, jos et halua tallennettavaa. Kokonaiskustannuslaskuri, oppaat, tuotehaku ja hintaseuranta
toimivat ilman tiliä — käyttö on oletuksena anonyymiä, eikä laskeminen vaan rekisteröitymistä.

Tili tarvitaan vain niihin ominaisuuksiin, joiden on säilyttävä sinun kanssasi:

- **Hintaherätykset** — ilmoitus, kun tuotteen kokonaiskustannusarvio muuttuu.
- **Tallennetut ostoskorit** — tuotevalintojen nopea uudelleenlaskenta.
- **Laskentahistoria** — aiemmat kokonaiskustannuslaskennat uudelleen ajettavissa.

Uutiskirje on erillinen suostumus: se ei liity hintaherätyksiin eikä tiliin, ja jokaisesta
viestistä pääsee peruuttamaan tilauksen yhdellä klikkauksella. Sivusto ei pyydä tiliä mihinkään,
mikä toimii ilman sitä.
```

**en bodyMarkdown:**

```markdown
No, if you have nothing to save. The total cost calculator, the guides, product search, and
price tracking all work without an account — usage is anonymous by default, and calculating
requires no registration.

An account is only needed for the features that must persist with you:

- **Price alerts** — a notification when a product's estimated total cost changes.
- **Saved baskets** — quick recalculation of a saved product selection.
- **Calculation history** — your previous total cost calculations, re-runnable.

The newsletter is a separate consent: it is unrelated to price alerts and to the account, and
every message contains a one-click unsubscribe link. The site never asks for an account for
anything that works without one.
```

### 9. Transport estimate — `opas-kuljetusarvio` / `guide-transport-estimate`

**fi title:** Miten kuljetuskustannus arvioidaan?

**en title:** How is the transport cost estimated?

**fi bodyMarkdown:**

```markdown
Kuljetus on oma rivinsä erittelissä. Arvio perustuu kuljetusliikkeiden julkaisemiin
hinta-aineistoihin: painoluokkiin (esimerkiksi paketti- ja lavakoot) kohdistetut julkaistut
hinnat määränpäänä Suomi — ei reaaliaikainen rahtitarjous.

Arvio muuttuu, kun muutat määrää tai määränpäätä, koska ne määräävät käytettävän painoluokan ja
reitin. Kuljetusrivillä on oma luotettavuusmerkintänsä, kuten kaikilla muillakin erittelyn
luvuilla.

Lopullinen lähetyskustannus riippuu valitsemastasi kuljetustavasta, palvelutasosta ja
lähetyskuvauksen tarkistuksesta. Siksi kuljetusrivi on arvio: se kertoo, mitä julkistettujen
hintojen perusteella on odotettavissa, ei mitä juuri sinun lähetyksesi maksaa.
```

**en bodyMarkdown:**

```markdown
Transport is its own line in the breakdown. The estimate is based on rate datasets published by
carriers: published prices applied to weight brackets (for example parcel and pallet sizes) with
Finland as the destination — not a real-time freight quote.

The estimate changes when you change the quantity or the destination, because those determine
the weight bracket and route used. The transport line carries its own reliability status, like
every other figure in the breakdown.

The final shipping cost depends on the carrier and service level you choose and on the checked
shipment details. That is why the transport line is an estimate: it states what to expect based
on published rates, not what your specific shipment will cost.
```

---

## Verification run in this environment

- **Content-policy lint (publish gate):** all 18 title+body pairs checked against the exact
  `FORBIDDEN_TERMS` list from `packages/core-domain/src/content/content-lint.ts`
  (word-boundary, case-insensitive) — zero violations; publish will not 400.
- **Slug schema:** all 18 slugs match the create schema's `^[a-z0-9]+(?:-[a-z0-9]+)*$` (ASCII,
  lowercase); all 18 (slug, locale) pairs unique.
- **Topic coverage:** the 8 required topics (landed cost, freshness, sources, tax inclusion,
  allowance limits, accuracy, cadence, account purpose) + 1 extra (transport estimate).
- **Homepage linkage (3.4):** verified the FAQ section renders links from the guides index for
  whatever is PUBLISHED (`page.tsx` → `getServerGuidesIndex`), so publishing the entries above is
  sufficient — no code change required.

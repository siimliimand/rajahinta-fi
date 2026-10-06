# Finnish copy glossary

Canonical terminology and register rules for all Finnish consumer-facing copy
(`apps/frontend/src/messages/fi.json` and any other Finnish surface). This doc is the
living source of truth for future copy; the decisions it operationalizes were confirmed
in `openspec/changes/fi-native-copy-pass/design.md` (D1–D5, user-confirmed 2026-10-06).

Applies to **Finnish consumer copy**. English has terminology parity but a deliberately
different register — see rule R4. Do not "fix" the asymmetry by mirroring.

## 1. Canonical terms

One term per concept. Inflect naturally like any Finnish noun — the table gives the
base form; compounds inflect on the final element (*tullivapaiden määriin*,
*aineiston versioon*).

| Concept | Canonical FI | EN counterpart | Replaced FI variants | Rationale |
|---|---|---|---|---|
| Drink demand | `juomatarve` | drink demand | `juonetarve` | Site already says *juomat* everywhere; the compound parses correctly |
| Basket feature | `Ostoskorilaskuri` | basket calculator | `Ostoskorioptimointori` | Parallels the *Matkalaskuri* / *Tilaisuuslaskuri* / *Skenaariolaskuri* naming family |
| Ranking page (title) | `Miten järjestys muodostuu` | how ranking works | `Miten järjestäminen toimii` | *Järjestys* = order of a list; *järjestäminen* = organizing an event |
| Ranking page (nav/footer slot) | `Järjestysperiaatteet` | ordering principles | `Miten järjestäminen toimii` | Short nav slot; same *järjestys* stem as the title |
| Allowance limits | `tullivapaat määrät` / `tullivapaa määrä` | duty-free allowances | `tullimäärärajat` (and inflections) | Tulli's official phrasing; already used on `/allowances`; one term everywhere |
| Ethanol unit price | `etanolin grammahinta` | ethanol unit price | `Etanoli-€/g`, `€/g-arvo` (prose) | One term and one unit everywhere; analog of the standard *litrahinta*. Display unit is `snt/g` (cents per gram of pure ethanol) |
| Price sort | `halvin ensin` | cheapest first | `matalin ensin` | Natural price phrasing; scope in §3.1 |
| Daily snapshot | `päivittäin päivitetty aineisto` | daily updated dataset | `materialisoitu tilannekuva`, `materialisoitu` (as dataset qualifier) | *Materialisoitu* is DB jargon; consumer register |
| Informational framing | `vain tiedoksi` | for information only | `tiedollinen` (and inflections) | Rare administrative word; *— ei neuvontaa* disclaimers keep their legal intent unchanged |
| Dataset version | `aineiston versio` | dataset version | `aineistoversio` (consumer copy) | Parses cleanly for consumers; compact form allowed only in technical dashboard labels — see §3.2 |

Unit rule (design D5): the computed value is €/g; `snt/g` is a ×100 display-only
conversion. Copy always states the **displayed** unit. Never render a `snt/g` figure
under a `€/g` unit label or vice versa. Compliance invariant: every rendered `snt/g`
figure equals exactly 100 × the API €/g value.

## 2. Register rules

**R1 — Consumer sentence first.** Open with the sentence the consumer needs; bring the
mechanism after. Ranking page: the consumer sentence already exists (*"Sama aineisto
tuottaa aina saman järjestyksen"*) — lead with it.

**R2 — Plain-but-precise mechanism.** The mechanism must be stated, in Finnish that a
non-engineer can parse. Engineering nouns must not appear as consumer labels. Banned
calques (all present in the pre-change methodology copy):

- *deterministinen* (as a badge/label) → state the fact in prose: *sama aineisto
  tuottaa aina saman järjestyksen*
- *Rajattu syöte* → *laskenta näkee vain välttämättömän tiedon*
- *Testeillä lukittu muoto* → keep the claim, phrase it as a sentence
- *Odottamattoman tiedon hylkäys* → *tuntematon kenttä hylätään, ei ohiteta hiljaisesti*

**R3 — Every enforcement/disclaimer fact survives a register rewrite.** A register fix
may never delete a checkable claim. These facts must remain stated in some form:

1. Bounded input: there is no field for paid placement, ad highlighting, seller
   scoring, or manual curation — a position cannot be bought.
2. Test-pinned shape: automatic tests lock the input shape; a silent change cannot ship.
3. Unknown-field rejection: an unexpected field causes rejection, not silent skipping.
4. Determinism: the same data always produces the same order.
5. Legal/informational disclaimers (*— ei neuvontaa*, *ei vero- tai tullineuvontaa*,
   *ei oikeudellista neuvontaa*) keep their legal intent verbatim even when the frame
   around them changes.

**R4 — FI/EN asymmetry is deliberate.** English methodology copy keeps spec-register
language (*deterministic*, *bounded input*) because that is conventional on English
methodology pages. Finnish does not. EN receives: unit unification (language-independent
bug), terminology parity (one term per concept), and wrong-word fixes — but not the FI
register rewrite. When editing one catalog, re-check the other only for terminology and
units, not register.

## 3. Scoping decisions

Design.md did not pin these two boundaries; they are recorded here so they are applied
consistently:

### 3.1 `halvin` vs `matalin`

`halvin ensin` replaces the price **sort option label** only. `matalin` remains correct
Finnish and stays where it does not name a price sort:

- Keep: sort labels naming a non-price magnitude, e.g. `Matalin kokonaiskustannus`
  (costs are *matalia* in Finnish; *halpa kustannus* is not idiomatic).
- Keep: price-level prose such as *matalin nykyinen myyntihinta* in the price-window
  strings — it describes a price level, not a sort option.
- Replace: any sort option ordering products by a price (*hinta*, *yksikköhinta*,
  *litrahinta*, *grammahinta*) — *halvin* is the natural comparative for prices.

### 3.2 `aineistoversio` exception

Consumer prose uses `aineiston versio`. The compact compound **may remain** in technical
dashboard labels only, e.g. `rateDatasetVersions` ("Verokanta-aineistoversiot"). The
data-changes page meta/subtitle are consumer copy and use the full form (reorder as
needed: *veroaineiston viralliset versiot*).

## 4. Before/after examples

Before-strings are quoted verbatim from `apps/frontend/src/messages/fi.json` (line
numbers at the time of writing — keys are stable, lines are not). After-forms follow
rules R1–R3; the implementing tasks set the exact final strings.

**E1 — Ranking page naming.** `SiteHeader.ranking`, `Nav.howRankingWorks`,
`SiteFooter.methodology`, `Ranking.title`, inline link in `aboutBody`.
- Before: `"Miten järjestäminen toimii"` (nav/title/footer); `…<link>miten järjestäminen toimii</link>.` (inline)
- After: title/metaTitle and page heading `Miten järjestys muodostuu`; nav and footer slots `Järjestysperiaatteet`; inline link text `järjestysperiaatteet`.
- Rule: one concept, two surface slots (§1); *järjestys* stem everywhere.

**E2 — Basket feature.** `SiteFooter.linkBasket`.
- Before: `"Ostoskorioptimointori"`
- After: `Ostoskorilaskuri`
- Rule: naming family *—laskuri* (§1).

**E3 — Drink demand.** `EventPage.metaTitle` (also subtitle, metaDescription, `taskCardsEventBody`).
- Before: `"Tilaisuuslaskuri: juonetarve ja ostoslista"`
- After: `Tilaisuuslaskuri: juomatarve ja ostoslista`
- Rule: *juomat* stem (§1).

**E4 — Allowance limits, singular/cap label.** trip `cap` label; trip error `title`.
- Before: `"Tullimääräraja (tulliton enintään)"`; `"Ei julkaistuja tullimäärärajoja"`
- After: `Tullivapaa määrä (tulliton enintään)`; `Ei julkaistuja tullivapaita määriä`
- Rule: Tulli phrasing, inflect the last element (§1).

**E5 — Allowance limits + dataset version, double fix.** allowances `allowanceVersion`.
- Before: `"Tullimäärärajojen aineistoversio: {version}"`
- After: `Tullivapaiden määrien aineiston versio: {version}`
- Rule: genitive family *tullivapaiden määri* + full form *aineiston versio* (§1, §3.2).

**E6 — Ethanol unit price, one term and one unit.** compare table `columnHeader`,
`columnEurPerGram`, `ValuePage.title`/`subtitle`, `linkValue`.
- Before: header `"€/g puhdasta etanolia"` over `snt/g` cells (unit contradiction); `"Etanoli-€/g"`; title `"Etanoli-€/g hintaluokittain"`; subtitle prose `…järjestetty €/g-arvon mukaan alimmasta alkaen.`; link `"Arvo (€/g alkoholi)"`
- After: header matches cell unit `snt/g puhdasta etanolia`; column `Etanolin grammahinta (snt/g)`; title `Etanolin grammahinta hintaluokittain`; prose `…grammahinnan mukaan alimmasta alkaen.`; link `Etanolin grammahinta (snt/g)`
- Rule: unit rule (§1); no mixed `Etanoli-€/g` header over `snt/g` cells, no `€/g-arvo` prose.

**E7 — Price sort.** compare `sortOptionLabel`.
- Before: `"Etanoli-€/g (matalin ensin)"`
- After: `Etanolin grammahinta (halvin ensin)`
- Rule: §3.1 scope + §1 term (example deliberately shows both fixes in one string).

**E8 — Daily snapshot.** `taskCardsSavingsBody`; savings metaDescription; value `emptyBody`.
- Before: `"Päivittäin materialisoitu luettelo arvioiduista kokonaishinnoista…"`; `…päivittäin materialisoituna. Tiedollinen luettelo.`; `"Tälle tuoteryhmälle ei ole vielä materialisoitunut yhtään riviä…"`
- After: `Päivittäin päivitetty luettelo arvioiduista kokonaishinnoista…`; `…päivittäin päivitettynä. Luettelo vain tiedoksi.`; `Tälle tuoteryhmälle ei ole vielä päivittynyt yhtään riviä…`
- Rule: consumer register for dataset freshness (§1).

**E9 — Informational framing.** value/savings `informationalNote`; guides meta strings.
- Before: `"Luettelo on tiedollinen: se esittää lasketut arvot sellaisenaan. …"`; `"Tiedolliset oppaat matkustamisesta…"`
- After: `Luettelo on vain tiedoksi: se esittää lasketut arvot sellaisenaan. …`; `Oppaat matkustamisesta… — vain tiedoksi, ei oikeudellista neuvontaa.`
- Rule: R3 — the "not advice" intent is preserved verbatim in intent; only the frame word changes.

**E10 — Register inversion (full example).** `Ranking` methodology keys (design D3).
- Before: badge `"Deterministinen: {value}"`; layer names `"Rajattu syöte"`, `"Testeillä lukittu muoto"`, `"Odottamattoman tiedon hylkäys"`; `enforcementP1` opens *"Järjestyksen laskenta vastaanottaa vain tiukasti rajatun syötteen…"*
- After: no badge — the determinism fact moves into prose (*sama aineisto tuottaa aina saman järjestyksen*); mechanism sentence first: *Laskenta näkee vain välttämättömän tiedon — kenttää maksulliselle sijoittelua varten ei ole olemassa*; the three layers keep their checkable claims (R3 facts 1–3) as sentences, without the engineering-noun labels. No key is added or removed.
- Rule: R1 + R2 + R3 together; EN keeps *deterministic*, *bounded input* (R4).

## 5. Adding new copy — checklist

1. **Glossary first.** Reuse a term from §1 before coining one. One term per concept;
   no colloquial variants (no *tuliaisrajat*), no second synonym for the same thing.
2. **metaTitles included.** Canonical terms apply to SEO surfaces too — `metaTitle`,
   `metaDescription`, and open-graph strings are copy, not an afterthought.
3. **Inflect naturally.** Compounds inflect on the final element; do not quote the base
   form where a case is needed.
4. **Register check.** Consumer sentence first; mechanism second, in plain Finnish; no
   engineering nouns as labels (R2); every enforcement/disclaimer fact still stated (R3).
5. **Unit check.** Copy states the displayed unit (`snt/g`); never mix units between a
   header and its cells.
6. **Language pairing.** EN mirrors terminology and units, not register (R4).
7. **Vocabulary lint.** No promotional adjectives (*paras*, *suosituin*, *edullisin
   valinta*). Factual/comparative words are fine — *halvin*, *alimmasta alkaen* describe
   ordering, they do not promote. Run the content-vocabulary lint mentally before
   committing; task 6.1 runs it over the changed copy.
8. **Pinned tests.** Exact-string tests pin several of these strings. If you change a
   string, grep for the pinned test asserting it and update both in the same commit.

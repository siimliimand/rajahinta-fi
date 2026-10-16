# Verified facts — 2026 tax-change calendar (task 1.1)

Verification performed 2026-10-15 against official sources (vero.fi, alko.fi, emta.ee/riigiteataja.ee, valtioneuvosto.fi, eduskunta.fi/finlex.fi). Each planned seed row's date/figures below carry a citable URL. Quoted wording is verbatim from the cited official page.

Method note: vero.fi and emta.ee pages were fetched directly. alko.fi and valtioneuvosto.fi block automated fetches (HTTP 403); their wording was verified from the search-engine-indexed official pages and, for Alko, from the STT Info–distributed copies of the same releases (publisher: Alko Oy). STT release timestamps were used to date Alko announcements.

## Seed-row summary

| # | eventType | Status | Date / window |
|---|---|---|---|
| 1 | `FI_EXCISE_CHANGE` | CONFIRMED | 2026-01-01 |
| 2 | `EE_EXCISE_CHANGE` | CONFIRMED | 2026-01-01 |
| 3 | `ALKO_PRICE_LIST` (spring) | EXPECTED | late March 2026 (end-of-March window) |
| 4 | `ALKO_PRICE_LIST` (autumn) | EXPECTED | late September 2026 (end-of-September window) |
| 5 | `TAX_TABLE_PUBLICATION` | CONFIRMED | 2026-08-06 |
| 6 | `RATE_DECISION` | EXPECTED | 2026-Q4 (entry into force 2027-01-01) |

---

## 1. FI_EXCISE_CHANGE — CONFIRMED, 2026-01-01

- **Event:** Finnish alcohol excise change in force 1.1.2026–31.12.2026: a legislated ~9 % increase for wines and ciders on top of a 1.4 % HICP index adjustment; all drinks above 2.8 vol% permanently tied to the HICP.
- **Verified figures (2026 table, vero.fi):**
  - Wines and other fermented beverages >8–15 vol%: **504.97 snt/l** (2025: 456.00 → total +10.7 %, of which +1.4 % index and ~+9 % legislated increase)
  - Wines >15–18 vol%: **504.97 snt/l**
  - Ethyl alcohol >10 vol%: **56.28 snt/cl** (2025: 55.50 → +1.4 %, pure index adjustment)
  - Beer >3.5 vol%: 36.71 snt/cl (2025: 36.20 → +1.4 %); intermediate products 575.95 / 886.24 snt/l
  - Sub-change within 2026: fermented beverages >1.2–2.8 vol% rise 36 → 50 snt/l on 2026-04-01 (same table; not a separate seed row — affects only the ≤2.8 % group)
- **Verified official wording:**
  - vero.fi: "The 2026 excise duty on alcohol is to be paid in accordance with the excise duty table" (table period "1.1.2026–31.12.2026").
  - alko.fi (16.12.2025): "Eduskunta on hyväksynyt osana valtion vuoden 2026 tulo- ja menoarviota hallituksen esityksen, jonka mukaan viinien ja siidereiden valmisteveroa korotetaan keskimäärin yhdeksällä prosentilla. Lisäksi kaikkien yli 2,8-tilavuusprosenttisten alkoholijuomien alkoholi- ja alkoholijuomavero sidotaan pysyvästi yhdenmukaistetun kuluttajahintaindeksin toteutuneisiin muutoksiin. Veromuutos on 1,4 prosenttia vuonna 2026."
  - valtioneuvosto.fi (year-end changes release): "Viinien ja muiden käymisteitse valmistettujen juomien, kuten siiderien, alkoholiveroa korotetaan noin yhdeksän prosenttia, ja alkoholijuomien valmistevero indeksoidaan."
- **Official sources:**
  - 2026 duty table (figures): https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/Excise-duty-table-for-alcohol-and-alcoholic-beveragesoholijuomaverotaulukko/
  - Government statement (~9 % + index): https://valtioneuvosto.fi/-/10623/vuodenvaihteessa-voimaan-tulevia-muutoksia-valtiovarainministerion-hallinnonalalla
  - HICP linkage in force 1.1.2026 (Ministry of Finance): https://vm.fi/alkoholiverotus
  - Government proposal for the 2026 table (456.00 → 504.97): https://www.finlex.fi/en/government-proposals/2025/95 (parliamentary record: https://www.eduskunta.fi/valtiopaivaasiakirjat/HE+95/2025 — est. revenue +≈38 M€/yr)
- **Correction to proposal claim:** "~9 % rise" is the legislated wine/cider-only increase; the total 2026 rise for those products is ~10.7 % (9 % increase + 1.4 % index). Spirits/beer rose by the index (1.4 %) only.
- **Consumer impact (verified, for FI/EN summary copy):** Alko prices rose on average ~1 % from 1.1.2026; tax per 0.75 l wine bottle +0.46 €, tax per 1 l strong alcoholic drink +0.45 € (Alko release, source URL in row 3).

## 2. EE_EXCISE_CHANGE — CONFIRMED, 2026-01-01

- **Event:** Estonian alcohol excise rose 10 % on all categories on 1 January 2026 (the previously scheduled 5 % step plus an additional 5 % fiscal measure). Further 5 % steps are legislated for 2027 and 2028 (context only, not 2026 seed rows).
- **Verified figures (EMTA excise duty rate table, page last updated 10.09.2026):**
  - Beer: 14.00 → **15.40 €** per hl per vol% (exactly +10 %)
  - Fermented beverage / wine ≤ 6 vol%: 69.84 → **76.82 €/hl** (+10 %)
  - Fermented beverage / wine > 6 vol%: 162.97 → **179.27 €/hl** (+10 %)
  - Intermediate products: 319.00 → **350.90 €/hl** (+10 %)
  - Other alcohol (incl. spirits): 20.74 → **22.81 €** per hl per vol% (+10 %)
- **Official sources:**
  - Rate table: https://www.emta.ee/en/business-client/taxes-and-payment/excise-duties/alcohol
  - Statutory rates (§ 46, Alcohol, Tobacco, Fuel and Electricity Excise Duty Act): https://www.riigiteataja.ee/en/akt/530062023006?leiaKehtiv#para46
  - Corroboration (ERR News overview, Dec 2025): "Starting January 1 [2026] … alcohol excise rising by … 10 percent": https://news.err.ee/1609893193/overview-2026-excise-duties-and-other-tax-changes
- **Could not be verified:** the consumer examples "0.5 l beer +~10 snt" and "a spirits bottle +~30 snt" appear in no official source; computed from the official rates above, a 0.5 l 5 % beer bears ~+3.5 snt excise (~4.3 snt with VAT) and a 0.5 l 40 % spirits bottle ~+41 snt excise. Seed copy must not use the +10 snt / +30 snt figures.

## 3. ALKO_PRICE_LIST (spring 2026) — EXPECTED, window late March 2026

- **Event:** Alko's spring price-list switch (jaksovaihdos).
- **Status rationale:** Alko's official rhythm statement: "Alkossa vähittäismyyntihinnat muuttuvat kaksi kertaa vuodessa … Normaalisti nämä jaksovaihdokset ajoittuvat maalis- ja syyskuun loppuun." No dated official announcement for the spring 2026 switch was found, so the row is seeded EXPECTED with the official end-of-March window (ops path upgrades to CONFIRMED if a dated announcement surfaces).
- **Official source URL (mandatory, rhythm statement):** https://www.alko.fi/fi/alko-oy/uutishuone/verotusmuutokset-2026 (16.12.2025 release; also states suppliers may adjust prices at year end by at most the tax-change amount — the 1.1.2026 pass-through is covered by row 1, not this row)
- **Note:** the historical "syksyn hinnanmuutos … 26. syyskuuta" release often surfaced in searches is dated 27.9.2023 (https://www.sttinfo.fi/tiedote/70028299/alkon-hinnat-nousevat-syksyn-hinnanmuutosten-yhteydessa-maltillisesti?publisherId=1631&lang=fi) — it is NOT a 2026 fact and must not be cited for 2026.

## 4. ALKO_PRICE_LIST (autumn 2026) — EXPECTED, window late September 2026

- **Event:** Alko's autumn price-list switch (jaksovaihdos).
- **Status rationale:** same official twice-yearly rhythm statement (end of March / end of September). No dated official announcement of an autumn 2026 switch was found as of 2026-10-15 — Alko's latest newsroom items (Q3/2026 sales release 14.10.2026, https://www.sttinfo.fi/tiedote/72408468/alkon-q3-myynti-punaviini-yllatti-ja-sunnuntaista-tuli-uusi-ostospaiva?publisherId=1631) contain no price-change announcement. Seeded EXPECTED; ops edit upgrades to CONFIRMED when announced.
- **Official source URL (mandatory, rhythm statement):** https://www.alko.fi/fi/alko-oy/uutishuone/verotusmuutokset-2026

## 5. TAX_TABLE_PUBLICATION — CONFIRMED, 2026-08-06

- **Event:** Verohallinto published its decision confirming the 2027 alcohol excise rates (index-adjusted).
- **Verified facts:**
  - vero.fi news: "Vuodesta 2027 alkaen Verohallinto vahvistaa veron määrän Verohallinnon päätöksellä. Päätös julkaistiin 6.8.2026."
  - Decision record: Antopäivä **6.8.2026**, diaarinumero **VH/4545/00.01.00/2026**, voimassaolo 1.1.2027 – toistaiseksi; issued under alkoholi- ja alkoholijuomaverolaki (1471/1994) 4 § 2 mom. as amended by laki 1051/2025.
  - Verified 2027 figures from the decision: wine/fermented >8–15 % and >15–18 %: **515.22 snt/l**; ethyl alcohol >10 %: **57.42 snt/cl**; beer >3.5 %: 37.46 snt/cl; fermented >1.2–2.8 %: 51.02 snt/l.
  - vero.fi also states the duty table valid from 1.1.2027 will be posted on the table page "at the end of 2026" — this is the verifiable core of the original "year-end publication" rhythm claim; the decision itself is already a dated, confirmed publication.
- **Official sources:**
  - Decision (publication + figures): https://www.vero.fi/syventavat-vero-ohjeet/paatokset/371142/verohallinnon-paatos-alkoholi-ja-alkoholijuomaveron-maarasta
  - News page (publication date statement): https://www.vero.fi/tietoa-verohallinnosta/uutishuone/verotuksen_muutoksia/valmisteverotuksen-muutoksia-1.1.2027
  - Table page (year-end posting statement): https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-alcohol-and-alcoholic-beverages/Excise-duty-table-for-alcohol-and-alcoholic-beveragesoholijuomaverotaulukko/
- **Correction to proposal claim:** "Verohallinto publishes next year's table at year end" is imprecise — the 2027 decision was published 6 August 2026; only the table-page posting is a year-end event per vero.fi.

## 6. RATE_DECISION (2027) — EXPECTED, window 2026-Q4, effective 2027-01-01

- **Event:** Parliamentary decision on government bill HE 172/2026 vp, which would set a new statutory tax table in force 1.1.2027, on top of the Verohallinto-confirmed index rates.
- **Verified facts:**
  - vero.fi news (page updated 14.10.2026): "Hallitus esittää alkoholiveroa korotettavaksi keskimäärin noin 4,5 prosenttia. Korotus kohdistuisi pääosin yli 5,5 tilavuusprosenttia alkoholia sisältävien juomien valmisteveroon. Korotus ei kuitenkaan koskisi olutta eikä etyylialkoholijuomaryhmän enintään 10-tilavuusprosenttisia juomia, kuten long drink -juomia." / "Korotus tehtäisiin Verohallinnon vuodelle 2027 vahvistamien indeksitarkistettujen verotasojen päälle." / "Laki ja lain liitteenä oleva verotaulukko tulisi voimaan 1.1.2027." / "Päätös kuitenkin kumoutuu, kun alkoholiverolaissa säädetään uusista verotasoista."
  - Bill record (eduskunta): increase of **2.20 € per litre of pure alcohol**, average **≈ 4.5 %**; tied to the 2027 budget; the draft states wines/fermented would rise 5.0 %.
  - As of 2026-10-15 the bill is still phrased by vero.fi as a proposal → seed EXPECTED; ops edit to CONFIRMED once enacted.
- **Official sources:**
  - vero.fi news page (wording above): https://www.vero.fi/tietoa-verohallinnosta/uutishuone/verotuksen_muutoksia/valmisteverotuksen-muutoksia-1.1.2027
  - HE 172/2026 vp (parliamentary record): https://www.eduskunta.fi/valtiopaivaasiakirjat/HE+172/2026 (document link from vero.fi: https://www.eduskunta.fi/asiat-ja-aanestykset/valtiopaivaasiat/asiakirjat/edktunnus/EDK-2026-AK-45809)
  - Government decision to submit (VM/2026/164): https://valtioneuvosto.fi/paatokset/paatos?decisionId=7014
- **Correction to proposal claim:** "From 2027 rates are confirmed by government decision" is wrong on the authority — vero.fi: "Starting in 2027, an official decision by the **Tax Administration** will determine the duties" (Verohallinto, already issued 6.8.2026). The government/parliament role in 2026 is the separate statutory table change (HE 172/2026) that would supersede it.

---

## Explicitly unverified (do not seed)

- EE consumer examples "0.5 l beer +~10 snt", "spirits bottle +~30 snt" — no official source found; official-rate arithmetic differs (row 2).
- Exact dates of Alko's 2026 spring/autumn jaksovaihdokset — no dated official announcements exist; seeded as EXPECTED windows per the official rhythm statement (rows 3–4).
- All other proposal figures (9 %, 1.4 %, ~1 %, +0.46 €, +0.45 €, 504.97 snt/l, 56.28 snt/cl, +10 % EE, twice-yearly Alko rhythm, 2027 decision mechanism) — verified above with citations.

# Change notes: import-filing-assistant — Stage 0 domain-verification spike (task 1.1)

- Performed: 2026-10-10 (access date for all sources below)
- Branch: `feature/import-filing-assistant`
- Scope: verify the four load-bearing process facts against vero.fi (primary;
  English-language vero.fi pages used for cross-check; one Verohallinto
  detailed-guidance reference for penalty context). No tulli.fi source was
  needed: every fact resolved on vero.fi. No forum or blog sources used.
- Method note: each finding records the verbatim Finnish original (and the
  official English rendering where the page has one), the exact URL, the page's
  own last-updated stamp, and a verdict. Pages stamped 2024–2026 reflect the
  current (post-1.9.2024 / post-1.1.2026) regime; no page displayed a sunset
  or upcoming-change notice affecting these four facts.

## Sources

| # | Page | URL | Page last updated |
| - | ---- | --- | ----------------- |
| S1 | Ennakkoilmoitus – Yksityishenkilö (FI) | https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/ennakkoilmoitus---yksityishenkil%C3%B6/ | 11.12.2025 |
| S2 | Advance notice – individuals (EN mirror of S1) | https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/arriving_in_finland/bringing-alcohol-and-tobacco-to-finland/advance-notice-private-individual/ | 11.12.2025 |
| S3 | Ilmoitus- ja maksuohjeet alkoholi- ja tupakkatuotteille (FI) | https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/ilmoitus--ja-maksuohjeet-alkoholi--ja-tupakkatuotteille/ | 18.5.2026 |
| S4 | Usein kysyttyä alkoholin nettitilaamisesta (FI) | https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/usein-kysytty%C3%A4-alkoholin-nettitilaamisesta/ | 14.4.2025 |
| S5 | Näin annat ennakkoilmoituksen ja maksat kertaluonteisen vakuuden – henkilöasiakas (FI) | https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/n%C3%A4in-annat-ennakkoilmoituksen-ja-asetat-kertaluonteisen-vakuuden---henkil%C3%B6asiakas/ | 12.9.2024 |
| S6 | Alkoholin tilaaminen ulkomailta (FI) | https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/netista_tilaaminen/ | 19.3.2026 |
| S7 | Verohallinnon ohje "Seuraamusmaksut oma-aloitteisessa verotuksessa" (2020/1215, superseded) | https://www.edilex.fi/virallistieto/verohallinnon_ohjeet/2020_1215.html | in force 1.1.2021–31.12.2023; the page itself states it is replaced by VH/2950/00.01.00/2023 |

---

## Fact 1 — Guarantee (vakuus) rule

**Question:** is the private-person guarantee equal to the calculated tax
amount, or a separate fixed schedule?

**Evidence.**

S1 (FI, "Mikä on ennakkoilmoitus?"):

> "Ennakkoilmoituksessa ilmoitat tuotteiden arvioidun vastaanottopäivän,
> tuotteiden määrän ja tuoteryhmän Verohallinnolle. Samalla saat tiedon
> vakuuden määrästä ja maksettavasta valmisteverosta (esimerkiksi
> tupakkaverosta tai alkoholiverosta). **Vakuuden määrä on sama kuin
> valmisteveron määrä.** Ennakkoilmoitus jää veroilmoituksen pohjaksi.
> Vakuus käytetään myöhemmin valmisteveroihin."

Gloss: "The amount of the guarantee is the same as the amount of the excise
duty. The advance notice remains as the basis of the excise return. The
guarantee is later used for the excise duties."

S2 (EN, same section):

> "The amount of the guarantee is equal to the amount of the excise duty. …
> The guarantee will be later used for the excise taxes."

S5 (FI, MyTax walkthrough):

> "**OmaVero laskee useimmissa tapauksessa vakuuden määrän automaattisesti.**
> Jos annat ennakkoilmoituksen paperilomakkeella, laske ja ilmoita tuotteen
> vakuudeksi tarvittava summa euroina. **Vakuuden määrä on sama kuin
> tuotteesta maksettavaksi tulevan valmisteveron määrä.**"

Gloss: "In most cases MyTax calculates the guarantee amount automatically …
The guarantee amount is the same as the excise duty that will become payable
on the products." (On paper, the filer computes it themselves from the tax
tables.)

S4 (FI, FAQ §2):

> "Verovelvollisen, eli etämyynnissä myyjän ja etäostossa ostajan, pitää
> tehdä tilauksesta ennakkoilmoitus ja maksaa vakuus Verohallinnolle ennen,
> kun tilaus lähetetään Suomeen. **Vakuus vastaa käytännössä valmisteveron
> määrää.**"

S3 (FI, step 1):

> "Sinun pitää tehdä tilauksestasi tai lähetyksestäsi ennakkoilmoitus ja
> maksaa alkoholijuomaveroa ja tupakkaveroa vastaava vakuus ennen kuin
> tuotteet lähetetään Suomeen."

**Scope nuance (load-bearing for D3):** the guarantee covers the harmonised
excises only — for our domain, the alcohol beverage duty. The packaging duty
carries no guarantee:

S1 (FI):

> "Vakuus pitää asettaa alkoholi- ja tupakkatuotteista. Virvoitusjuomista,
> juomapakkauksista, savukepaperista ja sähkösavukenesteistä ei tarvitse
> maksaa vakuutta."

S3 (FI): "Muistathan tehdä ennakkoilmoituksen myös juomapakkausverosta.
Juomapakkausverosta ei tarvitse maksaa vakuutta."

**Guarantee is a prepayment, not an extra cost.** S3 (FI, step 3):

> "Jos maksamasi vakuus ei riitä kattamaan ilmoittamaasi veroa, sinun on
> maksettava verosta puuttuva määrä. … Jos vakuutta on maksettu liikaa,
> palautamme sinulle liikaa maksetun osuuden takaisin."

**VERDICT: VERIFIED** — the guarantee equals the calculated excise duty
(alcohol); MyTax derives it from the filing data. It is later credited
against the duty (shortfall payable, overpayment refunded), not a penalty or
additional charge.

**Design resolution:** D3 branch **(a) pure function**. The pure function's
input is the existing alcohol excise result **only** — the container-duty
result is excluded, because juomapakkausvero carries no guarantee. This
concretises design.md D3's "security equals the calculated tax": it is the
calculated *alcohol* excise, not excise + packaging. The figure carries the
underlying reliability status; no versioned dataset needed; no plausible
fallback.

---

## Fact 2 — Notice structure: alcohol vs packaging

**Question:** must alcohol excise and the beverage-packaging duty be filed as
two separate advance notices, or one combined filing?

**Evidence.** Both language versions state it explicitly, under the
"If you forget to file an advance notice" heading:

S1 (FI, "Jos ennakkoilmoitus unohtuu"):

> "Huomaathan, että esimerkiksi alkoholiveroon ja virvoitusjuomaveroon
> liittyy usein juomapakkausvero. Siitäkin pitää tehdä ennakkoilmoitus.
> **Sinun pitää siis tehdä kaksi erillistä ennakkoilmoitusta.**
> Juomapakkauksista ei kuitenkaan tarvitse maksaa vakuutta."

Gloss: "Note that alcohol duty and soft-drink duty are often accompanied by
beverage-packaging duty. An advance notice must be filed for that too. **You
must therefore file two separate advance notices.** However, no guarantee is
required for beverage packagings."

S2 (EN, "If you forget to file an advance notice"):

> "Please note that if you are liable to pay excise duty on alcohol or soft
> drinks, you may additionally have to pay excise duty on beverage
> containers. You must file an advance notice on the beverage containers as
> well. **In other words, you must file two separate advance notices.**
> However, you do not have to set a guarantee for the beverage containers."

S3 (FI, worked example):

> "**Esimerkki.** Olet lomamatkalla Ranskassa … Tee OmaVerossa
> **ennakkoilmoitukset** alkoholista ja juomapakkauksista ja maksa
> alkoholiveron suuruinen vakuus ennen tuotteiden lähettämistä. Merkitse
> sitten OmaVerosta saamasi **valmisteveronumerot** postipaketin päälle."

Gloss: plural "ennakkoilmoitukset" (advance notices) for alcohol and for
beverage packagings; plural "valmisteveronumerot" (excise numbers) to be
marked on the parcel — consistent with one notice/number per duty.

S4 (FI, FAQ §6) — two distinct duties for ordered alcohol:

> "Ulkomaisesta verkkokaupasta ostetusta alkoholista pitää maksaa kahta
> valmisteveroa eli alkoholijuomaveroa ja juomapakkausveroa. … Juomapakkausvero
> on 0,51 euroa litralta."

S1 (FI, product-list framing): "Ennakkoilmoitus pitää antaa esimerkiksi
alkoholista ja alkoholijuomista, tupakkatuotteista …, virvoitusjuomista,
juomapakkauksista" — advance notice is per product group.

**VERDICT: VERIFIED** — two separate advance notices for the private
self-arranged import: one for alcohol, one for beverage packagings. The
packaging notice needs no guarantee. vero.fi itself places this reminder in
the "if you forget" section, which corroborates the pitch's premise that it
is commonly missed (the premise is plausible framing, the factual claim —
two notices — is verbatim-confirmed).

**Design resolution:** Notices branch **two filings → checklist shows both,
cited**. The packaging-notice step is added to the MyTax entry checklist with
the S1/S2 citation; the guide copy may say the packaging notice is "often
missed" only as observed framing (vero.fi's own reminder), never as a
statistic.

---

## Fact 3 — Reference-number (valmisteveronumero) lifecycle

**Question:** when is the MyTax reference number issued, and when must it be
passed to the carrier?

**Evidence.** The identifier is a separate object from the notice and from
the guarantee's payment reference. It becomes available only after the
guarantee payment is received:

S3 (FI, "Valmisteveronumero kuljetusta varten"):

> "Kun tilaat tai lähetät itsellesi alkoholia tai tupakkaa ja järjestät itse
> niiden kuljetuksen, sinun on annettava kuljetusyrittelle tai tuotteiden
> kuljettajalle Verohallinnolta saamasi kuljetuksen yksilöivä tunniste eli
> valmisteveronumero. Jos lähetät tuotteet postilla, merkitse
> valmisteveronumero postipaketin päälle. Valmisteveronumero on kuljetuksen
> aikana pyydettäessä esitettävä Tullille tai Verohallinnolle. Jos saat
> useamman valmisteveronumeron, anna ne kaikki kuljettajalle tai merkitse ne
> kaikki postipakettiin.
>
> **Löydät valmisteveronumeron Omaverosta kohdasta Ennakkoilmoitukset, kun
> olet maksanut lähetyksestä vakuuden Verohallinnolle.**"

Gloss: "You find the excise number in MyTax under Advance notices **when you
have paid the guarantee** for the consignment." The self-arranging buyer must
give the number to the transport company/driver, or mark it on the postal
parcel; it must be presented to Customs or the Tax Administration on request
during transport; **if several numbers are received, all must be passed on**.

S3 (FI, paper-form variant — confirms the trigger is guarantee receipt, not
filing):

> "Ilmoitamme sinulle vakuuden määrän ja tilinumeron. Maksa vakuus
> Verohallinnon tilille. **Kun olemme vastaanottaneet vakuuden,
> vahvistamme tilauksellesi tai lähetyksellesi valmisteveronumeron.**"

S4 (FI, FAQ §3):

> "Valmisteveronumero löytyy OmaVerosta kohdasta Ennakkoilmoitukset, kun
> lähetyksestä on maksettu valmisteverojen suuruinen vakuus Verohallinnolle.
> Tunniste on kuljetuksen aikana pyydettäessä esitettävä Tullille tai
> Verohallinnolle."

**Timing detail for the dated checklist.** S5 (FI):

> "Valmisteveron kertaluonteinen vakuus maksetaan vakuuden yksilöidyllä
> viitteellä ja samalle Verohallinnon pankkitilille kuin esimerkiksi
> arvonlisävero. Viitenumero ja pankkitili näkyvät OmaVerossa. **Maksu näkyy
> OmaVerossa 1–2 arkipäivän kuluttua.**"

Gloss: the guarantee is paid against its own dedicated payment reference
(distinct from the valmisteveronumero); payment becomes visible in MyTax in
1–2 business days — a practical lag between filing and having the transport
identifier in hand.

**Validity scope.** The business-facing page for the same mechanism states
the number is single-use per consignment ("When you have filed the advance
notice and paid the guarantee, MyTax assigns you a personal excise duty
number. The excise duty number is valid only once and only for a specific
consignment." — vero.fi business pages, corroborating; the individual pages
express the same via "kertaluonteinen"/per-consignment filing and the plural
"Jos saat useamman valmisteveronumeron…").

**VERDICT: VERIFIED** — the number is **issued after the guarantee payment**
(not at filing, not at the tax decision), visible under "Ennakkoilmoitukset"
in MyTax; the buyer must pass it to the carrier (or mark the parcel) so it is
available for the transport — i.e. before dispatch/transport begins, since
the notice and guarantee are themselves due "ennen tuotteiden lähettämistä
tai kuljetuksen aloittamista" (S1: "Ennakkoilmoitus pitää antaa ennen
tuotteiden lähettämistä tai kuljetuksen aloittamista … Myös vakuus pitää
maksaa ennen tuotteiden lähettämistä tai kuljetuksen aloittamista."). There
may be several numbers; all must be passed on.

**Design resolution:** Reference-number branch **"issued later → step shows
the verified point"**. Checklist order: file notices → pay guarantee →
number appears under Ennakkoilmoitukset (payment visible 1–2 business days)
→ pass all numbers to the carrier / mark parcel, before dispatch.

---

## Fact 4 — Penalty mechanics for a missed or late advance notice

**Question:** what actually happens if the advance notice is missed or late?

**Evidence — what is citable.** S1 (FI, "Jos ennakkoilmoitus unohtuu"):

> "Jos jätät ennakkoilmoituksen tekemättä, **seurauksena voi olla
> laiminlyöntimaksu**."

S2 (EN): "If you fail to file an advance notice, you may have to pay a
negligence penalty later."

Gloss: failing to file the advance notice *may* result in a negligence
penalty (laiminlyöntimaksu). Note the official hedge: "voi olla" / "may" —
it is a possible, discretionary-seeming consequence, and the individual
pages give **no amount, range, or computation basis** for it in this case.

**Evidence — what is bounded (no penalty, distance-selling default).**
S4 (FI, FAQ §5):

> "**Jos etämyyjä on laiminlyönyt velvollisuutensa, ja valmisteverot tulevat
> myös minun maksettavakseni, joudunko maksamaan lisäksi veronkorotusta?**
> Verovastuun lisäksi myyjän laiminlyönneistä ei kuitenkaan tule ostajalle
> muita seuraamuksia, kuten laiminlyöntimaksua tai veronkorotusta."

Gloss: when a distance *seller* defaults and the buyer becomes jointly
liable, no negligence penalty or tax increase is imposed on the buyer. (This
is the joint-liability scenario of 1.9.2024, S1/S6 — not the
self-arranged-import scenario, but it shows the penalty is not an automatic
"on top of the duty" add-on in all paths.)

**Evidence — what the detailed regime covers.** The late-filing fee
(myöhästymismaksu) and tax-increase (veronkorotus) mechanics found in the
Tax Administration's detailed guidance on own-initiative taxation (OVML,
768/2016) attach to **excise returns** (veroilmoitus) and other
own-initiative-tax obligations — S7 documents e.g. "Päiväkohtaista
myöhästymismaksua määrätään kolme euroa jokaiselta päivältä … 135 euroa (45
pv) … lisättynä kahdella prosentilla … enintään 15 135 euroa" and the OVML 39
§ negligence fee "enintään 5 000 euroa" for non-tax-reporting failures. S7 is
the superseded 2020/1215 version (in force 2021–2023, replaced by
VH/2950/00.01.00/2023 per the page itself). **Crucially, neither the
individual-facing pages (S1–S6) nor the cited guidance maps the private
person's missed *advance notice* to a specific fee amount or schedule**; the
only advance-notice-specific consequence named for individuals is the hedged
laiminlyöntimaksu.

Separately, the excise **return** deadline and its consequences are citable
(S3, step 3): "Anna veroilmoitus ja maksa valmisteverot viimeistään
tuotteiden vastaanottopäivää seuraavan kuukauden 12. päivänä." — the return
and payment are due on the 12th of the month following receipt; this is a
different obligation from the advance notice.

**VERDICT: PARTIAL** — the *name* of the consequence (laiminlyöntimaksu /
negligence penalty) and its hedged possibility are verbatim-citable for the
missed advance notice. Exact mechanics (amounts, thresholds, discretion
criteria, and any late-filing-notice analogue) are **not** stated on
individual-facing vero.fi pages; no assertion about them may be built.

**Design resolution:** Penalties branch **partially citable**. The
post-deadline state may *name* "laiminlyöntimaksu (a negligence penalty)"
hedged as a possible consequence, with the S1/S2 citation — nothing
quantitative, nothing about myöhästymismaksu/veronkorotus for the advance
notice, and no automatic-"penalty on top of the duty" phrasing. Everything
beyond the named, hedged consequence stays at "verify your obligations with
official sources" (design.md D4 register).

---

## Pitch-contradiction flags

1. **"Finnish Customs" — CONTRADICTED.** The advance notice, the guarantee,
   and the transport identifier are all handled by **Verohallinto (the
   Finnish Tax Administration) in OmaVero/MyTax** (S1–S6 passim, e.g. S4:
   "maksaa vakuus Verohallinnolle"; S3: "Verohallinto/valmisteverotus, PL
   20, 00052 VERO"). Customs (Tulli) appears only as the authority that may
   *check* the valmisteveronumero during transport (S3/S4). Guide and panel
   copy must say Finnish Tax Administration / MyTax, never Customs, for the
   filing act. (The module's existing MyTax link is already correct.)
2. **"Two separate notices" — CONFIRMED**, verbatim (S1/S2: "kaksi
   erillistä ennakkoilmoitusta" / "two separate advance notices"). Not a
   contradiction; the packaging-notice step is buildable with citation.
3. **"One-time reference number you have to pass on to the carrier" —
   CONFIRMED with two refinements.** (a) It is not issued at filing: it
   appears only after the guarantee payment is received (S3/S4/S5; payment
   visible in 1–2 business days). (b) "One number" undercounts: there may be
   several (one per notice), and **all** must be passed to the carrier or
   marked on the parcel (S3). The number is consignment-specific.
4. **"Penalty on top of the duty" — HEDGED, do not assert.** The only
   individual-facing consequence for a missed notice is a *possible*
   negligence penalty, officially unquantified (S1/S2). The guarantee is a
   prepayment of the duty, not an extra charge (S1/S3). Penalty phrasing
   must stay hedged and citation-bound (see Fact 4 resolution).

## Bonus verified facts (usable by Stage 1 with citation)

- **90-day window:** "Vastaanottopäivän pitää olla 90 päivän kuluessa
  ennakkoilmoituksen antamisesta. Päivä ei voi olla menneisyydessä." (S5) —
  the estimated receipt date must fall within 90 days of filing and cannot
  be in the past; constrains the checklist/dispatch-date validation.
- **Excise return deadline:** return and payment due by the 12th of the
  month following receipt (S3, with worked examples) — distinct from the
  advance-notice-before-dispatch deadline; relevant to the dated walkthrough's
  post-receipt phase.
- **Packaging duty rate:** "Juomapakkausvero on 0,51 euroa litralta
  valmista juomaa." (S3; same 0,51 €/l in S4 with worked examples) — current
  2026 figure, citable where the packaging-notice step appears.
- **Cancellation:** "OmaVerossa tehdyn ennakkoilmoituksen voi peruuttaa 14
  päivän kuluessa, jos ennakkoilmoituksen yhteydessä ei ole asetettu
  vakuutta." (S5).
- **Advance notice feeds the return:** "Ennakkoilmoitus jää veroilmoituksen
  pohjaksi" / "Ennakkoilmoitus toimii veroilmoituksen pohjana" (S1/S3).
- **Joint liability (distance selling), effective 1.9.2024:** if the
  distance seller filed no notice and paid no guarantee, the buyer is liable
  for the duties together with the seller, the buyer files no return, and
  identical tax decisions are sent to both (S1, S6). No penalty attaches to
  the buyer in this path (S4 FAQ §5).

## Contingency resolutions (design.md, "Contingency branches")

| Fact | Resolution | Branch taken | Key citations |
| ---- | ---------- | ------------ | ------------- |
| Guarantee | Equal to the calculated alcohol excise duty; MyTax computes it; prepayment credited against the duty; **excludes** juomapakkausvero (no guarantee for packaging) | **D3a — pure function** over the existing excise result (alcohol only), reliability-status-carrying, no fallback | S1, S2, S3, S5 |
| Notices | Two separate advance notices, verbatim-confirmed; packaging notice carries no guarantee | **two filings → checklist shows both, cited**; pitch confirmed | S1, S2, S3, S4 |
| Reference number | Issued after guarantee payment (visible in MyTax under Ennakkoilmoitukset; payment shows 1–2 business days), then passed to carrier / marked on parcel before dispatch; possibly several, pass all | **issued later → step shows the verified point** (post-guarantee-payment) | S3, S4, S5 |
| Penalties | Missed notice → possible laiminlyöntimaksu, named and hedged; amounts/mechanics not given for this case; no penalty for the buyer in the distance-selling default path | **partially citable** — post-deadline copy may name laiminlyöntimaksu hedged; otherwise stays at "verify with official sources" | S1, S2, S4, S7 (context only) |

Stage-1 gate per D1: **resolved** — all four facts now carry citations or an
explicit honest-degradation decision; no fact ships as an unchecked
assumption.

---

# Guide draft — Advance notice for self-arranged alcohol imports (fi/en) (task 2.5)

- Purpose: GUIDE-kind post draft for ops-console publication (`POST /ops/console/blog/guides`; kind `GUIDE`, status `DRAFT`; publication is a separate human operator action per design.md D6).
- Fields per locale: `slug`, `locale`, `title`, `bodyMarkdown`. FI is the primary locale; EN mirrors it.
- Register: observed-pattern, guidance-not-legal-advice per design.md D5 — every factual claim is a cited vero.fi fact or a verbatim quotation attributed to vero.fi (source numbering refers to the Sources table above, all accessed 2026-10-10). No penalty assertions beyond the hedged S1/S2 wording (Fact 4 resolution); no purchase or purchase-timing advice.
- Content-lint note: `pnpm lint:content` (apps/frontend `scripts/lint-content-policy.ts`) scans `.tsx` sources and `src/messages/*.json` only — it does not cover `openspec/changes/**`. The draft text below was kept within the content-policy vocabulary manually (no forbidden adjectives, no promotional phrasing).
- Suggested review reminder: process facts cited here (notice structure, reference-number lifecycle, penalty hedge) are not rate data and are not detected by the daily review job — the owner review calendar entry from D6 is the drift check for this post after publication.

## Draft — FI (primary)

- slug: `ennakkoilmoitus-itse-jarjestetty-etaosto`
- locale: `fi`
- title: Alkoholin etäosto omalla kuljetuksella: ennakkoilmoitus, vakuus ja valmisteveronumero

### bodyMarkdown (fi)

```markdown
Kun alkoholia tilataan toisesta ETA-maasta ja kuljetuksen järjestää itse,
vero.fi:n termistössä kyse on etäostosta. Ennen tilauksen lähettämistä vero.fi
kuvaa ostajalle kaksi askelta: ennakkoilmoituksen tekemisen ja vakuuden
maksamisen Verohallinnolle. Tämä opas kokoaa kyseisen kulun niin kuin se on
kirjattu vero.fi:n henkilöasiakkaiden sivuille 10.10.2026 mennessä. Opas on
havaintopohjainen yhteenveto, ei oikeudellinen neuvo.

## Kenelle ilmoitusvelvollisuus kuuluu

vero.fi erottaa kaksi roolia: etämyynnissä verovelvollinen on myyjä,
etäostossa ostaja. Ohjeen sanoin: "Verovelvollisen, eli etämyynnissä myyjän ja
etäostossa ostajan, pitää tehdä tilauksesta ennakkoilmoitus ja maksaa vakuus
Verohallinnolle ennen, kun tilaus lähetetään Suomeen" (lähde: vero.fi,
Usein kysyttyä alkoholin nettitilaamisesta). Jos myyjä lähettää tilauksen
omalla kuljetuksellaan, kyse on siis etämyynnistä ja ilmoituksen tekee myyjä.
Jos ostaja järjestää kuljetuksen itse, ilmoitus- ja vakuusvelvollisuus on
ostajalla.

Jos etämyyjä laiminlyö oman velvollisuutensa, ostaja voi tulla vastuuseen
veroista yhdessä myyjän kanssa. vero.fi:n mukaan ostaja ei tällöin tee
veroilmoitusta, eikä muiden seuraamusten — kuten laiminlyöntimaksun — kuvata
kohdistuvan ostajaan (lähde: vero.fi, Usein kysyttyä alkoholin
nettitilaamisesta; Alkoholin tilaaminen ulkomailta).

## Kaksi erillistä ennakkoilmoitusta

Tilatusta alkoholista maksetaan vero.fi:n mukaan kahta valmisteveroa:
alkoholijuomaveroa ja juomapakkausveroa, joka on 0,51 euroa litralta valmista
juomaa (lähde: vero.fi, Usein kysyttyä alkoholin nettitilaamisesta; Ilmoitus-
ja maksuohjeet alkoholi- ja tupakkatuotteille). Kummastakin tehdään oma
ilmoituksensa: "Sinun pitää siis tehdä kaksi erillistä ennakkoilmoitusta"
(lähde: vero.fi, Ennakkoilmoitus – Yksityishenkilö). Juomapakkausverosta ei
kuitenkaan tarvitse maksaa vakuutta (sama sivu).

## Vakuus on veron suuruinen ennakkomaksu

"Vakuuden määrä on sama kuin valmisteveron määrä", ja OmaVero laskee sen
useimmissa tapauksessa automaattisesti (lähde: vero.fi, Ennakkoilmoitus –
Yksityishenkilö; Näin annat ennakkoilmoituksen ja maksat kertaluonteisen
vakuuden). Vakuus ei jää Verohallinnolle vaan käytetään myöhemmin
valmisteveroihin: jos maksettu vakuus ei riitä kattamaan ilmoitettua veroa,
puuttuva osa maksetaan erikseen, ja jos vakuutta maksettiin yli, ylimenevä osa
palautetaan (lähde: vero.fi, Ilmoitus- ja maksuohjeet alkoholi- ja
tupakkatuotteille). Vakuus on siis valmisteveron ennakkomaksu, ei sakko eikä
lisämaksu.

## Valmisteveronumero ilmestyy vasta vakuuden maksun jälkeen

Kuljetuksen yksilöivä tunniste eli valmisteveronumero ilmestyy OmaVeron
kohtaan Ennakkoilmoitukset vasta, kun lähetyksestä on maksettu vakuus; maksu
näkyy OmaVerossa 1–2 arkipäivän kuluttua (lähde: vero.fi, Näin annat
ennakkoilmoituksen ja maksat kertaluonteisen vakuuden; Ilmoitus- ja
maksuohjeet alkoholi- ja tupakkatuotteille). Numeroita voi olla useita, ja
vero.fi ohjeistaa antamaan ne kaikki kuljettajalle tai merkitsemään ne kaikki
postipakettiin. Tunniste on kuljetuksen aikana pyydettäessä esitettävä Tullille
tai Verohallinnolle (lähde: vero.fi, Ilmoitus- ja maksuohjeet alkoholi- ja
tupakkatuotteille).

## Merkitykselliset ajankohdat

Vastaanottopäiväksi voi ilmoittaa päivän, joka on enintään 90 päivän päässä
ennakkoilmoituksen antamisesta; päivä ei voi olla menneisyydessä (lähde:
vero.fi, Näin annat ennakkoilmoituksen ja maksat kertaluonteisen vakuuden).
Ennakkoilmoitus annetaan ja vakuus maksetaan ennen tuotteiden lähettämistä tai
kuljetuksen aloittamista (lähde: vero.fi, Ennakkoilmoitus – Yksityishenkilö).
Vastaanoton jälkeen veroilmoitus annetaan ja valmisteverot maksetaan
viimeistään vastaanottopäivää seuraavan kuukauden 12. päivänä (lähde: vero.fi,
Ilmoitus- ja maksuohjeet alkoholi- ja tupakkatuotteille).

## Jos ennakkoilmoitus jää tekemättä

vero.fi:n kuvauksessa mahdollinen seuraus on laiminlyöntimaksu: "Jos jätät
ennakkoilmoituksen tekemättä, seurauksena voi olla laiminlyöntimaksu"
(lähde: [vero.fi, Ennakkoilmoitus – Yksityishenkilö](https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/ennakkoilmoitus---yksityishenkil%C3%B6/)).
Sivu ei ilmoita maksun suuruutta tai laskentaperustetta; tilanteen
yksityiskohdat tarkistetaan kyseiseltä sivulta.

## Yleinen virhekäsitys: Verohallinto hoitaa asian, ei Tulli

Koko kulku — ennakkoilmoitus, vakuus ja valmisteveronumero — tapahtuu
Verohallinnon OmaVerossa, ei Tullissa. Tulli mainitaan vero.fi:n kuvauksissa
vain tahona, joka voi kuljetuksen aikana pyytää valmisteveronumeron
esitettäväksi (lähde: vero.fi, Ilmoitus- ja maksuohjeet alkoholi- ja
tupakkatuotteille).

## Lisää sivustolla

- [Laskuri](/laskuri) laskee alkoholijuomaveron ja juomapakkausveron arviot —
  samoja komponentteja, joista vakuuden määrä muodostuu.
- [Tullivapaat](/tullivapaat) näyttää matkustajatuonnin versionoidut
  määrärajat.
- [Matkalaskuri](/matka) laskee nollavoiton tuontimäärät omien
  matkakustannusten vastapainona.

Tämä opas perustuu vero.fi:n ohjeisiin (tarkistettu 10.10.2026) eikä ole
oikeudellinen neuvo. Ajantasaisen tilanteen vahvistaa vero.fi:n omilta
sivuilta.
```

## Draft — EN (mirror)

- slug: `advance-notice-self-arranged-import`
- locale: `en`
- title: Self-arranged alcohol imports: the advance notice, guarantee, and excise number as vero.fi describes them

### bodyMarkdown (en)

```markdown
When alcohol is ordered from another EEA country and the buyer arranges the
transport themselves, vero.fi's vocabulary calls the situation distance
buying. Before the order is dispatched, vero.fi describes two steps for the
buyer: filing the advance notice and paying a guarantee to the Finnish Tax
Administration (Verohallinto). This guide collects that path from vero.fi's
individual-facing pages, checked 10 October 2026. It is an
observed-pattern summary, not legal advice.

## Whose obligation it is

vero.fi distinguishes two roles: in distance selling the party liable for tax
is the seller, in distance buying it is the buyer. The Finnish-language FAQ
places the advance notice and the guarantee payment with that party "before
the order is sent to Finland" (source: vero.fi, Usein kysyttyä alkoholin
nettitilaamisesta — Finnish page). In practice: seller-arranged shipping is
distance selling and the seller files; buyer-arranged transport puts the
filing and guarantee duty on the buyer.

If a distance seller defaults, the buyer may become liable for the duties
together with the seller; vero.fi states that the buyer then files no excise
return and that no negligence penalty or tax increase attaches to the buyer
(source: vero.fi, Usein kysyttyä
alkoholin nettitilaamisesta; Alkoholin tilaaminen ulkomailta — Finnish
pages).

## Two separate advance notices

Two excise duties attach to ordered alcohol: the alcohol beverage duty and
the beverage-packaging duty, 0.51 euro per litre of the finished drink
(source: vero.fi, Usein kysyttyä alkoholin nettitilaamisesta; Ilmoitus- ja
maksuohjeet alkoholi- ja tupakkatuotteille). Each gets its own filing: "In
other words, you must file two separate advance notices. However, you do not
have to set a guarantee for the beverage containers." (source: vero.fi,
Advance notice – individuals).

## The guarantee is a prepayment of the duty, not a fine

"The amount of the guarantee is equal to the amount of the excise duty", and
MyTax (OmaVero) calculates it in most cases automatically (source: vero.fi,
Advance notice – individuals; Näin annat ennakkoilmoituksen ja maksat
kertaluonteisen vakuuden). The guarantee is later used for the excise taxes:
if it falls short of the declared duty, the difference is paid separately; if
it overpays, the excess is refunded (source: vero.fi, Ilmoitus- ja
maksuohjeet alkoholi- ja tupakkatuotteille). It is a prepayment of the duty —
not a fine and not an extra charge.

## The excise number appears only after the guarantee payment

The transport identifier, the excise duty number (valmisteveronumero),
appears in MyTax under Advance notices only once the guarantee has been paid
for the consignment; the payment becomes visible in MyTax within 1–2 business
days (source: vero.fi, Näin annat ennakkoilmoituksen ja maksat kertaluonteisen
vakuuden; Ilmoitus- ja maksuohjeet alkoholi- ja tupakkatuotteille). There may
be several numbers, and vero.fi instructs passing all of them to the carrier
or marking all of them on the parcel; it is presented to Customs or the Tax
Administration on request during transport (source: vero.fi, Ilmoitus- ja
maksuohjeet alkoholi- ja tupakkatuotteille).

## The dates that matter

The stated receipt date may lie at most 90 days ahead of filing and cannot
be in the past (source: vero.fi, Näin annat
ennakkoilmoituksen ja maksat kertaluonteisen vakuuden). The notice is filed
and the guarantee paid before the products are dispatched or the transport
begins (source: vero.fi, Advance notice – individuals). After receipt, the
excise return is filed and the duties paid by the 12th of the month following
the receipt date (source: vero.fi, Ilmoitus- ja maksuohjeet alkoholi- ja
tupakkatuotteille).

## If the advance notice is missed

vero.fi names one possible consequence: "If you fail to file an advance
notice, you may have to pay a negligence penalty later." (source:
[vero.fi, Advance notice – individuals](https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/arriving_in_finland/bringing-alcohol-and-tobacco-to-finland/advance-notice-private-individual/)).
The page gives no amount or computation basis; specifics are checked on that
page.

## Common misconception: the Tax Administration handles this, not Customs

The whole path — advance notice, guarantee, and excise number — runs through
the Tax Administration's MyTax, not through Customs. Customs appears in
vero.fi's descriptions only as the authority that may ask to see the excise
number during transport (source: vero.fi, Ilmoitus- ja maksuohjeet alkoholi-
ja tupakkatuotteille).

## Elsewhere on the site

- [Calculator](/en/calculator) estimates the alcohol excise and container
  duty — the components the guarantee amount is built from.
- [Allowances](/en/allowances) shows the versioned traveller allowance limits.
- [Trip calculator](/en/trip) computes break-even import volumes against
  travel costs.

This guide is based on vero.fi's guidance (checked 10 October 2026) and is
not legal advice. The current situation is confirmed from vero.fi itself.
```

## Citation trace for the draft (task 2.5 → task 1.1)

| Claim in draft | Source(s) |
| -------------- | --------- |
| Distance selling (seller files) vs distance buying (buyer files), before dispatch | S4 (FAQ §2), S1 |
| Seller-default path: shared liability, buyer files no return, no negligence penalty/tax increase on buyer | S4 (FAQ §5), S6 |
| Two duties for ordered alcohol; packaging duty 0,51 €/l | S4 (FAQ §6), S3 |
| Two separate advance notices; no guarantee for packaging | S1, S2 (verbatim), S3 |
| Guarantee = excise amount; MyTax computes it | S1, S2 (verbatim), S5 |
| Guarantee credited against the duty; shortfall payable, overpayment refunded | S3 (step 3), S1 |
| Excise number issued after guarantee payment; visible in 1–2 business days; possibly several, all passed to carrier / parcel; shown to Tulli/Verohallinto on request | S3, S4 (FAQ §3), S5 |
| Receipt date ≤90 days ahead, not in the past | S5 |
| Notice + guarantee before dispatch/transport start | S1 |
| Excise return + payment due 12th of month after receipt | S3 (step 3) |
| Missed notice → hedged laiminlyöntimaksu (with official link) | S1, S2 (verbatim) |
| Tax Administration/MyTax handles the process; Tulli only checks the identifier | S3, S4, S6 (pitch-contradiction flag 1) |

Deliberately not cited in the draft: S7 (superseded, context-only per Fact 4 resolution) — the draft asserts nothing quantitative about penalties.

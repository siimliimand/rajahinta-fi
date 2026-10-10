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

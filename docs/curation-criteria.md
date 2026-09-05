# Curation criteria — "Alkon hylkäämät"

Operational policy for the curated list `alkon-hylkaamat` ("Alkon hylkäämät"). The
registry in `apps/api-worker/src/routes/curated-lists.routes.ts` carries the three
authoritative criteria statements rendered on the public page; this document is the
operator-facing elaboration of those statements. If this document and the registry
strings ever disagree, the registry wins and this document must be corrected — the
criteria are editorial policy, so a criteria change is a code change by design.

An operator must be able to execute every step below without guessing. Each entry
must satisfy all three criteria at publication time and at every re-verification.

## 1. Qualification criteria

### C1 — Rejected or delisted by Alko

Registry statement: *Tuote on jätetty Alkon valikoimaan hyväksymättä tai poistettu
Alkon valikoimasta.*

What counts as evidence:

- The product is absent from Alko's current online product search (alko.fi product
  search), AND one of:
  - a prior Alko listing can be demonstrated (an archived snapshot of the Alko
    product page, a historical price list, or Alko's published range-change
    announcements), or
  - the product was never accepted into the range and this is documented by the
    producer or importer in a citable public statement.

Procedure:

1. Search the exact product name and, where known, the producer in Alko's product
   search. Record the search date and the absence.
2. Locate prior-listing evidence in a public web archive. Save the archive URL as
   part of the entry's evidence links.
3. Alko's internal rejection reasoning is not public and is not asserted. Entries
   state the observable facts (absent today, present before, or never listed with a
   public source) — never Alko's motives.

### C2 — Verifiably available in the EU area

Registry statement: *Tuote on todistetusti saatavana vähintään yhdestä
EU-alueen verkkokaupasta.*

What counts as evidence:

- A live product page from an online store operating in an EU member state, at
  which the product appears orderable at verification time.

Procedure:

1. Open the product URL. Confirm it resolves (HTTP 200), names the same product
   (producer and product name match the entry), and presents it as purchasable.
2. Record the store name and the verification date in the entry's rationale or
   evidence-link label.
3. An out-of-stock page does not satisfy "available" unless the store accepts
   orders anyway. A dead or redirected link fails the criterion.

### C3 — Rationale plus at least one evidence link

Registry statement: *Jokaisella listauksella on toimituksellinen perustelu ja
vähintään yksi todistelulinkki (esimerkiksi arvio, palkinto tai virallinen
lähde).*

- The rationale is mandatory, states why the entry qualifies (which criterion and
  what was observed), and is written neutrally — no marketing language, no
  unfounded health or legal claims.
- At least one evidence link is mandatory; it must point at one of the sources in
  section 2 or 3. A bare search-result URL, a homepage, or a paywalled page the
  curator cannot verify does not qualify.
- The schema enforces this minimum (non-empty rationale, non-empty validated
  `{label, url}` link list); this section defines what makes a link *editorially
  acceptable* on top of that floor.

## 2. Rating sources — which sources count and why

Sources are acceptable when their results are public, independently produced, and
re-checkable. Three tiers:

### Tier A — Juried competitions with published results

A medal from any of these competitions counts as award evidence, because each
publishes per-product results that anyone can look up:

- IWSC (International Wine and Spirit Competition)
- International Spirits Challenge (ISC)
- San Francisco World Spirits Competition
- Concours Mondial de Bruxelles (including its beer and spirits sessions)
- Monde Selection
- European Beer Star
- World Beer Awards
- Brussels Beer Challenge

Why: independent judging panels, published result pages, and stable per-product
records. The evidence link must point at the organizer's own results page (or an
archived copy), never at a distributor's "award-winning" claim.

### Tier B — Consumer rating databases with sample-size thresholds

A rating from a large public review database counts when it meets the editorial
thresholds below (these are Rajahinta's thresholds, not the platforms'):

- BeerAdvocate: score ≥ 88/100 with at least 25 ratings.
- Vivino (wine): rating ≥ 4.0/5 with at least 200 ratings.

Why: large samples dampen individual-reviewer noise, and score pages have stable,
checkable URLs. The link must point at the product's score page itself.

Named platforms change over time. If a listed database ceases publication or
restricts access, an archived snapshot of the score page remains valid evidence,
and the curator selects a replacement under the same rule: a public, large-sample,
individually attributable rating platform. Do not substitute a platform that fails
those properties.

### Tier C — Official retail listings

Product pages of the Nordic monopoly retailers (Systembolaget, Vinmonopolet) or
equivalent licensed EU retailers count as *official sources* under C3. They are
not ratings; they serve as availability evidence (C2) or as a neutral source
identifying the product.

### Sources that do not count

- Seller-asserted "award-winning" labels without a results page.
- Pay-to-enter listings that grant a badge to every entrant.
- Social-media polls, forums, or influencer rankings without a stated methodology.
- Blogs without a rating method.

## 3. Award thresholds — what qualifies an entry

An entry qualifies on evidence strength when it carries at least one of:

1. Any medal rank (gold/silver/bronze or the organizer's equivalent) from a Tier A
   competition, verifiable on the organizer's official results page.
2. A Tier B rating meeting the numeric and sample-size thresholds above.
3. Both C1 and C2 verified with primary evidence (Alko absence + live EU store
   page), where the evidence links themselves are the qualifying material.

When an award or rating exists but cannot be verified (no results page, dead
link), it is noted in the rationale as unverified and does not count toward
qualification until a verifiable link exists.

## 4. Review cadence

- **Quarterly re-verification.** Every entry is re-checked against C1, C2, and C3
  at least once per calendar quarter (windows: January, April, July, October).
- **Trigger-based off-cycle review.** An entry is re-verified ahead of schedule
  when: an evidence link is reported or observed broken; Alko announces range
  changes plausibly affecting the entry; or a reader correction arrives.
- **Who reviews.** The curator role that operates the console performs the
  re-verification. Every console mutation records the acting operator and the
  action in the audit trail, so each re-verification is attributable without a
  separate review tool.
- **Recording.** A re-verification that changes content is made through the
  console edit with a `note` describing what was re-checked (the audit trail keeps
  before/after values). A re-verification that changes nothing needs no console
  action.

### Re-checking evidence links

1. Fetch each evidence link. Expect HTTP 200 and the same product/award identity
   the entry cites (a redirect to a category page or a different product fails).
2. If the live page is gone but an archived snapshot exists, replace or supplement
   the link with the archive URL and note the substitution in the rationale.
3. If the evidence cannot be restored, **unpublish** the entry through the console
   rather than deleting it: the public list drops it immediately, the editorial
   record survives, and the entry returns via publish once fresh evidence exists.
4. If the product is again listed by Alko (C1 broken) or no EU store carries it
   (C2 broken), unpublish for the same reason and note the failed criterion.

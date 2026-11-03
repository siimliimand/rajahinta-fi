# Calendar candidate triage — 2026-10-26 (initial backlog, 37 items)

Prepared for the first operator pass over the `calendarEventCandidates`
review queue, ten days after the watcher went live (deploy 2026-10-16
18:01 UTC; first detections 2026-10-17 04:00 UTC). Every verdict below
was made against the `tax-change-calendar` closed event vocabulary
(`FI_EXCISE_CHANGE | EE_EXCISE_CHANGE | ALKO_PRICE_LIST |
TAX_TABLE_PUBLICATION | RATE_DECISION`) — an item the vocabulary cannot
express is a reject, however tax-adjacent it reads, because acceptance
requires choosing a type, status, and date/window that would invent
semantics.

**Verdict summary: 37 × REJECT recommended.** Zero calendar-worthy
items in the first window — expected for a news firehose watcher, and
exactly why the design keeps the human gate. Four items (6, 9, 26, 28)
are flagged for an owner second look before rejecting: they are real
Finnish tax/regulatory developments that merely fall outside this
calendar's domain.

## How to execute

Ops console → calendar candidates (or `POST /ops/console/calendar-
candidates/:id/reject` behind the ops bearer). Reject is terminal but
the row is retained for URL dedup — rejecting noise is what makes the
queue converge. Accept is the only path that creates public calendar
events and is audited; do it only from the ops console, deliberately.

## vero-fi-news (12)

| id | published | item | verdict |
|----|-----------|------|---------|
| 37 | 2026-10-23 | Verovapaat matkakustannusten korvaukset vuonna 2027 (tax-free daily-allowance amounts 2027) | REJECT — per-diem amounts, income-tax side; no vocabulary type |
| 36 | 2026-10-22 | Verohallinto lisää alkutuotannon ja työvoimavaltaisten alojen valvontaa vuonna 2027 | REJECT — enforcement resourcing, no rate/date |
| 1  | 2026-10-16 | Verotulot tammi–syyskuu 2026 (collection statistics) | REJECT — statistics |
| 2  | 2026-10-14 | Korkovähennys kriittisille infrastruktuurihankkeille | REJECT — interest-deduction proposal (flagged: real tax change, wrong domain) |
| 3  | 2026-10-13 | Kotitalousvähennys nousee takautuvasti | REJECT — household tax credit administration (flagged-adjacent: consumer-visible, not excise/price) |
| 4  | 2026-10-07 | Verohallinto on lähettänyt tekstiviestillä muistutuksia | REJECT — 2022 article republished by the feed with a fresh date (feed-noise class; see notes) |
| 5  | 2026-09-28 | Lahjoitusvähennyksen laajentaminen | REJECT — deduction proposal |
| 6  | 2026-09-25 | Maatalouden energiaveron lisäpalautukset | REJECT — energy-excise domain but a one-off refund round, no rate or effective-date change (flagged) |
| 7  | 2026-09-23 | Ohjelmistokehittäjien tietoon 04/2026 | REJECT — developer bulletin |
| 8  | 2026-09-23 | 22 000 veroproosatiehdotusta | REJECT — individual assessment proposals |
| 9  | 2026-09-17 | Yhteisöveroprosentin alentaminen 18 %:iin | REJECT — corporate income tax rate proposal; genuine national rate change but outside the consumer price-change calendar (flagged) |
| 10 | 2026-09-10 | Suomen ja Ranskan verosopimus 2027 | REJECT — treaty, withholding-side |

## alko-press-sttinfo (25)

| id | published | item | verdict |
|----|-----------|------|---------|
| 11 | 2026-10-14 | Alkon Q3-myynti | REJECT — sales statistics |
| 12 | 2026-10-13 | Glögikauden avaus | REJECT — seasonal promo |
| 13 | 2026-09-28 | Rukan Alko muuttaa | REJECT — store move |
| 14 | 2026-09-07 | Tuusulan Hyrylän Alko muuttaa | REJECT — store move |
| 15 | 2026-09-07 | FASD-päivä myyntiajan siirto | REJECT — one-day campaign |
| 16 | 2026-09-02 | Kohtuullistaminen / perjantai-vilkain | REJECT — consumption research |
| 17 | 2026-08-25 | Oktoberfest-oluet Alkoihin | REJECT — assortment promo |
| 18 | 2026-08-24 | Jyväskylän Vaajakosken Alko -ilme | REJECT — store refresh |
| 19 | 2026-08-20 | Sunnuntai- ja juhlapyhäaukiolot laajenevat | REJECT — opening hours |
| 20 | 2026-08-17 | Kevyemmät kuohuviinipullot | REJECT — packaging weight |
| 21 | 2026-08-13 | Salon Halikon Alko -ilme | REJECT — store refresh |
| 22 | 2026-08-11 | Alkon puolivuosikatsaus 1–6/2026 | REJECT — financials |
| 23 | 2026-07-16 | Kirkkonummen Alko palaa | REJECT — store move |
| 24 | 2026-07-14 | Kontulan Alko avautuu | REJECT — store move |
| 25 | 2026-07-08 | Alkon Q2/2026 myynti | REJECT — sales statistics |
| 26 | 2026-06-23 | Alkoholilain muutos: laajemmat aukioloajat, 108 myymälää | REJECT — statutory change affects availability, not excise rates or prices (flagged: nearest-miss regulatory item) |
| 27 | 2026-06-15 | Kesä ja juomavalinnat | REJECT — seasonality research |
| 28 | 2026-06-11 | Suomalaiset ostavat ulkomaisista verkkokaupoista kymmeniä miljoonia litroja | REJECT — research on cross-border purchases; topically closest to the site's theme, still not a calendar event (flagged) |
| 29 | 2026-06-10 | Kartonkitölkki vai kevyt lasipullo | REJECT — packaging |
| 30 | 2026-05-12 | Porin Eteläväylän Alko muuttaa | REJECT — store move |
| 31 | 2026-05-05 | Kuopion Haapaniemen Alko | REJECT — store move |
| 32 | 2026-04-21 | Seinäjoen Nurmon Alko | REJECT — store move |
| 33 | 2026-04-20 | Levin Alko muuttaa | REJECT — store move |
| 34 | 2026-04-16 | Munkkivuoren Alko suljetaan | REJECT — store closure |
| 35 | 2026-04-15 | Suolaiset naposteltavat valikoimiin | REJECT — assortment |

## Notes for the next window

- **Expected first genuine accept-candidate:** vero.fi published
  2026-10-26 07:10 EEST "Ostajille valmisteveroja maksettavaksi
  verkosta tilatuista alkoholijuomista" (excise collection on alcohol
  ordered from online/foreign shops) — after the day's 04:00 UTC tick,
  so the watcher should surface it 2026-10-27 04:00 UTC. Read the
  article before accepting: accept only if it establishes a change
  with an official effective date; it may instead be administration of
  existing law.
- **Feed-noise class (id 4):** vero.fi's RSS occasionally republishes
  old articles with current dates — the watcher correctly stores what
  the feed claims; only review catches it. Expect a few per year.
- **Structural noise:** ~⅔ of volume is Alko store moves/promos. A
  watcher-side keyword pre-filter could shrink the queue, but an
  auto-filter that misses one real announcement is worse than a noisy
  queue with the stale-queue alert (RajahintaCalendarQueueReviewStale)
  now watching it. Leave the filter proposal to the platform engineer
  with this dataset as evidence.

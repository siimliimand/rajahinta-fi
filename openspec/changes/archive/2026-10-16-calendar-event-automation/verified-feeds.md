# Verified feeds — calendar-event-automation task 1.1

Verified 2026-10-16 with `curl` probes using a named crawler UA
(`rajahinta-fi-feed-check/1.0 (+https://rajahinta.fi; feed verification probe)`).
HTTP status, content type, item structure, and freshness are recorded per source.
Every watcher source below was fetched live; no URL is listed untested.

A source is watchable only if it serves structured items (RSS 2.0 / Atom / JSON)
with a stable identity field and a publish date. HTML-only or bot-blocked pages
are ruled out of scope — ad-hoc scraping is explicitly not done (design D:
"Feed set comes from this note; a source without a machine-readable feed is out
of scope, not scraped ad hoc").

---

## 1. Verohallinto news (vero.fi)

**Verdict: FEED (RSS 2.0) — in scope.**

- Feed URLs (official, listed on vero.fi's own RSS service page):
  - Finnish: `https://www.vero.fi/api/rss/news/fi`
  - English: `https://www.vero.fi/api/rss/news/en`
- Probe result: HTTP 200, `application/rss+xml;charset=UTF-8`, RSS 2.0 with an
  `a10` (Atom) namespace. 10 items per feed (fixed page size).
- Item identity: `<guid isPermaLink="false">` — a UUID (e.g.
  `a88c04bb-17b1-4ff3-9407-1f141d5125f9`); `<link>` is the canonical article URL
  (e.g. `https://www.vero.fi/tietoa-verohallinnosta/uutishuone/uutiset/uutiset/2026/<slug>/`).
  **Dedup on `link`** (the GUID is stable but opaque; the link is the identity
  the candidate table stores anyway).
- Date field: `<pubDate>` RFC-822 with a numeric +03:00 offset
  (`Fri, 16 Oct 2026 10:00:00 +0300`) — parseable by any RFC-822 parser.
- Parse note: smallest, cleanest feed of the set; items carry only
  guid/link/title/pubDate (no description body — body extraction is not needed;
  the watcher stores link + title + date only). Relevance signal: vero.fi's
  newsroom publishes "Hallitus esittää …" items ahead of excise changes.
- Freshness at verification: newest item 2026-10-16 (same day).

---

## 2. Alko press releases (alko.fi)

**Verdict: FEED (RSS 2.0) — in scope, via the STT Info press-room mirror.**

- **alko.fi direct access is bot-blocked**: `https://www.alko.fi/fi/alko-oy/uutishuone`,
  `https://www.alko.fi/ajankohtaista/tiedotteet`, and `https://www.alko.fi/en/newsroom`
  all returned **HTTP 403 with an Azure WAF JS Challenge** to the crawler UA —
  consistent with the Azure WAF behaviour recorded in the 2026-10-01
  data-quality change notes. No feed URL is served from alko.fi itself.
- Working machine-readable mirror (Alko Oy's own publisher room on STT Info,
  the distribution service alko.fi links to for press subscriptions):
  - `https://www.sttinfo.fi/rss/releases/latest?publisherId=1631`
  - Human-readable room: `https://www.sttinfo.fi/uutishuone/1631/alko-oy`
    (`api.sttinfo.fi` serves the same room as HTML).
  - The RSS URL is the official subscription link exposed in the room's HTML
    (`<link rel="alternate" type="application/rss+xml" …>`), not a guessed path.
- Probe result: HTTP 200, `text/xml; charset=utf-8`, RSS 2.0, 25 items.
- Item identity: `<guid isPermaLink="false">` — the canonical short-form release
  URL containing STT's numeric release id
  (`https://www.sttinfo.fi/tiedote/72408468/?publisherId=1631&lang=fi`);
  `<link>` is the same release with an SEO slug
  (`https://www.sttinfo.fi/tiedote/72408468/<slug>?lang=fi`).
  **Dedup on the numeric release id** (stable across slug changes) or on the
  normalized guid; do not dedup on the slug portion.
- Date field: `<pubDate>` RFC-822 GMT (`Wed, 14 Oct 2026 04:10:00 GMT`).
- Parse note: items additionally carry `<enclosure>` (press image) and a custom
  `<regulatory>false</regulatory>` element — both ignored. `<description>` holds
  the full lead paragraph (useful as title context in the ops review queue).
- Freshness at verification: newest item 2026-10-14 (Q3 sales release) —
  actively updated.

---

## 3. EMTA — Maksu- ja Tolliamet (emta.ee)

**Verdict: FEED (RSS 2.0) — machine-readable feed exists; polling is a lead
decision because Estonian excise automation stays out of product scope.**

- Feed URLs (official Drupal `rss-feeds` path, linked from EMTA's news pages):
  - Estonian: `https://emta.ee/rss-feeds/rss.xml`
  - English: `https://emta.ee/en/rss-feeds/rss.xml`
- Probe result: HTTP 200, `application/rss+xml; charset=utf-8`, RSS 2.0 with
  `dc:` namespace. ~40–60 kB per fetch (50+ items).
- Item identity: `<guid isPermaLink="false">` — Drupal node id form
  (`5175 at https://emta.ee/`); `<link>` is the slug URL
  (`https://emta.ee/uudised/<slug>` / `https://emta.ee/en/<slug>`).
  **Dedup on `link`**; the guid's numeric prefix is parseable if a second
  identity is ever needed.
- Date field: `<pubDate>` RFC-822 with +03:00 offset
  (`Wed, 14 Oct 2026 12:13:57 +0300`).
- Parse note: sitewide news feed with high noise (weekly customs operational
  reviews, confiscated-goods auctions, payment statistics). A watcher would
  keyword-filter (EE: `aktsiis`, `eksisiis`, `alkohol`; EN: `excise`,
  `alcohol`) and generate PENDING candidates only on hits. Note emta.ee also
  sits behind Azure WAF; the feed path and news pages served the crawler UA
  fine on repeated probes, but the watcher must keep the polite-UA discipline.
- Freshness at verification: newest item 2026-10-14.
- Scope note: the proposal records Estonian excise events as out of automation
  scope ("stays manual via the ops console"). The feed is verified and
  technically watchable; whether the watcher polls it for ops-review awareness
  is the lead's call, not a blocker for this change.

---

## 4. Eduskunta bill tracker (eduskunta.fi)

**Verdict: NO RSS (officially discontinued) — but a machine-readable JSON API
exists; usable with heavy caveats, or droppable in favour of source 1. Lead
decides whether the cost is worth it.**

- RSS status: the Parliament's own RSS page states
  *"Eduskunnalla ei toistaiseksi ole tarjolla RSS-syötteitä"* (no RSS feeds are
  currently offered; the historical feeds are discontinued) —
  `https://www.riksdagen.fi/fi/tietoa-sivustosta/rss-syotteet` (HTTP 200 HTML).
- Machine-readable listing (verified live): the open-data API over the VASKI
  parliamentary-matters table:
  - `https://avoindata.eduskunta.fi/api/v1/tables/VaskiData/rows?columnName=Eduskuntatunnus&columnValue=HE%25&perPage=N`
    (`HE%25` = wildcard prefix match on hallituksen esitys identifiers,
    e.g. `HE 172/2026 vp`; URL-encode the space as `%20` when filtering a
    specific number, e.g. `columnValue=HE%20172%25`).
- Probe result: HTTP 200, `application/json`, paginated
  (`page`, `perPage`, `hasMore`, `columnNames`, `rowData`).
- Item identity: `Id` (numeric primary key) and `Eduskuntatunnus`
  (`"HE 172/2021 vp"` format). **Dedup on `Id`.**
- Date field: `Created` column, format `YYYY-MM-DD HH:MM:SS`
  (space separator, no timezone suffix — treat as Europe/Helsinki wall time).
- Parse notes (all verified in probes):
  - Every row embeds the full VASKI XML message in `XmlData` — measured
    50–500 kB per row, so a bounded `perPage` is mandatory (≥100 rows ≈ tens of
    MB per run; keep `perPage` small and walk `hasMore` pages).
  - Row ordering is **unspecified**: `sortColumn`/`sortOrder` parameters were
    accepted but ignored in probes (same unsorted response). A watcher cannot
    rely on newest-first; it must walk pages and dedup on `Id`, or accept
    lag-driven misses.
  - Date filtering does **not** work: `columnName=Created&columnValue=2026%25`
    returns HTTP 400 with `{"message":"Datatype 'OTHER' not supported in SQL
    queries yet, sorry."}` — only string columns such as `Eduskuntatunnus`
    support the wildcard filter.
  - Only identifiers + embedded XML are returned; the human-readable bill title
    sits inside `XmlData` (`NimekertomusTeksti`), so title extraction from this
    source means parsing embedded XML — heavier than any other source here.
- Context: valtioneuvosto.fi (which publishes HE press releases) returned
  HTTP 403 to both crawler and browser UAs on its feed index page
  (`https://valtioneuvosto.fi/staattiset-feedit`) — not a verified source, and
  not needed: vero.fi's news feed already surfaces "Hallitus esittää …" items
  for government proposals.

---

## Watcher scope (summary)

The daily watcher cron polls, in priority order:

| # | Source | Feed URL | Format | Status |
|---|--------|----------|--------|--------|
| 1 | Verohallinto news | `https://www.vero.fi/api/rss/news/fi` | RSS 2.0 | **Poll** (primary FI-tax signal) |
| 2 | Alko press releases | `https://www.sttinfo.fi/rss/releases/latest?publisherId=1631` | RSS 2.0 | **Poll** (primary price-list signal) |
| 3 | EMTA news | `https://emta.ee/en/rss-feeds/rss.xml` (or `/rss-feeds/rss.xml`) | RSS 2.0 | **Feed verified — lead decision** (EE excise stays manual per proposal; watch only for awareness if at all) |
| 4 | Eduskunta HE tracker | `https://avoindata.eduskunta.fi/api/v1/tables/VaskiData/rows?columnName=Eduskuntatunnus&columnValue=HE%25&perPage=N` | JSON API (no RSS exists) | **Feed verified with heavy caveats — lead decision** (heavyweight rows, unspecified ordering, no date filter; drop candidate in favour of source 1) |

All four candidate sources are resolved: two with clean RSS feeds the cron polls
unconditionally, two with verified machine-readable endpoints whose inclusion is
a lead decision recorded above. No source requires HTML scraping; no watcher
requirement is left unverified.

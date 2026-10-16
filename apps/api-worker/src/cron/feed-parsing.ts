/**
 * Tolerant RSS 2.0 item extraction for the calendar source-watcher cron
 * (task 3.3, change calendar-event-automation) — the smallest parse that
 * serves the three verified feeds (vero.fi news, STT Info press mirror,
 * EMTA news). No XML dependency, no DOM: workerd has no DOMParser, and
 * the feeds' item structure is flat RSS 2.0 (guid/link/title/pubDate;
 * enclosure/regulatory/a10-namespace extras are ignored).
 *
 * Tolerance contract: a feed whose XML is odd still yields whatever
 * items are extractable, and an item whose tags are missing or empty
 * yields nulls — the watcher (not this module) decides that a null
 * identity field means a counted skip. CDATA wrappers and the five
 * XML entities are decoded so titles arrive as text, not markup.
 *
 * @module FeedParsing
 */

/** One RSS `<item>` as the watcher consumes it — null when absent/empty. */
export interface RssFeedItem {
  /** `<guid>` text (STT's identity field — stable across slug changes). */
  readonly guid: string | null;
  /** `<link>` text (vero.fi's and EMTA's identity field). */
  readonly link: string | null;
  /** `<title>` text, entities decoded, trimmed. */
  readonly title: string | null;
  /** Raw `<pubDate>` text (RFC-822) — normalized by the caller. */
  readonly pubDate: string | null;
}

/** Decode the XML entities RSS bodies use, `&amp;` last (single pass). */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&(lt|#x3[Cc]|#60);/g, '<')
    .replace(/&(gt|#x3[Ee]|#62);/g, '>')
    .replace(/&(quot|#x22|#34);/g, '"')
    .replace(/&(apos|#x27|#39);/g, "'")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&amp;/g, '&');
}

/** Tag text: strip CDATA, decode entities, trim; null when absent/empty. */
function extractTag(block: string, tag: string): string | null {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  if (!match) return null;
  const cdata = match[1]?.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  const raw = cdata ? cdata[1] ?? '' : match[1] ?? '';
  const text = decodeXmlEntities(raw).trim();
  return text.length > 0 ? text : null;
}

/**
 * Extract a feed's items in document order (newest-first in all three
 * verified feeds), bounded to `maxItems` — the per-run cap. A block the
 * regex cannot even delimit is invisible here; a delimited block with
 * missing tags surfaces as an item with nulls (counted by the caller).
 */
export function parseRssItems(xml: string, maxItems: number): readonly RssFeedItem[] {
  const blocks = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/gi) ?? [];
  const items: RssFeedItem[] = [];
  for (const block of blocks) {
    if (items.length >= maxItems) break;
    items.push({
      guid: extractTag(block, 'guid'),
      link: extractTag(block, 'link'),
      title: extractTag(block, 'title'),
      pubDate: extractTag(block, 'pubDate'),
    });
  }
  return items;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * RFC-822 `pubDate` → the source's local calendar day, `YYYY-MM-DD`.
 *
 * The date tokens in an RFC-822 string ARE the publisher's wall-clock
 * date (the trailing offset only fixes the instant), so the day is read
 * straight from the tokens — re-deriving it through `Date` + UTC getters
 * would shift items published near local midnight one day back (vero.fi
 * and EMTA publish in +03:00). Offset-less or exotic strings fall back
 * to `Date` parsing read as UTC; an unparseable date is null — the
 * caller counts the item malformed and skips it.
 */
export function pubDateToIsoDay(pubDate: string): string | null {
  const tokens = pubDate.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})/);
  if (tokens) {
    const day = Number(tokens[1]);
    const month = MONTHS[(tokens[2] ?? '').toLowerCase()];
    let year = Number(tokens[3]);
    if (year < 100) year += 2000;
    if (month !== undefined && day >= 1 && day <= 31) {
      return (
        `${String(year).padStart(4, '0')}-` +
        `${String(month).padStart(2, '0')}-` +
        `${String(day).padStart(2, '0')}`
      );
    }
  }
  const parsed = new Date(pubDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

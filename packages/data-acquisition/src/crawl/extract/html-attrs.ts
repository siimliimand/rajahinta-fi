/**
 * HTML attribute-string parser for the markup readers (task 1.2, change
 * sitemap-crawl-merchants).
 *
 * The Workers runtime has no DOMParser, so both the microdata and the
 * OG/meta readers consume attribute strings pulled out of raw tags by
 * bounded regexes. Values may be double-quoted, single-quoted,
 * unquoted, or boolean (attribute present with no value — `itemscope`).
 * Entity decoding is deliberately NOT done here: attribute values that
 * matter (`itemprop`, `itemtype`, `content`) are name tokens or text
 * the record assembly trims, and markup-level entities in prose ride
 * the same value the page serves.
 *
 * @module HtmlAttrs
 */

const ATTRIBUTE_PATTERN =
  /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseHtmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

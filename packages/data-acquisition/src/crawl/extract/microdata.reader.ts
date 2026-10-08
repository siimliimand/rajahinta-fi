/**
 * Schema.org microdata Product reader (task 1.2, change
 * sitemap-crawl-merchants; design D3 — extraction tiering, second tier).
 *
 * viinarannasta serves NO JSON-LD — its PrestaShop pages carry schema.org
 * microdata (`itemtype Product` + `Offer`, `itemprop` attributes, a
 * GTIN13). Since the Workers runtime has no DOMParser, this reader
 * builds a minimal element tree with a tag stack (script/style bodies
 * stripped first, so markup-ish JSON-LD content can never confuse the
 * stack) and reads the microdata properties off it.
 *
 * Microdata scope rules the collector honors: a nested `itemscope`
 * element starts its own item — its properties are NOT the parent's.
 * An `itemprop="offers"` element that carries its own `itemscope` is
 * parsed as the Offer sub-item; other nested items are ignored.
 * `itemprop` accepts space-separated token lists per the spec.
 *
 * Item values resolve content → href → src → value attribute, then the
 * element's deep text (so `itemprop="brand"` wrapping a Brand scope
 * still yields the brand name). Nothing here throws on odd markup.
 *
 * @module MicrodataReader
 */

import { parseHtmlAttributes } from './html-attrs';
import {
  priceToCents,
  readGtinRaw,
  type StructuredOffer,
  type StructuredProduct,
} from './structured-product';

const TAG_PATTERN = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

const PRODUCT_ITEMTYPE = /^https?:\/\/(www\.)?schema\.org\/Product\/?$/i;

const GTIN_PROPS = ['gtin13', 'gtin', 'gtin14', 'gtin12'] as const;

interface MiniElement {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly children: MiniElement[];
  readonly textChunks: string[];
}

function newElement(tag: string, attrs: Record<string, string>): MiniElement {
  return { tag, attrs, children: [], textChunks: [] };
}

function buildTree(html: string): MiniElement {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');

  const root = newElement('#root', {});
  const stack: MiniElement[] = [root];
  let lastIndex = 0;

  for (const match of stripped.matchAll(TAG_PATTERN)) {
    const textBefore = stripped.slice(lastIndex, match.index);
    if (textBefore !== '') {
      stack[stack.length - 1].textChunks.push(textBefore);
    }
    lastIndex = match.index + match[0].length;

    if (match[1] === '/') {
      const tag = match[2].toLowerCase();
      // findLastIndex needs the ES2023 lib; the Workers target is ES2022.
      let openIndex = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          openIndex = i;
          break;
        }
      }
      // A stray close tag never pops the stack below the elements seen
      // since its opener — malformed nesting costs nothing structured.
      if (openIndex > 0) stack.length = openIndex;
      continue;
    }

    const tag = match[2].toLowerCase();
    const element = newElement(tag, parseHtmlAttributes(match[3]));
    stack[stack.length - 1].children.push(element);

    const selfClosing = match[3].trimEnd().endsWith('/');
    if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push(element);
  }

  return root;
}

/** Deep text with markup whitespace collapsed — the itemprop text value. */
function deepText(element: MiniElement): string {
  let text = element.textChunks.join('');
  for (const child of element.children) {
    text += deepText(child);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Microdata item value: the property attributes win over deep text. */
function itempropValue(element: MiniElement): string {
  const value =
    element.attrs['content'] ??
    element.attrs['href'] ??
    element.attrs['src'] ??
    element.attrs['value'] ??
    deepText(element);
  return value.trim();
}

interface PropEntry {
  readonly element: MiniElement;
  readonly tokens: readonly string[];
}

/**
 * Collect the itemprop entries of one microdata item. A nested
 * `itemscope` child is a boundary: recorded as a property (e.g.
 * `offers`) but never descended into — its inner props belong to the
 * nested item.
 */
function collectProps(element: MiniElement, out: PropEntry[]): void {
  for (const child of element.children) {
    const tokens = (child.attrs['itemprop'] ?? '').split(/\s+/).filter(Boolean);
    if (tokens.length > 0) out.push({ element: child, tokens });
    if (!('itemscope' in child.attrs)) collectProps(child, out);
  }
}

function firstProp(props: readonly PropEntry[], token: string): PropEntry | null {
  // Schema.org itemprop tokens are matched case-insensitively: PrestaShop
  // themes emit `itemprop="GTIN13"` while the lookups below use the
  // lowercase schema term — exact matching silently dropped the GTIN.
  const needle = token.toLowerCase();
  return (
    props.find((entry) => entry.tokens.some((t) => t.toLowerCase() === needle)) ??
    null
  );
}

function propText(props: readonly PropEntry[], token: string): string | null {
  const entry = firstProp(props, token);
  if (entry === null) return null;
  const value = itempropValue(entry.element);
  return value === '' ? null : value;
}

function propGtin(props: readonly PropEntry[]): string | null {
  for (const key of GTIN_PROPS) {
    const entry = firstProp(props, key);
    if (entry === null) continue;
    const raw = readGtinRaw(itempropValue(entry.element));
    if (raw !== null) return raw;
  }
  return null;
}

function buildOffer(props: readonly PropEntry[]): StructuredOffer {
  const priceRaw = propText(props, 'price');
  const priceCents = priceRaw === null ? null : priceToCents(priceRaw);
  return {
    priceCents,
    currency: propText(props, 'priceCurrency'),
    availability: propText(props, 'availability'),
  };
}

export function readMicrodataProduct(html: string): StructuredProduct | null {
  const root = buildTree(html);

  const productElement = findElement(root, (el) =>
    PRODUCT_ITEMTYPE.test(el.attrs['itemtype'] ?? ''),
  );
  if (productElement === null) return null;

  const props: PropEntry[] = [];
  collectProps(productElement, props);

  let offer: StructuredOffer | null = null;
  let offerGtin: string | null = null;
  const offersEntry = firstProp(props, 'offers');
  // The Offer is a nested microdata item (its own itemscope) — its
  // props resolve against itself, and viinarannasta pins the GTIN13
  // there rather than on the Product scope.
  if (offersEntry !== null && 'itemscope' in offersEntry.element.attrs) {
    const offerProps: PropEntry[] = [];
    collectProps(offersEntry.element, offerProps);
    offer = buildOffer(offerProps);
    offerGtin = propGtin(offerProps);
  }

  return {
    name: propText(props, 'name') ?? '',
    brand: propText(props, 'brand'),
    gtin: propGtin(props) ?? offerGtin,
    sku: propText(props, 'sku'),
    description: propText(props, 'description'),
    offer,
  };
}

function findElement(
  element: MiniElement,
  predicate: (el: MiniElement) => boolean,
): MiniElement | null {
  if (element.tag !== '#root' && predicate(element)) return element;
  for (const child of element.children) {
    const found = findElement(child, predicate);
    if (found !== null) return found;
  }
  return null;
}

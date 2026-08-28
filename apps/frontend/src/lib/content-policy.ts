/**
 * Content policy module for enforcing neutral, factual language.
 *
 * Rajahinta.fi is a calculator, not a shop. All user-facing copy must be
 * identification, classification, calculation, or comparison — no subjective
 * adjectives, no promotional language.
 *
 * @module ContentPolicy
 */

export interface ContentViolation {
  /** The forbidden word or phrase found */
  readonly word: string;
  /** Surrounding context (±40 chars) where the violation was found */
  readonly context: string;
  /** Suggested replacement, if available */
  readonly suggestion?: string;
}

/**
 * Forbidden adjectives and promotional phrases.
 * Checked case-insensitively against word boundaries.
 *
 * English vocabulary covers the UI chrome and the English message catalog;
 * the Finnish vocabulary mirrors the backend ContentLintService banned
 * patterns (see src/lib/content-lint.ts) so the Finnish catalog is policed
 * with equivalent strictness.
 */
export const FORBIDDEN_ADJECTIVES: ReadonlyMap<string, string | undefined> =
  new Map([
    // English
    ['best', undefined],
    ['amazing', undefined],
    ['top bargain', undefined],
    ['greatest', undefined],
    ['superior', undefined],
    ['premium', 'use the actual product tier or skip the descriptor'],
    ['exclusive', undefined],
    ['cheapest', 'use "lowest landed cost" or "lowest price"'],
    ['unbeatable', undefined],
    ['incredible', undefined],
    ['fantastic', undefined],
    ['outstanding', undefined],
    ['perfect', undefined],
    ['ultimate', undefined],
    ['unmatched', undefined],
    ['unrivaled', undefined],
    ['world-class', undefined],
    ['first-class', undefined],
    ['top-notch', undefined],
    ['top-tier', undefined],
    ['must-have', undefined],
    ['best-in-class', undefined],
    ['game-changer', undefined],
    ['revolutionary', undefined],
    ['legendary', undefined],
    ['iconic', undefined],
    ['award-winning', undefined],
    ['bestseller', undefined],
    ['best seller', undefined],
    ['bargain', 'state the actual price or cost difference'],
    ['steal', undefined],
    ['deal', undefined],
    ['hot deal', undefined],
    ['killer deal', undefined],
    ['insane', undefined],
    ['crazy', undefined],
    ['ridiculous', undefined],
    ['mind-blowing', undefined],
    ['jaw-dropping', undefined],
    ['stunning', undefined],
    ['brilliant', undefined],
    ['magnificent', undefined],
    ['spectacular', undefined],
    ['phenomenal', undefined],
    ['extraordinary', undefined],
    ['remarkable', undefined],
    ['exceptional', undefined],
    ['impressive', undefined],
    ['top', undefined],
    ['lowest price', 'use "lowest landed cost" for total comparison'],
    ['lowest cost', undefined],
    // Finnish (mirrors the backend ContentLintService vocabulary)
    ['paras', 'käytä neutraalia kuvausta tai jätä arvio pois'],
    ['edullisin', 'käytä "matalin kokonaiskustannus" tai "matalin hinta"'],
    ['laadukas', 'käytä todellista tuotteen tasoa tai jätä kuvaus pois'],
    ['ensiluokkainen', undefined],
    ['ainutlaatuinen', undefined],
    ['täydellinen', undefined],
    ['haitaton', 'alcohol is not harmless; state facts only'],
    ['turvallisin', undefined],
  ]);

const CONTEXT_CHARS = 40;

/**
 * Extract a snippet of surrounding text around a match position.
 */
function extractContext(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const match = text.slice(start, end);
  const after = text.slice(end, Math.min(text.length, end + CONTEXT_CHARS));
  return `...${before}[${match}]${after}...`;
}

/**
 * Scan text for forbidden adjectives and promotional language.
 *
 * Returns an array of violations. Each violation includes the forbidden word,
 * the surrounding context, and an optional suggestion for replacement.
 *
 * @example
 * ```ts
 * const violations = checkContent("This is the best beer in Finland");
 * // → [{ word: 'best', context: '...This is the [best] beer in Fin...' }]
 * ```
 */
export function checkContent(text: string): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const [word, suggestion] of FORBIDDEN_ADJECTIVES) {
    // Build a regex with word boundaries for single words, or literal match for phrases
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern =
      word.includes(' ')
        ? new RegExp(escaped, 'gi')
        : new RegExp(`\\b${escaped}\\b`, 'gi');

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      violations.push({
        word,
        context: extractContext(text, match.index, match.index + match[0].length),
        suggestion,
      });
    }
  }

  return violations;
}

/**
 * Check if text passes the content policy (no violations).
 */
export function isCompliant(text: string): boolean {
  return checkContent(text).length === 0;
}

/**
 * Client-side content lint utility.
 *
 * Mirrors the backend ContentLintService banned-pattern vocabulary so the
 * frontend can warn about promotional or subjective product descriptions
 * without a round-trip to the API.
 *
 * @module ContentLint
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single content-policy violation detected by the linter.
 */
export interface ContentViolation {
  /** The matched banned pattern (e.g. "paras", "best", "bästa"). */
  readonly pattern: string;
  /** The field where the pattern was found — "name" or "description". */
  readonly field: 'name' | 'description';
  /** ISO 639-1 language code inferred from the pattern list. */
  readonly language: 'fi' | 'en' | 'sv';
  /** The verbatim text that matched the banned pattern. */
  readonly matchedText: string;
}

/**
 * Result of linting a product's name and description.
 */
export interface LintResult {
  /** All violations found across both fields (empty array = clean). */
  readonly violations: ContentViolation[];
}

// ---------------------------------------------------------------------------
// Banned-pattern vocabulary
// ---------------------------------------------------------------------------

interface BannedEntry {
  /** The pattern to search for (case-insensitive). */
  readonly pattern: string;
  /** Language tag. */
  readonly language: 'fi' | 'en' | 'sv';
  /** Whether the pattern spans multiple words (no word-boundary assertion). */
  readonly isPhrase: boolean;
}

const BANNED_PATTERNS: BannedEntry[] = [
  // Finnish
  { pattern: 'paras', language: 'fi', isPhrase: false },
  { pattern: 'edullisin', language: 'fi', isPhrase: false },
  { pattern: 'laadukas', language: 'fi', isPhrase: false },
  { pattern: 'ensiluokkainen', language: 'fi', isPhrase: false },
  { pattern: 'ainutlaatuinen', language: 'fi', isPhrase: false },
  { pattern: 'täydellinen', language: 'fi', isPhrase: false },
  { pattern: 'haitaton', language: 'fi', isPhrase: false },
  { pattern: 'turvallisin', language: 'fi', isPhrase: false },

  // English
  { pattern: 'best', language: 'en', isPhrase: false },
  { pattern: 'cheapest', language: 'en', isPhrase: false },
  { pattern: 'highest quality', language: 'en', isPhrase: true },
  { pattern: 'premium', language: 'en', isPhrase: false },
  { pattern: 'exclusive', language: 'en', isPhrase: false },
  { pattern: 'perfect', language: 'en', isPhrase: false },
  { pattern: 'guaranteed', language: 'en', isPhrase: false },

  // Swedish
  { pattern: 'bästa', language: 'sv', isPhrase: false },
  { pattern: 'billigast', language: 'sv', isPhrase: false },
  { pattern: 'högsta kvalitet', language: 'sv', isPhrase: true },
  { pattern: 'exklusiv', language: 'sv', isPhrase: false },
  { pattern: 'perfekt', language: 'sv', isPhrase: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters in a string so it can be used as a literal
 * match inside a `RegExp` constructor.
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan a single text field for banned patterns.
 *
 * Single-word patterns use word-boundary assertions (`\b`) to avoid matching
 * inside compound words.  Multi-word phrases use literal substring matching.
 *
 * @returns All violations found, or an empty array.
 */
function scanField(
  text: string,
  field: 'name' | 'description',
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const entry of BANNED_PATTERNS) {
    const escaped = escapeRegex(entry.pattern);
    const regex = entry.isPhrase
      ? new RegExp(escaped, 'gi')
      : new RegExp(`\\b${escaped}\\b`, 'gi');

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      violations.push({
        pattern: entry.pattern,
        field,
        language: entry.language,
        matchedText: match[0],
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lint a product's name and description for content-policy violations.
 *
 * Both fields are checked against the full banned vocabulary.  The function
 * never mutates data and never throws — violations are collected into the
 * returned result for the caller to handle.
 *
 * Mirrors the backend {@link ContentLintService.lintProductContent} signature.
 *
 * @example
 * ```ts
 * const result = lintProductContent('Paras olut', 'Premium laatu');
 * // result.violations.length === 2
 * ```
 */
export function lintProductContent(
  name: string,
  description: string,
): LintResult {
  const violations: ContentViolation[] = [
    ...scanField(name, 'name'),
    ...scanField(description, 'description'),
  ];

  return { violations };
}

/**
 * Quick check — returns `true` when the product name and description are
 * free of any banned promotional language.
 */
export function isContentClean(name: string, description: string): boolean {
  return lintProductContent(name, description).violations.length === 0;
}
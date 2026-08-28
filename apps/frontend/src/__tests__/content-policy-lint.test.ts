/**
 * Content policy lint test.
 *
 * Scans all .tsx files under src/ for forbidden adjectives and promotional
 * language, and scans the message catalogs under src/messages/ so both the
 * Finnish and English locales are policed. Runs as part of
 * `test:content-policy` to enforce neutral, factual copy across the
 * frontend.
 *
 * Comments (JSDoc, line, block) are stripped before scanning because they
 * don't become rendered user-facing text.
 *
 * This test is intentionally in src/__tests__/ (not alongside source) so it
 * doesn't ship with the app bundle.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContent, type ContentViolation } from '../lib/content-policy';

const SRC_DIR = resolve(import.meta.dirname, '..');
const MESSAGES_DIR = resolve(SRC_DIR, 'messages');

/** Files that define or test the content policy — excluded from lint. */
const EXCLUDED_FILES = new Set([
  'content-policy.ts',
  'content-policy.test.ts',
  'content-policy-lint.test.ts',
]);

/**
 * Strip single-line comments, multi-line comments, and JSDoc from source.
 * Comments don't become rendered user-facing text.
 */
function stripComments(source: string): string {
  // Remove single-line comments (// ...) but not inside strings
  // Remove block comments (/* ... */ and /** ... */)
  // This regex handles the common cases; edge cases in template literals
  // are acceptable since those would also not typically contain forbidden words.
  return source
    .replace(/\/\*\*[\s\S]*?\*\//g, '')  // JSDoc
    .replace(/\/\*[\s\S]*?\*\//g, '')    // block comments
    .replace(/\/\/.*$/gm, '');           // line comments
}

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') {
        continue;
      }
      results.push(...collectTsxFiles(fullPath));
    } else if (entry.endsWith('.tsx')) {
      if (!EXCLUDED_FILES.has(entry)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/** Collect the locale message catalogs (fi.json, en.json, …). */
function collectCatalogFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => join(dir, entry));
}

/**
 * Flatten a parsed JSON catalog into dotted key → string-value pairs.
 */
function flattenCatalog(
  value: unknown,
  prefix = '',
): Array<{ key: string; text: string }> {
  if (typeof value === 'string') {
    return [{ key: prefix, text: value }];
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => flattenCatalog(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

function expectNoViolations(relativePath: string, content: string): void {
  const violations: ContentViolation[] = checkContent(content);

  if (violations.length > 0) {
    const details = violations
      .map((v) => `  - "${v.word}" at: ${v.context}`)
      .join('\n');
    throw new Error(
      `Content policy violations in ${relativePath}:\n${details}\n\n` +
        'Use neutral, factual language: identification, classification, calculation, comparison.',
    );
  }

  expect(violations).toEqual([]);
}

describe('content policy lint — .tsx files', () => {
  const files = collectTsxFiles(SRC_DIR);

  it(`scans ${files.length} files under src/`, () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const filePath of files) {
    const relativePath = relative(SRC_DIR, filePath);

    it(`${relativePath} contains no forbidden adjectives`, () => {
      const raw = readFileSync(filePath, 'utf-8');
      const content = stripComments(raw);
      expectNoViolations(relativePath, content);
    });
  }
});

describe('content policy lint — message catalogs (all locales)', () => {
  const catalogs = collectCatalogFiles(MESSAGES_DIR);

  it('finds at least the fi and en catalogs', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(2);
    expect(catalogs.map((p) => relative(MESSAGES_DIR, p)).sort()).toEqual(
      expect.arrayContaining(['en.json', 'fi.json']),
    );
  });

  for (const catalogPath of catalogs) {
    const relativePath = relative(SRC_DIR, catalogPath);
    const parsed: unknown = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    const entries = flattenCatalog(parsed);

    it(`${relativePath} contains no forbidden adjectives (${entries.length} strings)`, () => {
      expect(entries.length).toBeGreaterThan(0);
      // Every catalog string value is user-visible copy — lint them all.
      for (const { text } of entries) {
        expectNoViolations(relativePath, text);
      }
    });
  }
});

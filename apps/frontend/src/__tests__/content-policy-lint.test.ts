/**
 * Content policy lint test.
 *
 * Scans all .tsx files under src/ for forbidden adjectives and promotional
 * language. Runs as part of `test:content-policy` to enforce neutral, factual
 * copy across the frontend.
 *
 * Comments (JSDoc, line, block) are stripped before scanning because they
 * don't become rendered user-facing text.
 *
 * This test is intentionally in src/__tests__/ (not alongside source) so it
 * doesn't ship with the app bundle.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContent, type ContentViolation } from '../lib/content-policy';

const SRC_DIR = resolve(import.meta.dirname, '..');

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
    .replace(/\/\/.*$/gm, '');            // line comments
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
    });
  }
});

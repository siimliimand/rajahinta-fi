#!/usr/bin/env tsx
/**
 * Content policy lint script (standalone).
 *
 * Scans all .tsx source files under src/ for string literals containing
 * forbidden adjectives or promotional language (e.g. "best", "amazing",
 * "premium").  Comments are stripped before scanning because they don't
 * become rendered user-facing text.
 *
 * Each violation is printed on stderr in the format:
 *   FILE:LINE:COL — violation "WORD" — context
 *
 * Usage:
 *   npx tsx scripts/lint-content-policy.ts
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — violations found (or scan error)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { checkContent, type ContentViolation } from '../src/lib/content-policy';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const SRC_DIR = resolve(import.meta.dirname, '../src');

/**
 * Files that define or test the content policy — excluded from lint.
 * Same exclusion list as the vitest-based test in src/__tests__/.
 */
const EXCLUDED_FILES = new Set([
  'content-policy.ts',
  'content-policy.test.ts',
  'content-policy-lint.test.ts',
]);

/**
 * Regex matching single-quoted, double-quoted, and template-literal strings.
 * Handles escaped quote characters within the string body.
 */
const STRING_LITERAL_RE =
  /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Strip single-line comments, multi-line comments, and JSDoc from source.
 *
 * Reuses the same regex patterns as the vitest-based lint test so that both
 * tools produce consistent results.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*\*[\s\S]*?\*\//g, '') // JSDoc /** ... */
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments /* ... */
    .replace(/\/\/.*$/gm, ''); // line comments // ...
}

/**
 * Recursively collect all .tsx files under `dir`, excluding well-known
 * build/test directories and the content-policy definition files.
 */
function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      // Skip build artifacts and test directories that don't ship as UI
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

/**
 * Compute 1-based line and column numbers for a position within text.
 */
function getLineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos);
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function main(): number {
  const files = collectTsxFiles(SRC_DIR);

  if (files.length === 0) {
    console.error('content-policy: no .tsx files found under src/');
    return 1;
  }

  let totalViolations = 0;
  let fileViolations = 0;

  for (const filePath of files) {
    const raw = readFileSync(filePath, 'utf-8');
    const code = stripComments(raw);

    let match: RegExpExecArray | null;
    fileViolations = 0;

    while ((match = STRING_LITERAL_RE.exec(code)) !== null) {
      const strStart = match.index;

      // Inner content: strip the surrounding quote characters
      const inner = match[0].slice(1, -1);

      const violations: ContentViolation[] = checkContent(inner);
      if (violations.length > 0) {
        const { line, col } = getLineCol(code, strStart);
        const relPath = relative(SRC_DIR, filePath);

        for (const v of violations) {
          console.error(
            `${relPath}:${line}:${col} — violation "${v.word}" — ${v.context}`,
          );
          if (v.suggestion) {
            console.error(`  suggestion: ${v.suggestion}`);
          }
        }
        fileViolations += violations.length;
      }
    }

    if (fileViolations > 0) {
      console.error(`  → ${fileViolations} violation(s) in ${relative(SRC_DIR, filePath)}`);
    }
    totalViolations += fileViolations;
  }

  if (totalViolations > 0) {
    console.error(`\ncontent-policy: ${totalViolations} total violation(s) found.`);
    return 1;
  }

  return 0;
}

process.exit(main());
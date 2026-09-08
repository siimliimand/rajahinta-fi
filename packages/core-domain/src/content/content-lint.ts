/**
 * Content-policy lint for post bodies (task 5.1, change
 * trust-and-reach-roadmap; spec content-publication: post bodies SHALL
 * pass the content-policy lint before publication).
 *
 * Mirrors the frontend content policy's vocabulary (apps/frontend
 * src/lib/content-policy.ts is the UI-face twin; the backend
 * ContentLintService precedent kept the same banned patterns) so a body
 * cannot pass one lint and fail the other. Checked case-insensitively
 * on word boundaries, FI + EN.
 *
 * Enforcement points: the ops publish route refuses a PUBLISHED
 * transition while the body violates, and the content module's tests
 * pin generated drafts clean.
 *
 * @module ContentLint
 */

/**
 * Banned promotional vocabulary — identification and calculation copy
 * only (project rule: a calculator, not a shop). `value` carries a
 * suggested neutral replacement where one exists.
 */
export const FORBIDDEN_TERMS: ReadonlyMap<string, string | undefined> = new Map([
  // English
  ['best', undefined],
  ['cheapest', 'state the actual price or cost difference'],
  ['bargain', 'state the actual price or cost difference'],
  ['deal', undefined],
  ['amazing', undefined],
  ['premium', 'use the actual product tier or skip the descriptor'],
  ['exclusive', undefined],
  ['perfect', undefined],
  ['unbeatable', undefined],
  ['superior', undefined],
  ['greatest', undefined],
  ['top', undefined],
  // Finnish
  ['paras', undefined],
  ['halvin', 'ilmoita toteutunut hinta tai kustannusero'],
  ['tarjous', 'ilmoita toteutunut hinta tai kustannusero'],
  ['erinomainen', undefined],
  ['mahtava', undefined],
  ['uskomaton', undefined],
  ['ennennäkemätön', undefined],
  ['prämiumpaketti', undefined],
]);

/** Find every banned term occurring in `text` on a word boundary. */
export function lintContentPolicy(text: string): { word: string; suggestion?: string }[] {
  const violations: { word: string; suggestion?: string }[] = [];
  for (const [term, suggestion] of FORBIDDEN_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu');
    if (pattern.test(text)) {
      violations.push(
        suggestion === undefined ? { word: term } : { word: term, suggestion },
      );
    }
  }
  return violations;
}

/** Whether `text` is publishable under the content policy. */
export function passesContentPolicy(text: string): boolean {
  return lintContentPolicy(text).length === 0;
}

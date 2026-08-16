/**
 * Evidence utilities for classification results.
 *
 * Provides a pure function to derive a human-readable summary paragraph
 * from the structured evidence array. Ensures the contract that output
 * is always phrased as an observed pattern with supporting evidence —
 * never as a bare legal conclusion.
 *
 * @module EvidenceUtils
 */

import type { EvidenceDetail } from './classification.types';

/**
 * Build a human-readable evidence summary from the evidence array.
 *
 * Each evidence item is rendered as a bullet point prefixed with "Based on:".
 * Empty or single-item arrays produce a concise sentence rather than a list.
 *
 * @param evidence — Ordered array of evidence details supporting a decision.
 * @returns        A plain-text paragraph suitable for end-user display.
 */
export function buildEvidenceSummary(evidence: EvidenceDetail[]): string {
  if (!evidence || evidence.length === 0) {
    return 'No supporting evidence recorded.';
  }

  if (evidence.length === 1) {
    const e = evidence[0];
    return `Based on: ${e.observation} (${e.supportingData})`;
  }

  const bullets = evidence.map(
    (e) => `- Based on: ${e.observation} (${e.supportingData})`,
  );

  return `Classification based on the following evidence:\n${bullets.join('\n')}`;
}
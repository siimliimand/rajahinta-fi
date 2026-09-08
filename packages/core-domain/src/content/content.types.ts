/**
 * Blog-content types — rate-change explainer drafts (task 5.1, change
 * trust-and-reach-roadmap; spec content-publication, design D3).
 *
 * The draft builder turns one confirmed rate dataset version's delta
 * into FI + EN DRAFT posts: what changed, the effective date, and the
 * estimated impact on a typical basket. Drafts await human publication;
 * nothing in this module publishes.
 *
 * @module ContentTypes
 */

/** Content locales the draft builder produces (the [locale] route set). */
export const CONTENT_LOCALES = ['fi', 'en'] as const;

export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/** One versioned rate line the delta summarizes (rate_rules projection). */
export interface RateChangeLine {
  /** Tax type the line belongs to (tax_rules.tax_type vocabulary). */
  readonly taxType: string;
  /** Product category the line applies to (normalized category keys). */
  readonly productCategory: string;
  /** Calculation formula reference — how the rate translates to cents. */
  readonly formulaReference: string;
  /** Rate BEFORE the change, in the rule's rate unit. */
  readonly fromRate: number;
  /** Rate AFTER the change, in the rule's rate unit. */
  readonly toRate: number;
}

/**
 * Draft-builder input — one confirmed version's delta. `effectiveFrom`
 * is the version's effective date (what the post announces); the lines
 * are the steps INTO the confirmed version (same scoping as the
 * tax-change alert hook).
 */
export interface RateChangeDraftInput {
  /** The confirmed version's label (version_label vocabulary) — linked on the post. */
  readonly versionLabel: string;
  /** The version's effective date (ISO string) — the announced date. */
  readonly effectiveFrom: string;
  /** Rate lines that changed in this version — at least one. */
  readonly changes: readonly RateChangeLine[];
}

/** One built DRAFT post — the BlogPostRepository create input plus locale. */
export interface BlogDraft {
  /** URL slug — shared across locales (one post, two bodies). */
  readonly slug: string;
  readonly locale: ContentLocale;
  readonly title: string;
  readonly bodyMarkdown: string;
  /** The confirmed version the post explains (BlogPostCreateInput face). */
  readonly rateDatasetVersion: string;
}

/** Slug prefix — deterministic, version-keyed (one draft pair per version). */
export const RATE_CHANGE_SLUG_PREFIX = 'veromuutos';

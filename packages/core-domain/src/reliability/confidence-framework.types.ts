/**
 * Confidence framework types.
 *
 * Defines the confidence level model that layers on top of raw reliability
 * statuses.  Every consumer that renders or acts on data-point reliability
 * uses these types to produce user-facing quality signals.
 *
 * @module ConfidenceFrameworkTypes
 */

import type { ReliabilityStatus } from './reliability.types';

// ---------------------------------------------------------------------------
// Landing-cost input statuses
// ---------------------------------------------------------------------------

/**
 * Named reliability statuses for each material input to the landed-cost
 * calculator.
 *
 * Every input maps to a named data point in the calculation:
 * - `productPrice`  — base product price (source: merchant page or estimate).
 * - `transport`     — shipping cost (source: carrier rate table or estimate).
 * - `excise`        — alcohol excise duty rate (source: Tax Administration
 *                     schedule or fallback).
 * - `containerDuty` — container/package duty (source: official rate or
 *                     category average).
 * - `classification`— transaction classification outcome
 *                     (distance-selling / distance-buying / traveller-import).
 */
export interface LandingCostInputStatuses {
  readonly productPrice: ReliabilityStatus;
  readonly transport: ReliabilityStatus;
  readonly excise: ReliabilityStatus;
  readonly containerDuty: ReliabilityStatus;
  readonly classification: ReliabilityStatus;
}

// ---------------------------------------------------------------------------
// Confidence level
// ---------------------------------------------------------------------------

/**
 * Aggregate confidence level for a result.
 *
 * - `HIGH`:   All constituent data points are VERIFIED.
 * - `MEDIUM`: One or more data points are ESTIMATED; none are STALE or
 *             UNAVAILABLE.
 * - `LOW`:    One or more data points are STALE or UNAVAILABLE.
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

// ---------------------------------------------------------------------------
// Confidence detail — explains WHY
// ---------------------------------------------------------------------------

/**
 * A single data point's reliability status annotated with a human-readable
 * explanation of why it carries that status.
 */
export interface ConfidenceDetail {
  /** The underlying reliability status. */
  readonly status: ReliabilityStatus;
  /** Human-readable explanation of the status reason. */
  readonly detail: string;
  /**
   * Optional name of the input this detail refers to.
   *
   * Populated by {@link computeLandingCostDetail} and
   * {@link getConfidenceForUI} so the UI can display each data
   * point's name alongside its status and explanation.
   */
  readonly inputName?: string;
}

// ---------------------------------------------------------------------------
// Confidence report — full picture
// ---------------------------------------------------------------------------

/**
 * Full confidence report for a computed result.
 *
 * Contains the aggregate level and a per-data-point breakdown that
 * explains why each input contributed its specific status.
 */
export interface ConfidenceReport {
  /** Aggregate confidence across all constituent data points. */
  readonly overall: ConfidenceLevel;
  /** Per-data-point breakdown with explanations. */
  readonly breakdown: ConfidenceDetail[];
}

// ---------------------------------------------------------------------------
// Confidence UI snapshot — directly renderable
// ---------------------------------------------------------------------------

/**
 * A UI-queryable confidence snapshot for the landed-cost calculator.
 *
 * Produced by {@link getConfidenceForUI} for direct rendering in the
 * frontend — no client-side transformation required.
 */
export interface ConfidenceUISnapshot {
  /** Aggregate confidence level as an uppercase string. */
  readonly overall: ConfidenceLevel;
  /** Human-readable paragraph summarising why the confidence is what it is. */
  readonly explanation: string;
  /** Per-input statuses with names, status strings, and detail. */
  readonly inputs: Array<{
    /** Human-readable input name (e.g. "Price", "Transport"). */
    readonly name: string;
    /** Reliability status as an uppercase string. */
    readonly status: ReliabilityStatus;
    /** Human-readable explanation for this input. */
    readonly detail: string;
  }>;
}
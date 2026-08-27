/**
 * ReportExportService — export a persisted calculation record as JSON, CSV,
 * or printable HTML (task 3.3, change phase2-advanced-features).
 *
 * Reads the record through the existing {@link ICalculationRecordQueryPort}
 * — the SAME single record read path the declaration feature uses — and
 * NEVER recomputes figures: every number in every format is copied verbatim
 * from the record (design D2 — a report can never diverge from the
 * calculation the user saw).
 *
 * Provenance rule (spec "Report provenance"): every figure row carries its
 * reliability status, dataset version, and timestamp to the extent the
 * record provides them.  The record persists one record-level confidence
 * and optional per-rule version labels; absent labels are represented as
 * `NOT_PERSISTED` in CSV / "Not persisted" in HTML rather than being
 * reconstructed.
 *
 * The format serializers are pure functions of the record — exported so
 * tests (task 6.2) can exercise RFC-4180 escaping and disclaimer structure
 * without I/O.
 *
 * @module ReportExportService
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  CALCULATION_RECORD_QUERY_PORT,
  CalculationRecordData,
  CalculationRecordNotFoundError,
  ICalculationRecordQueryPort,
} from '@rajahinta/core-domain';
import type { JsonReport } from './reports.dto';

// ---------------------------------------------------------------------------
// Controlled vocabulary (shared across formats)
// ---------------------------------------------------------------------------

/**
 * Dataset-version placeholder for rate/rule provenance the record does not
 * persist.  Absence is a real state — surfaced as fact, never reconstructed.
 */
const NOT_PERSISTED = 'NOT_PERSISTED';

/** CSV column headers — flat line-item schema shared by figure and disclaimer rows. */
const CSV_COLUMNS: readonly string[] = [
  'record_id',
  'label',
  'category',
  'amount_cents',
  'reliability',
  'dataset_version',
  'language',
  'timestamp',
  'detail',
];

/**
 * One flat report row: label, category, amount, reliability, dataset
 * version, and timestamp, plus the record id (rows are self-identifying
 * once exported) and a free-text detail column used by the structural
 * disclaimer row.
 */
interface ReportRow {
  readonly label: string;
  readonly category: string;
  readonly amountCents: number | null;
  readonly reliability: string;
  readonly datasetVersion: string;
  readonly language: string;
  readonly timestamp: string;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Row assembly — verbatim from the record
// ---------------------------------------------------------------------------

/**
 * Build the figure rows the record carries: alcohol excise, container duty,
 * and total.  Figures come verbatim; the record-level confidence is the
 * reliability carried by each line (the record persists no per-line
 * reliability); rule-version labels fall back to {@link NOT_PERSISTED}.
 * Pure.
 */
export function buildFigureRows(record: CalculationRecordData): ReportRow[] {
  const exciseVersion = record.exciseRuleVersionLabel ?? NOT_PERSISTED;
  const containerVersion = record.containerDutyRuleVersionLabel ?? NOT_PERSISTED;
  return [
    {
      label: 'Alcohol excise',
      category: 'alcohol_excise',
      amountCents: record.alcoholExciseCents,
      reliability: record.confidence,
      datasetVersion: exciseVersion,
      language: '',
      timestamp: record.calculationTimestamp,
      detail: '',
    },
    {
      label: 'Container duty',
      category: 'container_duty',
      amountCents: record.containerDutyCents,
      reliability: record.confidence,
      datasetVersion: containerVersion,
      language: '',
      timestamp: record.calculationTimestamp,
      detail: '',
    },
    {
      label: 'Total',
      category: 'total',
      amountCents: record.totalCents,
      reliability: record.confidence,
      // The total spans both rule sets — carry both contributing labels
      // rather than inventing a single version for a composite figure.
      datasetVersion: `excise=${exciseVersion};container=${containerVersion}`,
      language: '',
      timestamp: record.calculationTimestamp,
      detail: '',
    },
  ];
}

/**
 * Build the structural disclaimer row (text + language + version).  This is
 * a data row in the table, never a header comment.  Pure.
 */
export function buildDisclaimerRow(record: CalculationRecordData): ReportRow {
  return {
    label: 'Disclaimer',
    category: 'disclaimer',
    amountCents: null,
    reliability: record.confidence,
    datasetVersion: record.disclaimerVersion,
    language: record.disclaimerLanguage,
    timestamp: record.calculationTimestamp,
    detail: record.disclaimerText,
  };
}

// ---------------------------------------------------------------------------
// JSON — lossless mirror
// ---------------------------------------------------------------------------

/**
 * Build the JSON report: export metadata + the persisted record verbatim
 * (everything the query port returns).  Pure.
 */
export function buildJsonReport(record: CalculationRecordData): JsonReport {
  return {
    format: 'json',
    recordId: record.id,
    generatedAt: new Date().toISOString(),
    record,
  };
}

// ---------------------------------------------------------------------------
// CSV — RFC 4180
// ---------------------------------------------------------------------------

/**
 * Escape one CSV field per RFC 4180: wrap in quotes when the field contains
 * a comma, a double quote, CR, or LF; embedded double quotes are doubled.
 * Pure.
 */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Render one report row to CSV cells (pure). */
function rowToCsv(recordId: number, row: ReportRow): string {
  return [
    String(recordId),
    row.label,
    row.category,
    row.amountCents === null ? '' : String(row.amountCents),
    row.reliability,
    row.datasetVersion,
    row.language,
    row.timestamp,
    row.detail,
  ]
    .map(escapeCsvField)
    .join(',');
}

/**
 * Build the flat CSV report: header + figure rows + structural disclaimer
 * trailing row, CRLF line breaks per RFC 4180.  Pure.
 */
export function buildCsvReport(record: CalculationRecordData): string {
  const lines = [
    CSV_COLUMNS.join(','),
    ...buildFigureRows(record).map((row) => rowToCsv(record.id, row)),
    rowToCsv(record.id, buildDisclaimerRow(record)),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// HTML — printable report (browser print-to-PDF, no dependencies)
// ---------------------------------------------------------------------------

/** Escape text for safe interpolation into HTML content and attributes. Pure. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a value that may be absent as a controlled-vocabulary label. Pure. */
function textOrUnknown(value: string | null): string {
  return value === null || value === '' ? 'UNKNOWN' : value;
}

/** Map deposit-system status to a controlled-vocabulary label. Pure. */
function depositStatus(status: boolean | null): string {
  if (status === true) return 'IN_DEPOSIT_SYSTEM';
  if (status === false) return 'NOT_IN_DEPOSIT_SYSTEM';
  return 'UNKNOWN';
}

/** One `<tr>` from label/value cells (pure). */
function htmlRow(cells: readonly string[]): string {
  const tds = cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('');
  return `<tr>${tds}</tr>`;
}

/** Definition-list entry (pure). */
function htmlDefRow(label: string, value: string): string {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

/**
 * Build the self-contained printable HTML report: inline CSS only, no
 * external assets, controlled-vocabulary labels, and the disclaimer as a
 * rendered block (spec "Printable report" / "Structural disclaimer").
 * Pure.
 */
export function buildHtmlReport(record: CalculationRecordData): string {
  const rows = buildFigureRows(record)
    .map((row) =>
      htmlRow([
        row.label,
        row.category,
        row.amountCents === null ? '' : String(row.amountCents),
        row.reliability,
        row.datasetVersion,
        row.timestamp,
      ]),
    )
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(record.disclaimerLanguage)}">
<head>
<meta charset="utf-8">
<title>Calculation report ${record.id} — ${escapeHtml(record.productName)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 2rem auto; max-width: 46rem; color: #111; line-height: 1.45; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.05rem; margin-top: 1.5rem; border-bottom: 1px solid #999; padding-bottom: 0.2rem; }
  .meta { color: #444; font-size: 0.85rem; margin-bottom: 1rem; }
  .row { display: flex; justify-content: space-between; padding: 0.15rem 0; border-bottom: 1px dotted #ccc; }
  .label { color: #444; }
  .value { font-weight: bold; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { border: 1px solid #999; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .disclaimer { margin-top: 1.5rem; border: 2px solid #333; padding: 0.75rem 1rem; }
  .disclaimer p { margin: 0.5rem 0 0 0; }
  .disclaimer .version { font-size: 0.8rem; color: #444; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Calculation report</h1>
<p class="meta">Record ${record.id} · generated ${escapeHtml(new Date().toISOString())} · figures verbatim from the persisted calculation</p>

<h2>Product</h2>
${htmlDefRow('Name', record.productName)}
${htmlDefRow('Brand', textOrUnknown(record.productBrand))}
${htmlDefRow('Category', record.productCategory)}
${htmlDefRow('Alcohol by volume (%)', String(record.alcoholByVolume))}
${htmlDefRow('Volume (litres)', String(record.volumeLitres))}
${htmlDefRow('Quantity', String(record.quantity))}
${htmlDefRow('Container type', record.containerType)}
${htmlDefRow('Deposit system', depositStatus(record.depositSystemStatus))}

<h2>Transport</h2>
${htmlDefRow('Carrier', textOrUnknown(record.transportCarrier))}
${htmlDefRow('Origin', textOrUnknown(record.transportOrigin))}
${htmlDefRow('Destination', textOrUnknown(record.transportDestination))}

<h2>Assessment</h2>
${htmlDefRow('Classification', record.classification)}
${htmlDefRow('Confidence', record.confidence)}
${htmlDefRow('Calculated at', record.calculationTimestamp)}

<h2>Figures</h2>
<table>
  <thead>
    <tr><th>Label</th><th>Category</th><th>Amount (cents)</th><th>Reliability</th><th>Dataset version</th><th>Timestamp</th></tr>
  </thead>
  <tbody>
      ${rows}
  </tbody>
</table>

<div class="disclaimer">
  <strong>Disclaimer</strong>
  <p>${escapeHtml(record.disclaimerText)}</p>
  <p class="version">Version ${escapeHtml(record.disclaimerVersion)} · language ${escapeHtml(record.disclaimerLanguage)}</p>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Read a calculation record through {@link ICalculationRecordQueryPort}
 * and serialize it to the requested export format.
 *
 * The port binding travels with the module (see {@link ReportsModule}); the
 * service itself is storage-agnostic and does no recomputation.
 */
@Injectable()
export class ReportExportService {
  constructor(
    @Inject(CALCULATION_RECORD_QUERY_PORT)
    private readonly recordQuery: ICalculationRecordQueryPort,
  ) {}

  /**
   * Load the persisted record — the single read path shared with the
   * declaration feature.
   *
   * @throws {CalculationRecordNotFoundError} when the record does not exist.
   * @throws {Error} when the query port is not wired to a concrete adapter.
   */
  async loadRecord(recordId: number): Promise<CalculationRecordData> {
    if (!this.recordQuery) {
      throw new Error(
        'CALCULATION_RECORD_QUERY_PORT is not wired to a concrete adapter — ' +
          'bind one via ReportsModule.forRoot({ recordQueryPort }) from the ' +
          'composition root.',
      );
    }
    const record = await this.recordQuery.findById(recordId);
    if (record === null) {
      throw new CalculationRecordNotFoundError(recordId);
    }
    return record;
  }

  /** Export the record as a lossless JSON report. */
  async exportJson(recordId: number): Promise<JsonReport> {
    return buildJsonReport(await this.loadRecord(recordId));
  }

  /** Export the record as an RFC-4180 flat CSV table. */
  async exportCsv(recordId: number): Promise<string> {
    return buildCsvReport(await this.loadRecord(recordId));
  }

  /** Export the record as a self-contained printable HTML page. */
  async exportHtml(recordId: number): Promise<string> {
    return buildHtmlReport(await this.loadRecord(recordId));
  }
}

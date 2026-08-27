/**
 * ReportsController tests — format handling, verbatim figures, and the
 * structural disclaimer across json/csv/html (task 6.2, change
 * phase2-advanced-features).
 *
 * Exercises the controller with a REAL ReportExportService reading through
 * an in-memory ICalculationRecordQueryPort double (plain object — golden-
 * dataset convention, no vi.fn()). The pure serializers are additionally
 * proven via the full controller path: the fixture disclaimer deliberately
 * contains a comma, double quotes, and a CRLF so RFC-4180 escaping is
 * observable end-to-end, and the CSV is parsed back with a quote-aware
 * parser to prove the escaping round-trips.
 *
 * @module ReportsControllerTest
 */

import { describe, it, expect } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  CalculationRecordData,
  ICalculationRecordQueryPort,
} from '@rajahinta/core-domain';
import { ReportsController } from '../reports.controller';
import { ReportExportService } from '../report-export.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECORD_ID = 4242;

/**
 * Disclaimer carrying every RFC-4180 escape trigger: a comma, double
 * quotes, and an embedded CRLF. If any of these were escaped incorrectly,
 * the quote-aware parse below would fail.
 */
const ESCAPABLE_DISCLAIMER =
  'Estimate only, "unofficial" —\r\nsee vero.fi for the authoritative figure.';

const RECORD: CalculationRecordData = {
  id: RECORD_ID,
  productName: 'Premium Lager 5%',
  productBrand: 'Golden Brewery',
  productCategory: 'beer',
  alcoholByVolume: 0.05,
  volumeLitres: 0.5,
  containerType: 'can',
  depositSystemStatus: true,
  quantity: 6,
  transportCarrier: 'beverage-de',
  transportOrigin: 'DE',
  transportDestination: 'FI',
  alcoholExciseCents: 100,
  containerDutyCents: 0,
  totalCents: 2000,
  confidence: 'HIGH',
  classification: 'DistanceSelling',
  disclaimerText: ESCAPABLE_DISCLAIMER,
  disclaimerLanguage: 'en',
  disclaimerVersion: '1.0.0',
  calculationTimestamp: '2026-08-20T12:00:00.000Z',
  exciseRuleVersionLabel: '2026-01',
  // Container duty was deposit-exempt with no persisted label — the CSV
  // must surface NOT_PERSISTED, never reconstruct one.
  containerDutyRuleVersionLabel: null,
};

/** Plain-object port double — the established convention for port fakes. */
const recordQueryPort: ICalculationRecordQueryPort = {
  async findById(id: number): Promise<CalculationRecordData | null> {
    return id === RECORD_ID ? RECORD : null;
  },
};

/** Recording response double — plain object, no vi.fn. */
class RecordingResponse {
  readonly calls: Array<{ name: string; value: string }> = [];

  header(name: string, value: string): void {
    this.calls.push({ name, value });
  }

  valueOf(name: string): string | undefined {
    return this.calls.find((c) => c.name === name)?.value;
  }
}

function createController(): ReportsController {
  return new ReportsController(new ReportExportService(recordQueryPort));
}

// ---------------------------------------------------------------------------
// RFC-4180 quote-aware parser — proves escaping round-trips
// ---------------------------------------------------------------------------

/**
 * Parse CSV into rows of fields, honouring quoted fields with doubled
 * quotes and embedded commas / CR / LF. Throws on a malformed quote state
 * so a broken escape cannot pass silently.
 */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < csv.length) {
    const ch = csv[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) {
        throw new Error(`Malformed CSV: quote inside unquoted field at ${i}`);
      }
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && csv[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV column headers the contract fixes (structural, order-stable). */
const CSV_COLUMNS = [
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

// ---------------------------------------------------------------------------
// Tests — JSON (default)
// ---------------------------------------------------------------------------

describe('ReportsController — GET /api/v1/reports/:recordId (json)', () => {
  it('defaults to json and returns a lossless mirror of the record', async () => {
    const controller = createController();

    const report = await controller.getReport(RECORD_ID);

    expect(typeof report).toBe('object');
    const json = report as { format: string; recordId: number; generatedAt: string; record: CalculationRecordData };
    expect(json.format).toBe('json');
    expect(json.recordId).toBe(RECORD_ID);
    expect(json.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Verbatim, lossless record — figures are never recomputed.
    expect(json.record).toEqual(RECORD);
  });

  it('explicit format=json behaves the same', async () => {
    const controller = createController();
    const report = await controller.getReport(RECORD_ID, 'json');
    expect((report as { record: CalculationRecordData }).record).toEqual(RECORD);
  });

  it('empty format string falls back to json', async () => {
    const controller = createController();
    const report = await controller.getReport(RECORD_ID, '');
    expect((report as { format: string }).format).toBe('json');
  });

  it('sets no response headers for json', async () => {
    const controller = createController();
    const res = new RecordingResponse();
    await controller.getReport(RECORD_ID, 'json', res);
    expect(res.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — CSV
// ---------------------------------------------------------------------------

describe('ReportsController — GET /api/v1/reports/:recordId?format=csv', () => {
  async function getCsv(): Promise<{ body: string; res: RecordingResponse }> {
    const controller = createController();
    const res = new RecordingResponse();
    const body = (await controller.getReport(RECORD_ID, 'csv', res)) as string;
    return { body, res };
  }

  it('serves text/csv as an attachment with the record id in the filename', async () => {
    const { body, res } = await getCsv();

    expect(typeof body).toBe('string');
    expect(res.valueOf('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.valueOf('Content-Disposition')).toBe(
      `attachment; filename="rajahinta-calculation-${RECORD_ID}.csv"`,
    );
  });

  it('uses CRLF line breaks and ends with a trailing CRLF (RFC 4180)', async () => {
    const { body } = await getCsv();
    expect(body.endsWith('\r\n')).toBe(true);
    // No bare LF outside quoted fields: strip the quoted disclaimer block,
    // then every remaining newline must be CRLF.
    const withoutQuoted = body.replace(/"[\s\S]*?"/g, '""');
    expect(withoutQuoted).not.toMatch(/(?<!\r)\n/);
  });

  it('header row + three figure rows + disclaimer as the structural trailing row', async () => {
    const { body } = await getCsv();
    const rows = parseCsv(body);

    // Exactly 5 rows even though the disclaimer text itself contains a
    // CRLF — the embedded break must stay inside the quoted field.
    expect(rows).toHaveLength(5);

    expect(rows[0]).toEqual(CSV_COLUMNS);

    const [excise, container, total, disclaimer] = [rows[1], rows[2], rows[3], rows[4]] as string[][];

    // Figures verbatim from the record, carrying provenance.
    expect(excise[0]).toBe(String(RECORD_ID));
    expect(excise[1]).toBe('Alcohol excise');
    expect(excise[2]).toBe('alcohol_excise');
    expect(excise[3]).toBe(String(RECORD.alcoholExciseCents));
    expect(excise[4]).toBe(RECORD.confidence);
    expect(excise[5]).toBe(RECORD.exciseRuleVersionLabel);
    expect(excise[7]).toBe(RECORD.calculationTimestamp);

    // Absent container-duty provenance surfaces as NOT_PERSISTED.
    expect(container[5]).toBe('NOT_PERSISTED');

    // The composite total carries both contributing labels.
    expect(total[5]).toBe('excise=2026-01;container=NOT_PERSISTED');
    expect(total[3]).toBe(String(RECORD.totalCents));

    // Disclaimer is the LAST row — a data row, never a comment.
    expect(disclaimer[1]).toBe('Disclaimer');
    expect(disclaimer[2]).toBe('disclaimer');
    expect(disclaimer[3]).toBe(''); // no amount
    expect(disclaimer[5]).toBe(RECORD.disclaimerVersion);
    expect(disclaimer[6]).toBe(RECORD.disclaimerLanguage);
  });

  it('escapes the comma/quote/CRLF disclaimer per RFC 4180 and round-trips', async () => {
    const { body } = await getCsv();
    const rows = parseCsv(body);

    // Round-trip: the parsed detail field equals the original text exactly.
    const disclaimerDetail = rows[4]?.[8];
    expect(disclaimerDetail).toBe(ESCAPABLE_DISCLAIMER);

    // Raw form: the field is quoted and embedded quotes are doubled.
    const escapedForm = `"${ESCAPABLE_DISCLAIMER.replace(/"/g, '""')}"`;
    expect(body).toContain(escapedForm);
  });
});

// ---------------------------------------------------------------------------
// Tests — HTML
// ---------------------------------------------------------------------------

describe('ReportsController — GET /api/v1/reports/:recordId?format=html', () => {
  async function getHtml(): Promise<{ body: string; res: RecordingResponse }> {
    const controller = createController();
    const res = new RecordingResponse();
    const body = (await controller.getReport(RECORD_ID, 'html', res)) as string;
    return { body, res };
  }

  it('serves text/html', async () => {
    const { res } = await getHtml();
    expect(res.valueOf('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('renders the disclaimer as a visible block with version and language', async () => {
    const { body } = await getHtml();

    expect(body).toContain('class="disclaimer"');
    // Text is HTML-escaped: quotes become &quot;, the comma and CRLF stay.
    expect(body).toContain('Estimate only, &quot;unofficial&quot; —');
    expect(body).toContain('see vero.fi for the authoritative figure.');
    expect(body).toContain(`Version ${RECORD.disclaimerVersion}`);
    expect(body).toContain(`language ${RECORD.disclaimerLanguage}`);
  });

  it('is a self-contained printable page with verbatim figures', async () => {
    const { body } = await getHtml();

    expect(body.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(body).toContain('<style>'); // inline CSS only
    // No external assets and no scripting.
    expect(body).not.toContain('<script');
    expect(body).not.toMatch(/\ssrc=/);
    expect(body).not.toMatch(/\shref=/);

    // Title identifies the record; figures come verbatim.
    expect(body).toContain(`Calculation report ${RECORD_ID}`);
    expect(body).toContain(String(RECORD.alcoholExciseCents));
    expect(body).toContain(String(RECORD.totalCents));
    expect(body).toContain(RECORD.productName);
    // NOT_PERSISTED container provenance is a label, not reconstruction.
    expect(body).toContain('NOT_PERSISTED');
  });

  it('uses the disclaimer language as the document language', async () => {
    const { body } = await getHtml();
    expect(body).toContain(`<html lang="${RECORD.disclaimerLanguage}">`);
  });
});

// ---------------------------------------------------------------------------
// Tests — error mapping
// ---------------------------------------------------------------------------

describe('ReportsController — error mapping', () => {
  it('returns 400 for an unsupported format', async () => {
    const controller = createController();
    await expect(controller.getReport(RECORD_ID, 'pdf')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('format validation is case-sensitive: uppercase JSON is a 400', async () => {
    const controller = createController();
    await expect(controller.getReport(RECORD_ID, 'JSON')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400 message names the format and the supported vocabulary', async () => {
    const controller = createController();
    try {
      await controller.getReport(RECORD_ID, 'pdf');
      expect.unreachable('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toContain("'pdf'");
      expect((err as BadRequestException).message).toContain('json, csv, html');
    }
  });

  it('a bad format on an unknown record is still a 400 (validated before I/O)', async () => {
    const controller = createController();
    await expect(controller.getReport(999999, 'pdf')).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each(['json', 'csv', 'html'] as const)(
    'returns 404 for an unknown record in format=%s',
    async (format) => {
      const controller = createController();
      try {
        await controller.getReport(999999, format);
        expect.unreachable('Expected NotFoundException');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).message).toContain(
          'Calculation record 999999 not found',
        );
      }
    },
  );
});

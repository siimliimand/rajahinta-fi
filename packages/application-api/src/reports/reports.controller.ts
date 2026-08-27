/**
 * ReportsController — export a persisted calculation as a report.
 *
 * GET /api/v1/reports/:recordId?format=json|csv|html (default json) serves
 * the record verbatim (never recomputed — design D2):
 *
 * - `json` → application/json (lossless mirror of the record)
 * - `csv`  → text/csv attachment, RFC-4180-escaped, structural disclaimer row
 * - `html` → text/html inline, self-contained printable page
 *
 * Guard stack (order matters — cheap rejections first, matching the
 * historical/basket controllers):
 * 1. RateLimitGuard  — DECLARATION profile (same persisted-record read via
 *    the same port, same payload class; 20 req/min)
 * 2. FeatureFlagGuard + @FeatureFlagDec(ADVANCED_FEATURES) — 403 when the
 *    Phase 2C rollout flag is off (instant rollback)
 * 3. AgeGateGuard    — age confirmation required
 * 4. EntitlementGuard + @RequireFeature('calculation:export') — PREMIUM
 *
 * @module ReportsController
 */

import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CalculationRecordNotFoundError } from '@rajahinta/core-domain';
import { EntitlementGuard, RequireFeature } from '../entitlement';
import { AgeGateGuard } from '../age-gate';
import { RateLimitGuard, RateLimit } from '../rate-limiting';
import { FeatureFlagGuard, FeatureFlagDec, FeatureFlag } from '../feature-flags';
import { ReportExportService } from './report-export.service';
import type { JsonReport, ReportFormat } from './reports.dto';

/**
 * Minimal response shape used with @Res({ passthrough: true }) — structural
 * so it accepts both Express and Fastify replies without a platform
 * dependency in this package.
 */
interface HeaderCapableResponse {
  header(name: string, value: string): unknown;
}

@ApiTags('reports')
@Controller('api/v1/reports')
@UseGuards(RateLimitGuard, FeatureFlagGuard, AgeGateGuard)
@FeatureFlagDec(FeatureFlag.ADVANCED_FEATURES)
export class ReportsController {
  constructor(private readonly reportExport: ReportExportService) {}

  // ---------------------------------------------------------------------------
  // GET /api/v1/reports/:recordId — export a persisted calculation
  // ---------------------------------------------------------------------------

  @Get(':recordId')
  @UseGuards(EntitlementGuard)
  @RequireFeature('calculation:export')
  @RateLimit('DECLARATION')
  @ApiOperation({
    summary: 'Export a persisted calculation as a report',
    description:
      'Serializes the stored calculation record verbatim — figures are ' +
      'never recomputed, so a report can never diverge from the calculation ' +
      'the user saw. JSON mirrors the record losslessly; CSV is a flat ' +
      'RFC-4180 line-item table where every row carries reliability, dataset ' +
      'version, and timestamp, with the disclaimer as a structural trailing ' +
      'row; HTML is a self-contained printable page for browser ' +
      'print-to-PDF. Requires PREMIUM entitlement (calculation:export).',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'csv', 'html'],
    description: 'Export format (default: json)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Report in the requested format — JSON object, text/csv attachment, or printable text/html',
  })
  @ApiResponse({ status: 400, description: 'Unsupported format parameter' })
  @ApiResponse({ status: 403, description: 'Feature flag off, insufficient entitlement, or age confirmation missing' })
  @ApiResponse({ status: 404, description: 'Calculation record not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async getReport(
    @Param('recordId', ParseIntPipe) recordId: number,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: HeaderCapableResponse,
  ): Promise<JsonReport | string> {
    // Validate before any I/O: a bad format on an unknown record is a 400.
    const normalized = this.validateFormat(format);

    try {
      if (normalized === 'json') {
        return await this.reportExport.exportJson(recordId);
      }

      const body =
        normalized === 'csv'
          ? await this.reportExport.exportCsv(recordId)
          : await this.reportExport.exportHtml(recordId);

      if (normalized === 'csv') {
        res?.header('Content-Type', 'text/csv; charset=utf-8');
        res?.header(
          'Content-Disposition',
          `attachment; filename="rajahinta-calculation-${recordId}.csv"`,
        );
      } else {
        res?.header('Content-Type', 'text/html; charset=utf-8');
      }
      return body;
    } catch (err) {
      if (err instanceof CalculationRecordNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to export report',
      );
    }
  }

  /**
   * Normalize the format query parameter: absent/empty defaults to json;
   * anything outside the controlled vocabulary is a 400.
   */
  private validateFormat(format?: string): ReportFormat {
    if (format === undefined || format === '') {
      return 'json';
    }
    if (format === 'json' || format === 'csv' || format === 'html') {
      return format;
    }
    throw new BadRequestException(
      `Unsupported format '${format}'. Supported formats: json, csv, html.`,
    );
  }
}

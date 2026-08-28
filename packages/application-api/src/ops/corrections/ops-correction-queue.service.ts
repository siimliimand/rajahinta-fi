/**
 * OpsCorrectionQueueService — console workflow over the correction queue
 * (task 12.1, change technical-assessment-remediation).
 *
 * Lists, opens, and resolves corrections through the existing
 * CorrectionService (core-domain port behind CORRECTION_REPOSITORY_PORT).
 * Every mutating action writes a durable audit event
 * (entityType `correction`) with the operator identity.
 *
 * @module OpsCorrectionQueueService
 */

import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@rajahinta/core-domain';
import { CorrectionService } from '../../correction';
import type { CorrectionItem, CorrectionListResponse } from '../../correction';
import type { OpsCreateCorrectionDto, OperatorActionDto } from '../ops.dto';

@Injectable()
export class OpsCorrectionQueueService {
  private readonly logger = new Logger(OpsCorrectionQueueService.name);

  constructor(
    private readonly corrections: CorrectionService,
    private readonly audit: AuditService,
  ) {}

  /** The full correction queue, newest first, with evidence fields. */
  async listQueue(): Promise<CorrectionListResponse> {
    return this.corrections.listFlags();
  }

  /** Open a correction flag from the console (audited, operator-attributed). */
  async openCorrection(dto: OpsCreateCorrectionDto): Promise<CorrectionItem> {
    const created = await this.corrections.createFlag({
      targetType: dto.targetType,
      targetId: dto.targetId,
      reason: dto.reason,
    });

    await this.audit.logChange({
      entityType: 'correction',
      entityId: String(created.id),
      action: 'created',
      author: dto.operator,
      reason: dto.reason,
      newValue: {
        targetType: created.targetType,
        targetId: created.targetId,
        status: created.status,
      },
    });

    this.logger.log(
      `Correction ${created.id} opened by operator "${dto.operator}"`,
    );
    return created;
  }

  /**
   * Resolve a correction flag. The resolution note records the operator's
   * decision; the durable audit entry carries operator + timestamp.
   */
  async resolveCorrection(
    id: number,
    dto: OperatorActionDto,
  ): Promise<CorrectionItem> {
    const resolution =
      dto.note?.trim() ||
      `Resolved by ${dto.operator} via operator console`;

    const resolved = await this.corrections.resolveFlag(id, resolution);

    await this.audit.logChange({
      entityType: 'correction',
      entityId: String(id),
      action: 'updated',
      author: dto.operator,
      reason: resolution,
      previousValue: { status: 'open' },
      newValue: { status: resolved.status, resolvedAt: resolved.resolvedAt },
    });

    this.logger.log(
      `Correction ${id} resolved by operator "${dto.operator}"`,
    );
    return resolved;
  }
}

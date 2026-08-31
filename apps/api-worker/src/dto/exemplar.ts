/**
 * Exemplar zod DTO (task 3.1) — proves the validation pattern the
 * per-endpoint schemas (tasks 3.5–3.8) will follow. Shape mirrors the
 * CalculateExciseRequest contract (packages/application-api/src/interfaces)
 * for POST /api/v1/calculations/excise.
 */

import { z } from 'zod';

export const exciseCalculationSchema = z.object({
  category: z.enum(['beer', 'wine', 'spirits', 'intermediate', 'other']),
  volumeLitres: z.number().positive(),
  alcoholByVolume: z.number().min(0).max(100),
});

export type ExciseCalculationDto = z.infer<typeof exciseCalculationSchema>;

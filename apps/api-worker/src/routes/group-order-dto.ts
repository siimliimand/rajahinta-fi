/**
 * Group order DTO layer (task 9.3, change product-roadmap-phases-1-4) —
 * strict zod schemas plus the accounting-only payment-field gate.
 *
 * ACCOUNTING-ONLY BOUNDARY (spec: group-order-ledger, design R12): the
 * API must not process, broker, or facilitate payments, so every group
 * order payload is REJECTED at the DTO validation layer when it carries
 * payment-instrument data. The gate is a deep field-NAME check (the 9.1
 * schema already makes payment-adjacent columns unrepresentable — this is
 * the API layer of the same three-layer boundary): payloads containing
 * card/IBAN/payment/amount-paid vocabulary under ANY key, at ANY depth,
 * are rejected with a 400 that NAMES the offending field
 * (`field 'sharedCosts[0].paymentMethod' is not accepted`), per the spec's
 * named-field validation error. Key NAMES are screened, never values — a
 * participant whose nickname happens to be "PaypalPete" is data, not a
 * payment instrument. Every schema is additionally `.strict()`, so even
 * non-payment unknown keys are rejected — a payload can only ever carry
 * the fields declared here.
 *
 * @module GroupOrderDto
 */

import type { Context } from 'hono';
import { z } from 'zod';
import { ApiHttpError } from '../errors';
import { validationError } from './support';
import type { ZodType } from 'zod';

// ---------------------------------------------------------------------------
// Payment-instrument field gate — the named-field rejection
// ---------------------------------------------------------------------------

/**
 * Payment-instrument vocabulary, normalized (lowercase, non-alphanumerics
 * stripped). SUBSTRING terms flag any key containing them; EXACT terms
 * match only whole keys (the short/broad ones — 'card' must not flag a
 * hypothetical 'cardboard' packaging field, 'paid' not 'spaid').
 * Screened against every group order DTO: none of these is a legitimate
 * group order field — money INPUT to the ledger travels as `cents` on a
 * shared-cost line, which is accounting data, not payment data.
 */
const PAYMENT_SUBSTRING_TERMS: readonly string[] = [
  'cardnumber',
  'cardholder',
  'cardverification',
  'cvv',
  'cvc',
  'iban',
  'payment',
  'checkout',
  'amountpaid',
  'totalpaid',
  'paidamount',
  'datepaid',
];

const PAYMENT_EXACT_TERMS: ReadonlySet<string> = new Set([
  'card',
  'pan',
  'ccv',
  'csc',
  'iban',
  'bic',
  'swift',
  'paypal',
  'venmo',
  'mobilepay',
  'stripe',
  'klarna',
  'accountnumber',
  'bankaccount',
  'routingnumber',
  'sortcode',
  'billingaddress',
  'billingdetails',
  'paid',
  'expiry',
  'expmonth',
  'expyear',
]);

/** Normalize a field name for vocabulary comparison. */
function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether a field name carries payment-instrument vocabulary. */
export function isPaymentInstrumentFieldName(key: string): boolean {
  const normalized = normalizeFieldName(key);
  return (
    PAYMENT_EXACT_TERMS.has(normalized) ||
    PAYMENT_SUBSTRING_TERMS.some((term) => normalized.includes(term))
  );
}

/**
 * Deep-walk a parsed JSON payload and return the dotted paths of every
 * key carrying payment-instrument vocabulary, in discovery order
 * (depth-first, insertion order) — deterministic, so the rejection
 * message is reproducible. Array indices render as `[i]`.
 */
export function findPaymentInstrumentFields(payload: unknown, base = ''): string[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry, i) =>
      findPaymentInstrumentFields(entry, `${base}[${String(i)}]`),
    );
  }
  if (payload !== null && typeof payload === 'object') {
    const found: string[] = [];
    for (const [key, value] of Object.entries(payload)) {
      const path = base === '' ? key : `${base}.${key}`;
      if (isPaymentInstrumentFieldName(key)) {
        found.push(path);
      }
      found.push(...findPaymentInstrumentFields(value, path));
    }
    return found;
  }
  return [];
}

/**
 * Reject a payload carrying payment-instrument fields with the spec's
 * named-field validation error. All offending fields are named (joined
 * '; ' — the same multi-issue convention parseDto uses), first-found
 * first.
 */
export function rejectPaymentInstrumentFields(payload: unknown): void {
  const fields = findPaymentInstrumentFields(payload);
  if (fields.length === 0) {
    return;
  }
  const named = fields.map((field) => `field '${field}' is not accepted`).join('; ');
  throw new ApiHttpError(400, {
    statusCode: 400,
    message: named,
    error: 'ValidationError',
  });
}

/**
 * Parse and validate a group order request body: JSON (an absent or
 * empty body is the legal no-fields session-create payload), the
 * payment-field gate, then the strict schema. Validation failures use
 * the unified 400 ValidationError envelope (parseDto parity).
 */
export async function parseGroupOrderDto<T>(
  c: Context,
  // Input is `unknown` (not T): schemas with `.default()` parse a wider
  // input than they output, and ZodType<T> alone would reject them.
  schema: ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const raw = await c.req.text();
  let payload: unknown = {};
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiHttpError(400, 'Request body must be JSON');
    }
  }
  rejectPaymentInstrumentFields(payload);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Field schemas — messages in the alerts-route style (custom, stable)
// ---------------------------------------------------------------------------

const NICKNAME_MESSAGE = 'nickname must be a string of 1 to 64 characters';

/** The self-chosen participant identity — the only person-derived data a session stores. */
const nicknameSchema = z
  .string({
    required_error: NICKNAME_MESSAGE,
    invalid_type_error: NICKNAME_MESSAGE,
  })
  .trim()
  .min(1, NICKNAME_MESSAGE)
  .max(64, NICKNAME_MESSAGE);

const PRODUCT_ID_MESSAGE = 'productId must be a positive integer';

const productIdSchema = z
  .number({
    required_error: PRODUCT_ID_MESSAGE,
    invalid_type_error: PRODUCT_ID_MESSAGE,
  })
  .int(PRODUCT_ID_MESSAGE)
  .positive(PRODUCT_ID_MESSAGE);

const QUANTITY_MESSAGE = 'quantity must be an integer between 1 and 999';

const quantitySchema = z
  .number({
    required_error: QUANTITY_MESSAGE,
    invalid_type_error: QUANTITY_MESSAGE,
  })
  .int(QUANTITY_MESSAGE)
  .min(1, QUANTITY_MESSAGE)
  .max(999, QUANTITY_MESSAGE);

const SHARED_COST_LABEL_MESSAGE = 'label must be a string of 1 to 100 characters';

const sharedCostLabelSchema = z
  .string({
    required_error: SHARED_COST_LABEL_MESSAGE,
    invalid_type_error: SHARED_COST_LABEL_MESSAGE,
  })
  .trim()
  .min(1, SHARED_COST_LABEL_MESSAGE)
  .max(100, SHARED_COST_LABEL_MESSAGE);

/**
 * Upper bound for one shared-cost line: €1,000,000 in cents. The module
 * overflow-guards its own arithmetic; this keeps absurd input out before
 * it gets there (the alerts-threshold precedent).
 */
const MAX_SHARED_COST_CENTS = 100_000_000;

const SHARED_COST_CENTS_MESSAGE = `cents must be an integer between 0 and ${String(MAX_SHARED_COST_CENTS)}`;

const sharedCostCentsSchema = z
  .number({
    required_error: SHARED_COST_CENTS_MESSAGE,
    invalid_type_error: SHARED_COST_CENTS_MESSAGE,
  })
  .int(SHARED_COST_CENTS_MESSAGE)
  .min(0, SHARED_COST_CENTS_MESSAGE)
  .max(MAX_SHARED_COST_CENTS, SHARED_COST_CENTS_MESSAGE);

const FRONTED_BY_MESSAGE = 'frontedByParticipantId must be a string of 1 to 64 characters';

/** Accounting provenance for a balance — who laid out the money (module docs), never a payment instruction. */
const frontedBySchema = z
  .string({
    required_error: FRONTED_BY_MESSAGE,
    invalid_type_error: FRONTED_BY_MESSAGE,
  })
  .trim()
  .min(1, FRONTED_BY_MESSAGE)
  .max(64, FRONTED_BY_MESSAGE);

const SHARED_COSTS_MESSAGE = 'sharedCosts must contain at most 50 lines';

// ---------------------------------------------------------------------------
// Endpoint DTOs — strict: only the declared fields, nothing else
// ---------------------------------------------------------------------------

/** POST /api/v1/group-orders — the owner and TTL are server-derived; the body carries nothing. */
export const createSessionSchema = z.object({}).strict();

/** POST /api/v1/group-orders/:shareToken/join. */
export const joinSchema = z.object({ nickname: nicknameSchema }).strict();

/** POST /api/v1/group-orders/:shareToken/items. */
export const addItemSchema = z
  .object({
    nickname: nicknameSchema,
    productId: productIdSchema,
    quantity: quantitySchema,
  })
  .strict();

/** One shared-cost line — the module's `frontedByParticipantId` is a session nickname (API decision). */
export const sharedCostSchema = z
  .object({
    label: sharedCostLabelSchema,
    cents: sharedCostCentsSchema,
    frontedByParticipantId: frontedBySchema,
  })
  .strict();

/** POST /api/v1/group-orders/:shareToken/ledger — stateless compute; shared costs arrive per request. */
export const ledgerSchema = z
  .object({
    sharedCosts: z.array(sharedCostSchema).max(50, SHARED_COSTS_MESSAGE).optional().default([]),
  })
  .strict();

export type CreateSessionDto = z.infer<typeof createSessionSchema>;
export type JoinDto = z.infer<typeof joinSchema>;
export type AddItemDto = z.infer<typeof addItemSchema>;
export type SharedCostDto = z.infer<typeof sharedCostSchema>;
export type LedgerDto = z.infer<typeof ledgerSchema>;

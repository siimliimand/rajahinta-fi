/**
 * Scan-label route (task 2.2, change label-scan-product-lookup) —
 * POST /api/v1/products/scan-label.
 *
 * The single-photo label recognition endpoint (design D1: all processing
 * server-side via the AI binding — one round trip keeps the guards and the
 * quota ahead of model cost):
 *
 *   client photo → body validation (magic bytes, ≤ 4 MB) → Workers AI
 *     (pinned model, transcribe-first prompt) → tolerant parse →
 *     token-AND funnel (D1LabelCandidatesRepository) →
 *     { extracted, candidates[] }
 *
 * ## Request contract
 *
 * Exactly one image: a multipart/form-data body with one `image` file
 * part, or a raw image body carrying an image/* content-type. The type is
 * decided from the FILE MAGIC (JPEG FFD8FF / PNG 89504E47 /
 * WebP RIFF…WEBP), never from the declared content-type; an unsupported
 * payload or a > 4 MB body is rejected BEFORE any model invocation (spec
 * "Caps rejected before model invocation").
 *
 * ## Extraction (design D2)
 *
 * The model is the pinned `SCAN_LABEL_MODEL` constant (substitution is a
 * one-line change) run with a transcribe-first prompt: transcribe ALL
 * visible label text (the small print carries ABV like "37.5% vol" and
 * volume like "0.7 L" / "70 cl" / "500 ml"), then emit ONE JSON object.
 * The output is never trusted structurally: code fences are stripped, the
 * first {…} blob is extracted, and a zod schema coerces numerics with
 * null-on-absent (tolerant parse). Model failure or unparseable output is
 * a typed 502 envelope carrying `retryable: true` (the envelope's
 * extra-field pass-through — the retryAfterSeconds precedent).
 *
 * ## Funnel
 *
 * tokens = foldToSearchTokens(brand + product) (label-fold.ts — the
 * explicit diacritic fold unicode61 lacks); abv = abv_percent/100 as the
 * stored fraction when usable (0 < value ≤ 100, spike discipline — else
 * null), volume = volume_l when finite > 0 (else null). Null fields drop
 * their band term INSIDE the repository (structural widening, design D3).
 * The category is kept verbatim for display only — the funnel does not
 * read it in this change.
 *
 * ## Quota (design D5)
 *
 * Anonymous per-IP hourly quota through RateLimiterDO, values in the
 * route's own {@link SCAN_LABEL_QUOTA} constants. The limiter's bucket key
 * is (client IP instance, profile) — the distinct `scan-label` profile
 * keeps scan quota in buckets no other surface shares, and a missing
 * RATE_LIMITER binding fails open exactly like requireRateLimit (the
 * deployment always binds the DO).
 *
 * ## Privacy (design D7 — enforced by construction)
 *
 * This module imports and touches NO storage binding — no R2, no KV, no
 * DO storage of its own, nothing written anywhere. Image bytes live in
 * local variables only, are forwarded to the model as a base64 data URL,
 * and are gone when the handler returns. Nothing about the image or the
 * transcription is ever logged or echoed into an error envelope (the 502
 * bodies carry no model text). The unit suite pins this as a source-level
 * assertion (__tests__/scan-label.routes.test.ts) — "processed in memory,
 * never stored" is a tested property, not a promise. The ONLY persistent
 * write on the path is the rate limiter's quota timestamps (mandated by
 * the spec's 429 requirement); they never see image data.
 *
 * @module ScanLabelRoutes
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { ageGate } from '../middleware/age-gate';
import { checkRateLimit } from '../do/client';
import { resolveClientIdentity } from '../do/identity';
import { foldToSearchTokens } from '../../../../packages/data-platform/src/repositories/d1/label-fold';
import {
  D1LabelCandidatesRepository,
  type LabelCandidate,
} from '../../../../packages/data-platform/src/repositories/d1/label-candidates.repository';

// ---------------------------------------------------------------------------
// Route constants — the pinned model, the caps, the quota
// ---------------------------------------------------------------------------

/**
 * The pinned Workers AI vision model (design D2). A named constant so
 * per-model entitlement drift (the spike saw llama-3.2-vision 403) is a
 * one-line substitution here — nowhere else in the codebase.
 */
export const SCAN_LABEL_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';

/** Hard body cap — 4 MB (4_194_304 bytes), enforced before the model runs. */
export const SCAN_LABEL_MAX_BYTES = 4_194_304;

/**
 * Anonymous per-IP scan quota (design D5, conservative default): ten scans
 * per hour — every scan costs neurons, so the ceiling caps abuse before
 * the first week of staging data tunes it. `profile` is the DO window key:
 * isolated from every other surface's profile buckets by construction.
 */
export const SCAN_LABEL_QUOTA = {
  profile: 'scan-label',
  limit: 10,
  windowMs: 3_600_000,
} as const;

/**
 * Transcribe-first prompt (design D2 — the spike measured that direct
 * extraction misses small-print ABV where transcribe-then-extract reads
 * it). The JSON shape is the verbatim spike contract.
 */
const SCAN_LABEL_PROMPT = [
  'You are reading a photograph of an alcoholic beverage label.',
  'First transcribe ALL visible label text verbatim, including the small print:',
  'the alcohol percentage (e.g. "37.5% vol") and the bottle volume (e.g. "0.7 L", "70 cl", "500 ml").',
  'THEN respond with ONLY a JSON object, no prose before or after, exactly this shape:',
  '{"visible_text": string, "brand": string, "product": string, "abv_percent": number|null, "volume_l": number|null, "category": "beer|wine|sparkling|spirit|liqueur|other"|null, "vintage_year": number|null}',
  'visible_text is the full transcription from step one.',
  'brand and product are the brand name and product name as printed.',
  'abv_percent is the alcohol percentage as a number (37.5 for "37.5% vol"), null when not printed.',
  'volume_l is the bottle volume in litres (0.7 for "70 cl"), null when not printed.',
  'category is one of beer, wine, sparkling, spirit, liqueur, other, null when unclear.',
  'vintage_year is the vintage year, null when not printed.',
].join('\n');

// ---------------------------------------------------------------------------
// Body validation — magic bytes and the size cap, before any model invocation
// ---------------------------------------------------------------------------

/** The accepted image formats, as data-URL subtypes. */
type LabelImageFormat = 'jpeg' | 'png' | 'webp';

/**
 * Decide the image format from FILE MAGIC, never the declared
 * content-type: JPEG FFD8FF, PNG 89504E47, WebP RIFF....WEBP. Null when
 * the bytes match none — the only unsupported-image signal.
 */
function detectLabelImageFormat(bytes: Uint8Array): LabelImageFormat | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}

/** The one validation rejection for "no usable image in this request". */
function missingImageError(): ApiHttpError {
  return new ApiHttpError(400, {
    statusCode: 400,
    message:
      'Expected one "image" file part (multipart/form-data) or a raw JPEG/PNG/WebP image body.',
    error: 'ValidationError',
  });
}

/**
 * Read the request's single image. Two dialects, one contract:
 * multipart/form-data with an `image` file part (the browser upload —
 * client-side downscale → canvas blob → FormData), or a raw body with an
 * image/* content-type (the simplest curl/fixture path). Anything else is
 * a validation error.
 */
async function readImageBytes(c: Context<AppEnv>): Promise<Uint8Array> {
  const contentType = (c.req.header('content-type') ?? '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw new ApiHttpError(400, 'Request body could not be parsed');
    }
    const part = form['image'];
    if (!(part instanceof File)) throw missingImageError();
    return new Uint8Array(await part.arrayBuffer());
  }

  if (contentType.startsWith('image/')) {
    return new Uint8Array(await c.req.arrayBuffer());
  }

  throw missingImageError();
}

/** Base64 of the image bytes — the data URL the model content part takes. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Tolerant extraction parse — fence stripping, coercion, null-on-absent
// ---------------------------------------------------------------------------

/** The parsed label extraction, exactly the model contract's seven fields. */
export interface ExtractedLabel {
  readonly visible_text: string | null;
  readonly brand: string | null;
  readonly product: string | null;
  readonly abv_percent: number | null;
  readonly volume_l: number | null;
  readonly category: string | null;
  readonly vintage_year: number | null;
}

/**
 * A string field the model may omit or garble: strings pass, everything
 * else (including absence) folds to null — never a fabricated value.
 */
const tolerantString = z.unknown().transform((value): string | null =>
  typeof value === 'string' ? value : null,
);

/**
 * A numeric field with coercion: real finite numbers pass; numeric
 * strings parse (comma decimals tolerated — European label text turns up
 * "37,5" as often as "37.5"); anything else folds to null.
 */
const tolerantNumber = z
  .unknown()
  .transform((value): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim().replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  });

/**
 * The category maps freely (kept for display; the funnel does not read
 * it): any string passes verbatim, everything else is null.
 */
const tolerantCategory = tolerantString;

/** The extraction schema — all seven fields, null-on-absent throughout. */
const extractionSchema = z.object({
  visible_text: tolerantString,
  brand: tolerantString,
  product: tolerantString,
  abv_percent: tolerantNumber,
  volume_l: tolerantNumber,
  category: tolerantCategory,
  vintage_year: tolerantNumber,
});

/**
 * Strip markdown code fences and pull out the first {…} JSON blob.
 * Returns undefined when no parseable object exists — the model output is
 * prose-noise by the tolerant-parse contract, never trusted structurally.
 */
export function extractJsonBlob(text: string): unknown {
  const unfenced = text
    .replace(/```[a-zA-Z0-9_-]*/g, '')
    .replace(/```/g, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Parse one model response string into the extraction, or null when the
 * output yields no JSON object at all (the typed-502 case).
 */
export function parseLabelExtraction(text: string): ExtractedLabel | null {
  const blob = extractJsonBlob(text);
  if (blob === undefined || typeof blob !== 'object' || Array.isArray(blob)) {
    return null;
  }
  return extractionSchema.parse(blob);
}

// ---------------------------------------------------------------------------
// Funnel inputs — folded tokens, fraction ABV, litre volume
// ---------------------------------------------------------------------------

/** The funnel parameters the label-candidates repository takes. */
interface LabelFunnelInputs {
  readonly tokens: readonly string[];
  readonly abv: number | null;
  readonly volume: number | null;
}

/**
 * Fold the extraction into funnel inputs: tokens from brand + product
 * (foldToSearchTokens — the explicit diacritic fold), ABV as the stored
 * fraction when usable (0 < percent ≤ 100 → /100, spike discipline —
 * else null), volume in litres when finite > 0 (else null). A null input
 * widens the funnel structurally inside the repository (design D3) —
 * nothing here fabricates a value.
 */
function funnelInputs(extracted: ExtractedLabel): LabelFunnelInputs {
  const tokens = foldToSearchTokens(
    `${extracted.brand ?? ''} ${extracted.product ?? ''}`,
  );
  const percent = extracted.abv_percent;
  const abv =
    percent !== null && percent > 0 && percent <= 100 ? percent / 100 : null;
  const volume =
    extracted.volume_l !== null && extracted.volume_l > 0
      ? extracted.volume_l
      : null;
  return { tokens, abv, volume };
}

// ---------------------------------------------------------------------------
// Quota — anonymous per-IP hourly window (design D5)
// ---------------------------------------------------------------------------

/**
 * The scan surface's own admission middleware, composed over the shared
 * RateLimiterDO client with the route-local {@link SCAN_LABEL_QUOTA} —
 * same sliding window, same 429 envelope + Retry-After header as
 * requireRateLimit, keyed on the edge-attested client IP with the
 * `scan-label` profile (buckets no other surface shares). Fails open
 * without the binding, the requireRateLimit contract.
 */
export function requireScanLabelQuota(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.env.RATE_LIMITER) {
      await next();
      return;
    }
    const decision = await checkRateLimit(
      c.env,
      resolveClientIdentity(c.req.raw.headers),
      { ...SCAN_LABEL_QUOTA },
    );
    if (decision.allowed) {
      await next();
      return;
    }
    const retryAfter = decision.retryAfterSeconds;
    c.header('Retry-After', String(retryAfter));
    throw new ApiHttpError(429, {
      statusCode: 429,
      message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
      error: 'TooManyRequests',
      retryAfterSeconds: retryAfter,
    });
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * The typed 502s (spec: model failure or unparseable output answers a
 * retryable envelope). Bodies carry NO model text and no image-derived
 * data (design D7) — only the machine-readable code distinguishes the
 * two retry shapes.
 */
function modelUnavailableError(): ApiHttpError {
  return new ApiHttpError(502, {
    statusCode: 502,
    message: 'Label recognition is temporarily unavailable. Please try again.',
    error: 'BadGateway',
    code: 'MODEL_UNAVAILABLE',
    retryable: true,
  });
}

function unparseableOutputError(): ApiHttpError {
  return new ApiHttpError(502, {
    statusCode: 502,
    message: 'Label recognition returned an unreadable result. Please try again.',
    error: 'BadGateway',
    code: 'UNPARSEABLE_MODEL_OUTPUT',
    retryable: true,
  });
}

/** POST /api/v1/products/scan-label — see the module doc. */
async function scanLabel(c: Context<AppEnv>): Promise<Response> {
  // Caps BEFORE any model invocation (spec "Caps rejected before model
  // invocation"). The declared content-length is the free precheck; the
  // authoritative cap is on the actual bytes (the header can lie).
  const declaredLength = Number(c.req.header('content-length') ?? '0');
  if (declaredLength > SCAN_LABEL_MAX_BYTES) {
    throw new ApiHttpError(413, {
      statusCode: 413,
      message: `Image must be at most ${SCAN_LABEL_MAX_BYTES} bytes`,
      error: 'PayloadTooLarge',
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = await readImageBytes(c);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(400, 'Request body could not be parsed');
  }
  if (bytes.byteLength > SCAN_LABEL_MAX_BYTES) {
    throw new ApiHttpError(413, {
      statusCode: 413,
      message: `Image must be at most ${SCAN_LABEL_MAX_BYTES} bytes`,
      error: 'PayloadTooLarge',
    });
  }
  const format = detectLabelImageFormat(bytes);
  if (format === null) {
    throw new ApiHttpError(415, {
      statusCode: 415,
      message: 'Image must be a JPEG, PNG, or WebP file',
      error: 'UnsupportedMediaType',
    });
  }

  // The model call (design D1/D2). The image exists here only as this
  // data URL string in local scope — nothing persists, nothing logs.
  // Local dev and the browser-E2E harness boot WITHOUT an AI binding by
  // config (wrangler.jsonc top-level note): degrade to the same typed
  // retryable 502 as a model failure instead of a raw TypeError.
  if (!c.env.AI) {
    throw modelUnavailableError();
  }
  const dataUrl = `data:image/${format};base64,${toBase64(bytes)}`;
  let modelText: string;
  try {
    const output = await c.env.AI.run(SCAN_LABEL_MODEL, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: SCAN_LABEL_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 500,
    });
    modelText = output.response;
  } catch {
    // Model failure (entitlement drift, 5xx, timeout) — a typed retryable
    // 502, never a raw 500, never the failure text (design D7).
    throw modelUnavailableError();
  }

  const extracted = parseLabelExtraction(modelText);
  if (extracted === null) {
    throw unparseableOutputError();
  }

  // The funnel (design D3): token-AND retrieval over the folded brand +
  // product tokens, band-scored by the usable extraction fields only.
  let candidates: LabelCandidate[];
  try {
    candidates = await new D1LabelCandidatesRepository(c.env.DB).findCandidates(
      funnelInputs(extracted),
    );
  } catch (err) {
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Candidate lookup failed',
    );
  }

  return c.json({ extracted, candidates });
}

// ---------------------------------------------------------------------------
// Registration (age gate → quota → handler, the calendar-route pattern)
// ---------------------------------------------------------------------------

/** Register the scan-label endpoint behind its gate and quota. */
export function registerScanLabelRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('POST', '/api/v1/products/scan-label', ageGate());
  app.post('/api/v1/products/scan-label', requireScanLabelQuota(), scanLabel);
  return app;
}

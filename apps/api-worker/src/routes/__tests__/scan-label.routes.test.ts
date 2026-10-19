/**
 * Scan-label route tests (task 2.2, change label-scan-product-lookup) —
 * POST /api/v1/products/scan-label over the full createApp() composition
 * (real age gate, real RateLimiterDO sliding window, real unified error
 * envelope) with TWO seams mocked:
 *
 * - `env.AI.run` — a vi.fn binding; the model's fenced mistral output,
 *   fence-noise output, failures, and prose noise are fixtures here. The
 *   data-URL round trip is decoded and pinned byte-for-byte.
 * - `D1LabelCandidatesRepository` — the funnel's D1 read is mocked so the
 *   suite runs on the default Node config (no node:sqlite; the funnel's
 *   SQL itself is covered by the repository's own D1 suite).
 *
 * Pins: happy path (extracted + candidates envelope, funnel inputs on the
 * stored scales), fence noise + null-on-absent, model failure → typed 502
 * retryable, unparseable output → typed 502 retryable, oversize and
 * wrong-magic rejections BEFORE the model runs, the anonymous per-IP scan
 * quota (429 + Retry-After, isolated per IP), the age gate (403
 * AGE_GATE_REQUIRED before any model cost), and the design-D7 privacy
 * claim as a source-level assertion: the route module imports no storage
 * binding and never logs.
 *
 * @module ScanLabelRoutesTest
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import { createApp } from '../../index';
import { RateLimiterDO } from '../../do/rate-limiter.do';
import {
  SCAN_LABEL_MAX_BYTES,
  SCAN_LABEL_QUOTA,
  SCAN_LABEL_MODEL,
} from '../scan-label.routes';

const { findCandidatesMock } = vi.hoisted(() => ({
  findCandidatesMock: vi.fn(),
}));

// The funnel's D1 read, mocked at the module the route imports — the
// route tests exercise the route's composition, not the SQL (that is the
// repository suite's job), and the suite stays runnable without
// node:sqlite (default Node config).
vi.mock(
  '../../../../../packages/data-platform/src/repositories/d1/label-candidates.repository',
  () => ({
    D1LabelCandidatesRepository: class {
      readonly findCandidates = findCandidatesMock;
    },
  }),
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IP = '203.0.113.7';
const AGE_HEADERS = {
  'cf-connecting-ip': IP,
  'x-age-confirmed': 'test-confirmation',
} as const;

/** Minimal but real JPEG magic (FFD8FF) — validation reads bytes, not names. */
const JPEG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
/** Minimal PNG magic (89504E47). */
const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

/**
 * Realistic fenced mistral output — prose, a ```json fence, the full
 * seven-field object (with Polish diacritics the fold must survive).
 */
const FENCED_MISTRAL_OUTPUT = {
  response: [
    'Here is the transcription and the extracted data:',
    '',
    '```json',
    '{',
    '  "visible_text": "ŻOŁĄDKOWA DE LUXE 37,5% vol 0,7 L",',
    '  "brand": "Żołądkowa",',
    '  "product": "De Luxe",',
    '  "abv_percent": 37.5,',
    '  "volume_l": 0.7,',
    '  "category": "spirit",',
    '  "vintage_year": null',
    '}',
    '```',
  ].join('\n'),
};

const CANDIDATES = [
  {
    id: 42,
    name: 'Zoladkowa De Luxe 0.7L 37.5%',
    alcoholByVolume: 0.375,
    unitVolume: 0.7,
    category: 'spirit',
    lowestPriceCents: 1895,
  },
  {
    id: 7,
    name: 'Zoladkowa Gorzka 0.5L 30%',
    alcoholByVolume: 0.3,
    unitVolume: 0.5,
    category: 'spirit',
    lowestPriceCents: null,
  },
];

// ---------------------------------------------------------------------------
// Harness — AI mock env + in-memory RateLimiterDO namespace (no node:sqlite)
// ---------------------------------------------------------------------------

const runMock = vi.fn();

function scanEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as unknown as Env['DB'], // the mocked repository never touches D1
    LOG_LEVEL: 'error',
    RATE_LIMITER: rateLimiterNamespace(),
    AI: { run: runMock } as unknown as Env['AI'],
    ...overrides,
  } as Env;
}

/** One RateLimiterDO instance per client name over an in-memory map. */
function rateLimiterNamespace(): Env['RATE_LIMITER'] {
  const instances = new Map<string, RateLimiterDO>();
  const makeState = (): ConstructorParameters<typeof RateLimiterDO>[0] => {
    const map = new Map<string, unknown>();
    return {
      storage: {
        async get<T>(key: string): Promise<T | undefined> {
          return map.get(key) as T | undefined;
        },
        async put<T>(key: string, value: T): Promise<void> {
          map.set(key, structuredClone(value));
        },
      },
    } as never;
  };
  return {
    idFromName(name: string) {
      return { name };
    },
    get(id: { name: string }) {
      let instance = instances.get(id.name);
      if (instance === undefined) {
        instance = new RateLimiterDO(makeState(), {});
        instances.set(id.name, instance);
      }
      return { fetch: (request: Request) => instance!.fetch(request) };
    },
  } as unknown as Env['RATE_LIMITER'];
}

function multipartRequest(
  env: Env,
  body: FormData,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return createApp().request('/api/v1/products/scan-label', {
    method: 'POST',
    headers: { ...AGE_HEADERS, ...extraHeaders },
    body,
  }, env) as Promise<Response>;
}

function rawImageRequest(
  env: Env,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return createApp().request('/api/v1/products/scan-label', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...AGE_HEADERS,
      ...extraHeaders,
    },
    body: bytes,
  }, env) as Promise<Response>;
}

function jpegForm(bytes: Uint8Array<ArrayBuffer> = JPEG_BYTES): FormData {
  const form = new FormData();
  form.append('image', new File([bytes], 'label.jpg', { type: 'image/jpeg' }));
  return form;
}

/** Unified error envelope assertion (ApiErrorFilter parity). */
async function expectEnvelope(
  res: Response,
  status: number,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    statusCode: status,
    timestamp: expect.any(String),
    path: '/api/v1/products/scan-label',
    ...fields,
  });
  return body;
}

beforeEach(() => {
  runMock.mockReset();
  findCandidatesMock.mockReset();
});

// ---------------------------------------------------------------------------
// Happy path + tolerant parse
// ---------------------------------------------------------------------------

describe('POST /api/v1/products/scan-label — happy path', () => {
  it('parses fenced mistral output and answers {extracted, candidates}', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue(CANDIDATES);

    const res = await multipartRequest(scanEnv(), jpegForm());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      extracted: {
        visible_text: 'ŻOŁĄDKOWA DE LUXE 37,5% vol 0,7 L',
        brand: 'Żołądkowa',
        product: 'De Luxe',
        abv_percent: 37.5,
        volume_l: 0.7,
        category: 'spirit',
        vintage_year: null,
      },
      candidates: CANDIDATES,
    });
  });

  it('runs the pinned model with the transcribe-first prompt, max_tokens 500', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    await multipartRequest(scanEnv(), jpegForm());

    expect(runMock).toHaveBeenCalledTimes(1);
    const [model, payload] = runMock.mock.calls[0] as unknown as [
      string,
      {
        messages: Array<{
          role: string;
          content: Array<
            | { type: string; text: string }
            | { type: string; image_url: { url: string } }
          >;
        }>;
        max_tokens: number;
      },
    ];
    expect(model).toBe(SCAN_LABEL_MODEL);
    expect(model).toBe('@cf/mistralai/mistral-small-3.1-24b-instruct');
    expect(payload.max_tokens).toBe(500);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]!.role).toBe('user');
    const [textPart, imagePart] = payload.messages[0]!.content;
    expect(textPart!.type).toBe('text');
    expect((textPart as { text: string }).text).toContain('transcribe ALL visible label text');
    expect((textPart as { text: string }).text).toContain('"abv_percent": number|null');
    expect(imagePart!.type).toBe('image_url');
  });

  it('forwards the exact image bytes as the base64 data URL (in-memory round trip)', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    await multipartRequest(scanEnv(), jpegForm());

    const [, payload] = runMock.mock.calls[0] as unknown as [
      string,
      { messages: Array<{ content: Array<{ image_url?: { url: string } }> }> },
    ];
    const url = payload.messages[0]!.content[1]!.image_url!.url;
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const decoded = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    expect(decoded.equals(Buffer.from(JPEG_BYTES))).toBe(true);
  });

  it('feeds the funnel folded tokens, fraction ABV, and litre volume', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue(CANDIDATES);

    await multipartRequest(scanEnv(), jpegForm());

    expect(findCandidatesMock).toHaveBeenCalledTimes(1);
    // The fold: żołądkowa → zoladkowa (unicode61 does not fold it — the
    // explicit fold is the point). ABV on the stored fraction scale
    // (37.5 % → 0.375), volume in litres.
    expect(findCandidatesMock).toHaveBeenCalledWith({
      tokens: ['zoladkowa', 'de', 'luxe'],
      abv: 0.375,
      volume: 0.7,
    });
  });

  it('accepts a raw image body with an image/* content-type', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue(CANDIDATES);

    const res = await rawImageRequest(scanEnv(), JPEG_BYTES, 'image/jpeg');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { extracted: { brand: string | null } };
    expect(body.extracted.brand).toBe('Żołądkowa');
  });

  it('echoes unusable extraction numerics as null funnel inputs (spike discipline)', async () => {
    // 375 % ABV and a non-positive volume are unusable — the funnel input
    // is null (band term dropped / widening), while `extracted` keeps the
    // model's verbatim values for display. Never a fabricated value.
    runMock.mockResolvedValue({
      response:
        '```json\n{"visible_text": "X", "brand": "Mystery", "product": "Spirit", "abv_percent": 375, "volume_l": 0, "category": "other", "vintage_year": 1990}\n```',
    });
    findCandidatesMock.mockResolvedValue([]);

    const res = await multipartRequest(scanEnv(), jpegForm());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { extracted: { abv_percent: number } };
    expect(body.extracted.abv_percent).toBe(375);
    expect(findCandidatesMock).toHaveBeenCalledWith({
      tokens: ['mystery', 'spirit'],
      abv: null,
      volume: null,
    });
  });
});

describe('POST /api/v1/products/scan-label — tolerant parse', () => {
  it('strips fence noise, coerces numeric strings, and defaults absent fields to null', async () => {
    runMock.mockResolvedValue({
      response: [
        'Sure! Here you go:',
        '```json',
        '{"visible_text": "KARHU III 4.7% vol 0.33 L", "brand": "Karhu", "product": "III", "abv_percent": "4.7", "volume_l": "0.33", "category": "beer", "nickname": "ignored"}',
        '```',
        'Hope that helps!',
      ].join('\n'),
    });
    findCandidatesMock.mockResolvedValue([]);

    const res = await multipartRequest(scanEnv(), jpegForm());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Absent vintage_year → null; unknown model key dropped; numeric
    // strings coerced (comma decimals tolerated too).
    expect(body).toEqual({
      extracted: {
        visible_text: 'KARHU III 4.7% vol 0.33 L',
        brand: 'Karhu',
        product: 'III',
        abv_percent: 4.7,
        volume_l: 0.33,
        category: 'beer',
        vintage_year: null,
      },
      candidates: [],
    });
    expect(findCandidatesMock).toHaveBeenCalledWith({
      tokens: ['karhu', 'iii'],
      abv: 0.047,
      volume: 0.33,
    });
  });

  it('parses an unfenced JSON blob embedded in prose', async () => {
    runMock.mockResolvedValue({
      response:
        'The label says KARHU III. {"visible_text": "KARHU III", "brand": "Karhu", "product": "III", "abv_percent": null, "volume_l": null, "category": "beer", "vintage_year": null} — done.',
    });
    findCandidatesMock.mockResolvedValue([]);

    const res = await multipartRequest(scanEnv(), jpegForm());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { extracted: { brand: string | null } };
    expect(body.extracted.brand).toBe('Karhu');
    expect(findCandidatesMock).toHaveBeenCalledWith({
      tokens: ['karhu', 'iii'],
      abv: null,
      volume: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Typed 502s — model failure and unparseable output, both retryable
// ---------------------------------------------------------------------------

describe('POST /api/v1/products/scan-label — model failure (typed 502)', () => {
  it('answers a retryable 502 envelope when the model call fails (model 500)', async () => {
    runMock.mockRejectedValue(new Error('AI upstream error (500)'));

    const res = await multipartRequest(scanEnv(), jpegForm());

    await expectEnvelope(res, 502, {
      error: 'BadGateway',
      code: 'MODEL_UNAVAILABLE',
      retryable: true,
    });
    // No funnel cost after a model failure.
    expect(findCandidatesMock).not.toHaveBeenCalled();
  });

  it('answers a retryable 502 when the env carries no AI binding', async () => {
    // Local dev and the browser-E2E harness boot without the binding by
    // config (wrangler.jsonc top-level note) — the contract is the same
    // retryable 502 as a model failure, and no funnel work happens.
    const res = await multipartRequest(
      scanEnv({ AI: undefined as unknown as Env['AI'] }),
      jpegForm(),
    );

    await expectEnvelope(res, 502, {
      error: 'BadGateway',
      code: 'MODEL_UNAVAILABLE',
      retryable: true,
    });
    expect(runMock).not.toHaveBeenCalled();
    expect(findCandidatesMock).not.toHaveBeenCalled();
  });

  it('answers a retryable 502 when the output is unparseable prose', async () => {
    runMock.mockResolvedValue({
      response:
        'I can see a bottle in the photo, but I cannot produce structured output today.',
    });

    const res = await multipartRequest(scanEnv(), jpegForm());

    await expectEnvelope(res, 502, {
      error: 'BadGateway',
      code: 'UNPARSEABLE_MODEL_OUTPUT',
      retryable: true,
    });
    expect(findCandidatesMock).not.toHaveBeenCalled();
  });

  it('answers a retryable 502 when braces exist but the JSON is broken', async () => {
    runMock.mockResolvedValue({
      response: '{"brand": "Karhu", "product": ',
    });

    const res = await multipartRequest(scanEnv(), jpegForm());

    await expectEnvelope(res, 502, {
      code: 'UNPARSEABLE_MODEL_OUTPUT',
      retryable: true,
    });
  });

  it('carries no model text or image data in the 502 body (design D7)', async () => {
    const secretProse = 'SECRET-LABEL-TRANSCRIPTION-ŻOŁĄDKOWA';
    runMock.mockResolvedValue({ response: `total noise ${secretProse}` });

    const res = await multipartRequest(scanEnv(), jpegForm());

    const body = await expectEnvelope(res, 502, {});
    expect(JSON.stringify(body)).not.toContain(secretProse);
  });
});

// ---------------------------------------------------------------------------
// Caps rejected BEFORE model invocation
// ---------------------------------------------------------------------------

describe('POST /api/v1/products/scan-label — body validation before the model', () => {
  it('rejects an oversize body (413) and never calls the model', async () => {
    const oversize = new Uint8Array(SCAN_LABEL_MAX_BYTES + 1);
    oversize[0] = 0xff;
    oversize[1] = 0xd8;
    oversize[2] = 0xff;

    const res = await multipartRequest(scanEnv(), jpegForm(oversize));

    await expectEnvelope(res, 413, { error: 'PayloadTooLarge' });
    expect(runMock).not.toHaveBeenCalled();
    expect(findCandidatesMock).not.toHaveBeenCalled();
  });

  it('rejects wrong magic bytes (415) even when the declared content-type is an image', async () => {
    // Declared PNG, actual GIF — magic bytes win over the declaration.
    const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    const res = await rawImageRequest(scanEnv(), gifBytes, 'image/png');

    await expectEnvelope(res, 415, { error: 'UnsupportedMediaType' });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('rejects a non-image file part (415) on the multipart path', async () => {
    const form = new FormData();
    form.append(
      'image',
      new File([new TextEncoder().encode('plain text, not an image')], 'note.txt', {
        type: 'text/plain',
      }),
    );

    const res = await multipartRequest(scanEnv(), form);

    await expectEnvelope(res, 415, { error: 'UnsupportedMediaType' });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('rejects a multipart body without an image part (400)', async () => {
    const form = new FormData();
    form.append('note', 'no image here');

    const res = await multipartRequest(scanEnv(), form);

    await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('accepts every supported magic — PNG via multipart and WebP via raw body', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    const pngForm = new FormData();
    pngForm.append('image', new File([PNG_BYTES], 'label.png', { type: 'image/png' }));
    const pngRes = await multipartRequest(scanEnv(), pngForm);
    expect(pngRes.status).toBe(200);
    const [, pngPayload] = runMock.mock.calls[0] as unknown as [
      string,
      { messages: Array<{ content: Array<{ image_url?: { url: string } }> }> },
    ];
    expect(pngPayload.messages[0]!.content[1]!.image_url!.url.startsWith('data:image/png;')).toBe(
      true,
    );

    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const webpRes = await rawImageRequest(scanEnv(), webp, 'image/webp');
    expect(webpRes.status).toBe(200);
    const [, webpPayload] = runMock.mock.calls[1] as unknown as [
      string,
      { messages: Array<{ content: Array<{ image_url?: { url: string } }> }> },
    ];
    expect(webpPayload.messages[0]!.content[1]!.image_url!.url.startsWith('data:image/webp;')).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Quota (design D5) and age gate
// ---------------------------------------------------------------------------

describe('POST /api/v1/products/scan-label — anonymous per-IP quota', () => {
  it('answers 429 with Retry-After once the scan quota is exhausted', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    const env = scanEnv();
    for (let i = 0; i < SCAN_LABEL_QUOTA.limit; i += 1) {
      const res = await multipartRequest(env, jpegForm());
      expect(res.status).toBe(200);
    }

    const limited = await multipartRequest(env, jpegForm());
    const body = await expectEnvelope(limited, 429, {
      error: 'TooManyRequests',
    });
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(Number(body.retryAfterSeconds)).toBeGreaterThan(0);

    // The rejected scan never reaches the model.
    expect(runMock).toHaveBeenCalledTimes(SCAN_LABEL_QUOTA.limit);
  });

  it('keys the quota per IP — a different client keeps its own budget', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    const env = scanEnv();
    for (let i = 0; i < SCAN_LABEL_QUOTA.limit; i += 1) {
      const res = await multipartRequest(env, jpegForm());
      expect(res.status).toBe(200);
    }

    const otherIp = await multipartRequest(env, jpegForm(), {
      'cf-connecting-ip': '198.51.100.23',
    });
    expect(otherIp.status).toBe(200);
  });

  it('uses a scan-label-specific profile bucket, isolated from other surfaces', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    // The quota constants are route-local and profile-named — the value
    // design D5 puts in route constants, in a bucket no other surface
    // shares (pinned so a future profile rename cannot silently merge
    // scan traffic into another surface's budget).
    expect(SCAN_LABEL_QUOTA.profile).toBe('scan-label');
    expect(SCAN_LABEL_QUOTA.windowMs).toBe(3_600_000);
    expect(SCAN_LABEL_QUOTA.limit).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/products/scan-label — age gate', () => {
  it('answers 403 AGE_GATE_REQUIRED without the confirmation and never invokes the model', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);

    const env = scanEnv();
    const res = await createApp().request('/api/v1/products/scan-label', {
      method: 'POST',
      headers: { 'cf-connecting-ip': IP, 'content-type': 'image/jpeg' },
      body: JPEG_BYTES,
    }, env) as Response;

    await expectEnvelope(res, 403, {
      error: 'Forbidden',
      code: 'AGE_GATE_REQUIRED',
    });
    expect(runMock).not.toHaveBeenCalled();
    expect(findCandidatesMock).not.toHaveBeenCalled();
  });

  it('accepts the age_confirmed cookie as the confirmation carrier', async () => {
    runMock.mockResolvedValue(FENCED_MISTRAL_OUTPUT);
    findCandidatesMock.mockResolvedValue([]);

    const res = await createApp().request('/api/v1/products/scan-label', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': IP,
        'content-type': 'image/jpeg',
        cookie: 'age_confirmed=1',
      },
      body: JPEG_BYTES,
    }, scanEnv()) as Response;

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Design D7 — the privacy claim as a source-level assertion
// ---------------------------------------------------------------------------

describe('design D7 — in-memory processing enforced by construction', () => {
  const ROUTE_SOURCE = readFileSync(
    new URL('../scan-label.routes.ts', import.meta.url),
    'utf8',
  );

  it('imports and touches no storage binding', () => {
    // R2, KV, and DO-storage handles never appear in the route module —
    // the only persistent write on the path is the rate limiter's quota
    // timestamps (spec-mandated, via the shared do/client checkRateLimit),
    // which never see image data.
    for (const forbidden of [
      'R2Bucket',
      'KVNamespace',
      'OBSERVATION_LOG',
      'RATE_SNAPSHOTS',
      'METRICS',
      '.put(',
      'writeFileSync',
      'caches.',
    ]) {
      expect(ROUTE_SOURCE).not.toContain(forbidden);
    }
  });

  it('never logs — nothing about the image or transcription reaches a log sink', () => {
    for (const forbidden of ['console.', 'createLogger', 'waitUntil']) {
      expect(ROUTE_SOURCE).not.toContain(forbidden);
    }
  });
});

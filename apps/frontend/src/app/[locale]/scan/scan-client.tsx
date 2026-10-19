'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiFetch, buildHeaders } from '@/lib/api';
import type { ApiError } from '@/lib/types';
import {
  formatAbv,
  formatAttributeRow,
  formatVolume,
} from '@/lib/format/product-attributes';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
} from '@/components/ui';

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/**
 * The scan-label endpoint (task 2.2's contract, change
 * label-scan-product-lookup). The multipart field is `image`; the age
 * confirmation rides the site-wide `age_confirmed` cookie — a
 * credentialed fetch carries it automatically, and buildHeaders adds the
 * `x-age-confirmed` header twin when the cookie is present.
 */
const SCAN_LABEL_PATH = '/api/v1/products/scan-label';

/**
 * Client-side downscale cap (design D6): the capture is resized so its
 * longest edge is at most ~1024 px before upload — the Workers request
 * stays small and the model round-trip stays fast.
 */
const SCAN_IMAGE_MAX_EDGE = 1024;

/** JPEG quality of the downscaled capture (design D6). */
const SCAN_JPEG_QUALITY = 0.8;

/**
 * Below this the capture is not a photo: a real 1024 px label frame at
 * q0.8 encodes to tens of KB, while an unpainted/black canvas compresses
 * to a few KB (prod 2026-10-19: two identical 2742-byte uploads — the
 * model received a black frame). The gate answers the honest local
 * recovery state instead of spending a model round-trip on garbage.
 */
const SCAN_MIN_BLOB_BYTES = 15_000;

/**
 * How long the capture waits for the video to actually have frame data
 * (and, where supported, one painted-frame callback) before drawing.
 */
const SCAN_FRAME_WAIT_MS = 2_000;

/**
 * The catalog search seeds at most this many characters — the products
 * page caps its ?q= at 100 before the API sees it.
 */
const SCAN_HANDOFF_QUERY_MAX_LENGTH = 100;

/**
 * The confirm step presents at most three candidates (design D4: fuzzy
 * matches can be wrong, so the visitor confirms over a short card list;
 * the funnel still returns up to five).
 */
const SCAN_CANDIDATE_LIMIT = 3;

/** Locales the [locale] segment serves (fi is the default, en prefixed). */
type ScanLocale = 'fi' | 'en';

// ---------------------------------------------------------------------------
// Response shapes — the POST /api/v1/products/scan-label envelope
// ---------------------------------------------------------------------------

/** One funnel candidate — the route's LabelCandidate serialization. */
interface ScanCandidate {
  readonly id: number;
  readonly name: string;
  readonly alcoholByVolume: number | null;
  readonly unitVolume: number;
  readonly category: string;
  readonly lowestPriceCents: number | null;
}

/** The transcribed label fields, exactly the route's extraction contract. */
interface ScanExtraction {
  readonly visible_text: string | null;
  readonly brand: string | null;
  readonly product: string | null;
  readonly abv_percent: number | null;
  readonly volume_l: number | null;
  readonly category: string | null;
  readonly vintage_year: number | null;
}

/** The success envelope: the extraction plus the ranked candidates. */
interface ScanLabelResult {
  readonly extracted: ScanExtraction;
  readonly candidates: readonly ScanCandidate[];
}

/**
 * The view's status machine. The spec's four states are `extracting`,
 * `candidates`, `no-result`, and `denied`; the capture flow needs the
 * `idle`/`preview` rest states in front of them, and the endpoint's
 * typed failures render as `age-gate`, `rate-limited`, and `error`.
 * `capture-failed` is the client-side sanity state: the grab produced
 * no readable frame (unpainted/black capture) — recovery without ever
 * reaching the endpoint.
 */
type ScanStatus =
  | 'idle'
  | 'preview'
  | 'extracting'
  | 'candidates'
  | 'no-result'
  | 'denied'
  | 'age-gate'
  | 'rate-limited'
  | 'capture-failed'
  | 'error';

// ---------------------------------------------------------------------------
// Capture helpers — camera availability and the D6 downscale
// ---------------------------------------------------------------------------

/**
 * Whether this environment can ask for a camera at all: a secure context
 * exposing the media-devices getUserMedia API. Browsers hide the API on
 * plain http (localhost excepted) — treated exactly like a refusal, so
 * the endpoint is never called from a surface that cannot capture.
 */
function cameraAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Draw one video frame to a canvas downscaled so the longest edge is at
 * most {@link SCAN_IMAGE_MAX_EDGE} px, and encode JPEG at
 * {@link SCAN_JPEG_QUALITY} (design D6: the upload travels at
 * ~150–300 kB instead of the sensor's multi-megabyte original). Rejects
 * when no frame is ready or canvas encoding is unavailable — the caller
 * renders the honest error state, never a fabricated capture.
 */
async function frameToJpegBlob(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) {
    throw new Error('No video frame available');
  }
  // A painted frame, not just loaded metadata: readyState ≥ 1 sets
  // videoWidth BEFORE the first frame is rendered, and drawImage then
  // captures a black canvas (the prod black-capture incident). Wait for
  // frame data, and where the browser supports it, one painted-frame
  // callback — bounded, so a stalled stream still degrades to the gate.
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve) => {
      // Re-check inside the promise: the frame may land between the
      // outer check and the listener attachment.
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, SCAN_FRAME_WAIT_MS);
      video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  }
  if (typeof video.requestVideoFrameCallback === 'function') {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, SCAN_FRAME_WAIT_MS);
      video.requestVideoFrameCallback(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  const scale = Math.min(1, SCAN_IMAGE_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Canvas 2D context unavailable');
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', SCAN_JPEG_QUALITY);
  });
  if (blob === null) {
    throw new Error('JPEG encoding failed');
  }
  return blob;
}

/** Locale-appropriate euro formatting — the catalog card's convention. */
function formatEuro(cents: number, locale: ScanLocale): string {
  try {
    return new Intl.NumberFormat(locale === 'fi' ? 'fi-FI' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

/** Quiet link style — the catalog filter-link treatment. */
const CATALOG_LINK_CLASSES =
  'touch-target inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';

/** Primary in-place link style — the seeded-search handoff action. */
const PRIMARY_LINK_CLASSES =
  'touch-target inline-flex items-center rounded-md border border-primary-600 bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The scan surface (task 3.1, change label-scan-product-lookup).
 *
 * Single-shot capture: getUserMedia with the rear camera
 * (`facingMode: 'environment'`), a live preview under a fill-the-frame
 * overlay (design D6's cheap mitigation for the catalog-photo-vs-user-
 * photo gap), one frame grabbed to canvas and downscaled client-side,
 * then one POST to the scan-label endpoint. The photo exists only in
 * local variables and the in-flight request — never in any store,
 * matching the route's enforced-by-construction privacy claim (design
 * D7) that the page's privacy microcopy states verbatim.
 *
 * D4 governs the answer: matches render as tappable cards navigating to
 * the localized product page ONLY on tap — never an auto-redirect. The
 * zero-candidate case hands off to the catalog's URL-state search with
 * the transcribed brand text prefilled as `q`. Camera refusal renders a
 * recovery state that never reaches the endpoint.
 *
 * Transport (the deleteFavorite precedent): apiFetch + manual error
 * translation, because request() hardcodes a JSON Content-Type that
 * would break the multipart boundary.
 */
export default function ScanClient() {
  const t = useTranslations('Scan');
  const rawLocale = useLocale();
  const locale: ScanLocale = rawLocale === 'en' ? 'en' : 'fi';

  const [status, setStatus] = useState<ScanStatus>('idle');
  const [result, setResult] = useState<ScanLabelResult | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    null,
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /** Stop every track and drop the reference — the camera light goes out. */
  const stopCamera = useCallback((): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Camera tracks are a hardware resource: released on unmount (the
  // cleanup-return form), and the capture/cancel paths stop them too.
  useEffect(() => stopCamera, [stopCamera]);

  // The <video> element mounts with the preview state; the stream is
  // attached after that render so srcObject always finds its element.
  useEffect(() => {
    if (status !== 'preview') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video !== null && stream !== null && video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {
        // Autoplay refusal — the frame is still capturable on tap.
      });
    }
  }, [status]);

  const startCamera = useCallback(async (): Promise<void> => {
    if (!cameraAvailable()) {
      setStatus('denied');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          // Sane capture resolution — devices free to default low (a
          // 320 px stream reads no label); 'ideal' never fails the ask.
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setStatus('preview');
    } catch {
      // Permission denied, no device, hardware busy — one recovery
      // state; the scan-label endpoint is never called on this path.
      setStatus('denied');
    }
  }, []);

  const cancelCamera = useCallback((): void => {
    stopCamera();
    setStatus('idle');
  }, [stopCamera]);

  /** Back to the first step — the previous photo is never kept. */
  const restart = useCallback((): void => {
    setResult(null);
    setRetryAfterSeconds(null);
    setStatus('idle');
  }, []);

  const captureAndUpload = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (video === null || status !== 'preview') return;

    // Grab FIRST, tear down after: stopping the tracks before drawImage
    // can blank the element on some browsers.
    let blob: Blob;
    try {
      blob = await frameToJpegBlob(video);
    } catch {
      stopCamera();
      setStatus('capture-failed');
      return;
    }
    stopCamera();

    // The black-capture gate (see SCAN_MIN_BLOB_BYTES): never spend a
    // model round-trip on an unreadable frame — the photo is already
    // gone from memory, retry is a fresh capture.
    if (blob.size < SCAN_MIN_BLOB_BYTES) {
      setStatus('capture-failed');
      return;
    }

    setStatus('extracting');

    const form = new FormData();
    form.append('image', new File([blob], 'label.jpg', { type: 'image/jpeg' }));

    const headers = buildHeaders(SCAN_LABEL_PATH);
    // Multipart: the browser must set the boundary-bearing Content-Type
    // itself, so the JSON default from buildHeaders comes off here.
    delete headers['Content-Type'];

    let res: Response;
    try {
      res = await apiFetch(SCAN_LABEL_PATH, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers,
      });
    } catch {
      // No HTTP response (timeout, network) — retryable with a new capture.
      setStatus('error');
      return;
    }

    if (res.ok) {
      const parsed = (await res.json()) as ScanLabelResult;
      setResult(parsed);
      // D4: matches render for confirmation — navigation only on tap.
      setStatus(parsed.candidates.length > 0 ? 'candidates' : 'no-result');
      return;
    }

    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // Empty or unparseable error envelope — the status decides below.
    }

    if (res.status === 403) {
      // Re-open the site-wide gate in place (the api client's recovery
      // event, change age-gate-recovery — lib/api.ts dispatches the same
      // event on gated 403s) and render the page's own calm state.
      window.dispatchEvent(new CustomEvent('age-gate:required'));
      setStatus('age-gate');
      return;
    }
    if (res.status === 429) {
      const wait = body?.retryAfterSeconds;
      setRetryAfterSeconds(
        typeof wait === 'number' && wait > 0 ? wait : null,
      );
      setStatus('rate-limited');
      return;
    }
    // 502 retryable (model failure / unparseable output), 5xx, anything
    // else — one honest retryable state; the photo is already gone.
    setStatus('error');
  }, [status, stopCamera]);

  // The no-result handoff seeds the catalog search with the transcribed
  // brand text (spec: brand, falling back to the product name and then
  // the raw transcription — the first non-empty of the three).
  const handoffQuery = [
    result?.extracted.brand,
    result?.extracted.product,
    result?.extracted.visible_text,
  ]
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, SCAN_HANDOFF_QUERY_MAX_LENGTH);

  const candidates = result?.candidates.slice(0, SCAN_CANDIDATE_LIMIT) ?? [];

  return (
    <main
      data-testid="scan-root"
      data-status={status}
      className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('heading')}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">{t('intro')}</p>

      {/* ── Rest state: the camera is off until the visitor asks for it
          (spec: no camera output before permission is granted). ── */}
      {status === 'idle' ? (
        <div className="flex justify-center rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <Button
            size="lg"
            onClick={() => void startCamera()}
            data-testid="scan-start"
          >
            {t('startLabel')}
          </Button>
        </div>
      ) : null}

      {/* ── Live preview with the fill-the-frame guidance (design D6).
          playsInline keeps iOS Safari from hijacking fullscreen. ── */}
      {status === 'preview' ? (
        <div data-testid="scan-preview" className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-black shadow-sm">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              data-testid="scan-video"
              className="block aspect-[3/4] w-full object-cover"
            />
            {/* The frame marks the area the model reads — decorative,
                the guidance line below carries the meaning. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-6 rounded-md border-2 border-white/80"
            />
          </div>
          <p className="text-sm font-medium text-gray-700">
            {t('guidanceLabel')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              onClick={() => void captureAndUpload()}
              data-testid="scan-capture"
            >
              {t('captureLabel')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={cancelCamera}
              data-testid="scan-cancel"
            >
              {t('cancelCameraLabel')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Extracting: upload + recognition in flight. ── */}
      {status === 'extracting' ? (
        <div
          data-testid="scan-extracting"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <p role="status" className="mb-4 text-sm font-medium text-gray-700">
            {t('extractingLabel')}
          </p>
          <LoadingSkeleton variant="card" count={1} />
        </div>
      ) : null}

      {/* ── Candidates: at most three cards (D4), each navigating to the
          localized product page only on tap — never an auto-redirect. ── */}
      {status === 'candidates' && result !== null ? (
        <section
          data-testid="scan-candidates"
          aria-labelledby="scan-candidates-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="scan-candidates-heading"
            className="text-lg font-semibold text-gray-900"
          >
            {t('candidatesHeading')}
          </h2>
          <p className="text-sm text-gray-500">{t('candidatesHint')}</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map((candidate) => {
              const attributes = formatAttributeRow(
                formatVolume(candidate.unitVolume),
                formatAbv(candidate.alcoholByVolume),
              );
              return (
                <li key={candidate.id}>
                  <Link
                    href={{
                      pathname: '/products/[id]',
                      params: { id: candidate.id },
                    }}
                    data-testid="scan-candidate"
                    className="flex h-full flex-col gap-1 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50"
                  >
                    <span className="break-words text-base font-semibold leading-snug text-gray-900">
                      {candidate.name}
                    </span>
                    {attributes !== null ? (
                      <span className="text-sm text-gray-700">{attributes}</span>
                    ) : null}
                    <span className="mt-auto pt-2 text-sm">
                      {candidate.lowestPriceCents !== null ? (
                        <span className="font-medium tabular-nums text-gray-900">
                          {t('candidatePrice', {
                            price: formatEuro(candidate.lowestPriceCents, locale),
                          })}
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          {t('candidateNoPrice')}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div>
            <Button variant="secondary" onClick={restart} data-testid="scan-restart">
              {t('retryScanLabel')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── No result: the extracted label matched nothing — the honest
          zero — with the handoff into the catalog's URL-state search. ── */}
      {status === 'no-result' && result !== null ? (
        <EmptyState
          data-testid="scan-no-result"
          title={t('noResultTitle')}
          description={t('noResultBody')}
          action={
            handoffQuery !== undefined ? (
              <Link
                href={{ pathname: '/products', query: { q: handoffQuery } }}
                data-testid="scan-no-result-link"
                className={PRIMARY_LINK_CLASSES}
              >
                {t('noResultSearchLink', { query: handoffQuery })}
              </Link>
            ) : (
              <Link
                href={{ pathname: '/products' }}
                data-testid="scan-no-result-link"
                className={PRIMARY_LINK_CLASSES}
              >
                {t('browseCatalogLabel')}
              </Link>
            )
          }
        >
          <Button variant="secondary" onClick={restart}>
            {t('retryScanLabel')}
          </Button>
        </EmptyState>
      ) : null}

      {/* ── Camera denied or unavailable: recovery without ever calling
          the endpoint — retry the camera, or search by hand. ── */}
      {status === 'denied' ? (
        <EmptyState
          data-testid="scan-denied"
          title={t('deniedTitle')}
          description={t('deniedBody')}
          action={
            <Button
              onClick={() => void startCamera()}
              data-testid="scan-camera-retry"
            >
              {t('retryCameraLabel')}
            </Button>
          }
        >
          <Link href={{ pathname: '/products' }} className={CATALOG_LINK_CLASSES}>
            {t('browseCatalogLabel')}
          </Link>
        </EmptyState>
      ) : null}

      {/* ── Age gate: the endpoint's 403 — the site-wide prompt re-opens
          through the recovery event; this state explains and offers the
          ways back (new capture after confirming, or the catalog). ── */}
      {status === 'age-gate' ? (
        <div
          data-testid="scan-age-gate"
          role="alert"
          className="rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm"
        >
          <h2 className="text-base font-semibold text-gray-900">
            {t('ageGateTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t('ageGateBody')}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => void startCamera()}>
              {t('retryScanLabel')}
            </Button>
            <Link href={{ pathname: '/products' }} className={CATALOG_LINK_CLASSES}>
              {t('browseCatalogLabel')}
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── Quota: the hourly scan quota answered 429, with its
          Retry-After wait surfaced in the copy (the calculator's 429
          treatment). ── */}
      {status === 'rate-limited' ? (
        <ErrorState
          data-testid="scan-rate-limited"
          title={t('rateLimitedTitle')}
          description={t('rateLimitedBody')}
          onRetry={restart}
          retryLabel={t('retryScanLabel')}
        >
          {retryAfterSeconds !== null ? (
            <span className="text-sm text-gray-500">
              {t('rateLimitedWait', { seconds: retryAfterSeconds })}
            </span>
          ) : null}
        </ErrorState>
      ) : null}

      {/* ── Capture failed: the grab produced no readable frame
          (unpainted/black capture, encoding failure) — a local failure,
          the endpoint was never called. Retry means a fresh capture. ── */}
      {status === 'capture-failed' ? (
        <ErrorState
          data-testid="scan-capture-failed"
          title={t('captureFailedTitle')}
          description={t('captureFailedBody')}
          onRetry={restart}
          retryLabel={t('retryScanLabel')}
        />
      ) : null}

      {/* ── Error: the retryable 502 envelope, a transport failure, or
          capture encoding gone wrong — retry means a fresh capture, the
          previous photo was never kept. ── */}
      {status === 'error' ? (
        <ErrorState
          data-testid="scan-error"
          title={t('errorTitle')}
          description={t('errorBody')}
          onRetry={restart}
          retryLabel={t('retryScanLabel')}
        />
      ) : null}

      {/* ── Privacy microcopy (fi/en), identical in text to the footer's
          privacyScan line (design D7's user-facing statement). ── */}
      <p data-testid="scan-privacy" className="mt-8 text-xs text-gray-400">
        {t('privacyNotice')}
      </p>
    </main>
  );
}

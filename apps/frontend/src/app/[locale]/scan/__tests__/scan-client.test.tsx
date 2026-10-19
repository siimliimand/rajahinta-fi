/**
 * ScanClient (the /scan label-recognition surface) component tests (task
 * 3.2, change label-scan-product-lookup).
 *
 * The spec's "Scan page experience" scenarios are the test matrix: three
 * candidates render as tappable cards linking to the localized product
 * page; navigation happens ONLY through those links (no router push on
 * render or on scan completion); the zero-candidate state hands off to
 * the catalog search with the extracted brand as `q`; a 502 retryable
 * envelope renders the honest error state without crashing; a camera
 * rejection — or a missing media-devices API — renders the recovery
 * state without ever reaching the scan-label endpoint. The extracting
 * state (pending fetch), the age-gate 403 with its recovery event, the
 * 429 quota wait, and the in-memory-processing privacy notice are pinned
 * as the component implements them.
 *
 * Everything runs through the component's real seams — `apiFetch` /
 * `buildHeaders` from `@/lib/api` and `navigator.mediaDevices.getUserMedia`
 * — mocked at that module boundary. jsdom ships no 2D context, JPEG
 * encoder, or camera, so the capture path is stubbed at the platform
 * primitives (`getUserMedia`, `HTMLCanvasElement`, video dimensions).
 * next-intl runs for real against the fi catalog (the source of truth);
 * the localized `Link` is reduced to plain anchors with resolved hrefs
 * because the state machine's navigation policy is what is under test,
 * asserted through next/navigation spies.
 *
 * @module ScanClientTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanClient from '../scan-client';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { apiFetch, buildHeaders } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mocks — the seams the component actually uses
// ---------------------------------------------------------------------------

/**
 * next/navigation spies: the component must never navigate imperatively.
 * ScanClient holds no router of its own, so a non-zero call on any of
 * these after render or after a scan completion would mean an
 * auto-redirect slipped in (spec: confirm-before-navigate).
 */
const routerSpies = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerSpies.push,
    replace: routerSpies.replace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/scan',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

/**
 * The transport seam: apiFetch answers the mocked envelope, buildHeaders
 * reproduces the JSON default the component strips off for multipart
 * (asserted through the apiFetch call shape below).
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: vi.fn(),
    buildHeaders: vi.fn(),
  };
});

/**
 * The localized Link reduced to an anchor whose href is resolved from
 * the object form the component uses (`{pathname, params}` for the
 * product deep link, `{pathname, query}` for the search handoff). The
 * real Link adds locale prefixing and tap navigation; href resolution
 * is all the state machine under test needs.
 */
vi.mock('@/i18n/navigation', () => {
  interface LinkHrefObject {
    pathname: string;
    params?: Record<string, string | number>;
    query?: Record<string, string>;
  }
  type LinkHref = string | LinkHrefObject;

  function resolveHref(href: LinkHref): string {
    if (typeof href === 'string') return href;
    const path = href.pathname.replace(
      /\[(\w+)\]/g,
      (_segment: string, key: string) => String(href.params?.[key] ?? ''),
    );
    const entries = Object.entries(href.query ?? {});
    return entries.length === 0
      ? path
      : `${path}?${new URLSearchParams(entries).toString()}`;
  }

  return {
    Link: (props: React.ComponentProps<'a'> & { href: LinkHref }) => {
      const { href, children, ...anchor } = props;
      return React.createElement('a', { ...anchor, href: resolveHref(href) }, children);
    },
  };
});

const mockedApiFetch = vi.mocked(apiFetch);
const mockedBuildHeaders = vi.mocked(buildHeaders);

// ---------------------------------------------------------------------------
// Platform stubs — camera and canvas, the browser primitives jsdom lacks
// ---------------------------------------------------------------------------

/** The camera handle the component stops on capture, cancel, and unmount. */
const getUserMedia = vi.fn();

function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: () => undefined }],
  } as unknown as MediaStream;
}

function stubMediaDevices(available: boolean): void {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: available ? { getUserMedia } : undefined,
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  mockedBuildHeaders.mockReset();
  mockedBuildHeaders.mockReturnValue({ 'Content-Type': 'application/json' });
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(fakeStream());

  // cameraAvailable() gates on a secure context exposing mediaDevices;
  // jsdom's defaults for neither are dependable across versions.
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  stubMediaDevices(true);

  // The preview frame the capture grabs: jsdom reports no intrinsic video
  // size, so a landscape sensor frame is pinned at the prototype.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    value: 2048,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    value: 1536,
  });
  // jsdom's play() is a not-implemented stub returning undefined, which
  // would break the component's `play().catch(...)` attachment.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => Promise.resolve(),
  });

  // The D6 downscale: a minimal 2D context plus a synchronous JPEG
  // encoder — enough for frameToJpegBlob to produce the upload Blob.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: vi.fn() }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value: (callback: BlobCallback) => {
      callback(new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }));
    },
  });

});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * jsdom's Location methods are non-configurable own properties (the
 * LegacyUnforgeable security semantics), so they cannot be spied on — a
 * location-level redirect instead betrays itself by changing the
 * document URL (jsdom answers any navigation with a loud not-implemented
 * error too).
 */
const DOCUMENT_URL_BEFORE = 'http://localhost:3000/';

// ---------------------------------------------------------------------------
// Fixtures — the POST /api/v1/products/scan-label envelope
// ---------------------------------------------------------------------------

interface ScanCandidateFixture {
  id: number;
  name: string;
  alcoholByVolume: number | null;
  unitVolume: number;
  category: string;
  lowestPriceCents: number | null;
}

interface ScanExtractionFixture {
  visible_text: string | null;
  brand: string | null;
  product: string | null;
  abv_percent: number | null;
  volume_l: number | null;
  category: string | null;
  vintage_year: number | null;
}

const EXTRACTION: ScanExtractionFixture = {
  visible_text: 'ŻOŁĄDKOWA DE LUXE 37,5% 0,7 L',
  brand: 'Żołądkowa',
  product: 'Gorzka Żołądkowa',
  abv_percent: 37.5,
  volume_l: 0.7,
  category: 'spirits',
  vintage_year: null,
};

function candidate(
  overrides: Partial<ScanCandidateFixture> = {},
): ScanCandidateFixture {
  return {
    id: 42,
    name: 'Gorzka Żołądkowa 37,5%',
    alcoholByVolume: 0.375,
    unitVolume: 0.7,
    category: 'spirits',
    lowestPriceCents: 2490,
    ...overrides,
  };
}

function scanResult(
  candidates: ScanCandidateFixture[],
  extractionOverrides: Partial<ScanExtractionFixture> = {},
): { extracted: ScanExtractionFixture; candidates: ScanCandidateFixture[] } {
  return {
    extracted: { ...EXTRACTION, ...extractionOverrides },
    candidates,
  };
}

/** Plain Response stand-in — the component reads ok, status, json() only. */
function apiResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

/**
 * Walk the capture flow to the point where the scan-label request is
 * issued: idle → camera permission → live preview → capture tap.
 */
async function startAndCapture(user: UserEvent): Promise<void> {
  await user.click(screen.getByTestId('scan-start'));
  await screen.findByTestId('scan-preview');
  await user.click(screen.getByTestId('scan-capture'));
}

/** The spec's confirm-before-navigate invariant, at any point in the flow. */
function expectNoImperativeNavigation(): void {
  expect(routerSpies.push).not.toHaveBeenCalled();
  expect(routerSpies.replace).not.toHaveBeenCalled();
  expect(window.location.href).toBe(DOCUMENT_URL_BEFORE);
}

const PRIVACY_NOTICE_FI =
  'Etikettivalokuvat käsitellään muistissa eikä niitä koskaan tallenneta.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScanClient candidates state (spec: confirm-before-navigate)', () => {
  it('renders three tappable cards (name, ABV, volume, price) linking to the localized product page and never navigates without a tap', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(
      apiResponse(
        200,
        scanResult([
          candidate({
            id: 42,
            name: 'Gorzka Żołądkowa 37,5%',
            alcoholByVolume: 0.375,
            unitVolume: 0.7,
            lowestPriceCents: 2490,
          }),
          candidate({
            id: 7,
            name: 'Koskenkorva Viina 63%',
            alcoholByVolume: 0.63,
            unitVolume: 0.5,
            lowestPriceCents: 1899,
          }),
          candidate({
            id: 99,
            name: 'Legendaari Viina 40%',
            alcoholByVolume: null,
            unitVolume: 0.5,
            lowestPriceCents: null,
          }),
        ]),
      ),
    );

    renderWithIntl(<ScanClient />);

    // Nothing navigates from a bare render either.
    expectNoImperativeNavigation();

    await startAndCapture(user);
    expect(await screen.findByTestId('scan-candidates')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute(
      'data-status',
      'candidates',
    );

    const cards = screen.getAllByTestId('scan-candidate');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveAttribute('href', '/products/42');
    expect(cards[1]).toHaveAttribute('href', '/products/7');
    expect(cards[2]).toHaveAttribute('href', '/products/99');

    // Card content: name, the volume·ABV attribute row, and the lowest
    // observed price — with the honest no-price line where none exists.
    expect(cards[0]).toHaveTextContent('Gorzka Żołądkowa 37,5%');
    expect(cards[0]).toHaveTextContent('70 cl · 37.5 %');
    expect(cards[0]).toHaveTextContent('Halvin havaittu hinta: 24,90 €');
    expect(cards[1]).toHaveTextContent('50 cl · 63 %');
    expect(cards[1]).toHaveTextContent('Halvin havaittu hinta: 18,99 €');
    expect(cards[2]).toHaveTextContent('50 cl');
    // A null ABV drops its band term's display too: the attribute row
    // stays single-part (the '·' separator only joins ≥2 parts) instead
    // of fabricating a percentage.
    expect(cards[2].textContent).not.toContain('·');
    expect(cards[2]).toHaveTextContent('Ei havaittuja hintoja');

    // The copy itself states the confirm-first contract.
    expect(screen.getByText('Löytyneet vastaavuudet')).toBeInTheDocument();
    expect(
      screen.getByText('Valitse tuote näpyttämällä — mitään ei avata automaattisesti.'),
    ).toBeInTheDocument();

    // Privacy microcopy rides the candidates state verbatim (fi).
    expect(screen.getByTestId('scan-privacy')).toHaveTextContent(
      PRIVACY_NOTICE_FI,
    );

    // Scan completion is the moment an auto-redirect would fire — none.
    expectNoImperativeNavigation();
  });

  it('caps the confirmation list at three when the funnel returns five', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(
      apiResponse(
        200,
        scanResult(
          [1, 2, 3, 4, 5].map((id) => candidate({ id, name: `Vastaavuus ${id}` })),
        ),
      ),
    );

    renderWithIntl(<ScanClient />);
    await startAndCapture(user);

    expect(await screen.findByTestId('scan-candidates')).toBeInTheDocument();
    const cards = screen.getAllByTestId('scan-candidate');
    expect(cards).toHaveLength(3);
    // Funnel order is preserved — the first three, never the tail.
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      '/products/1',
      '/products/2',
      '/products/3',
    ]);
    expect(screen.queryByText('Vastaavuus 4')).not.toBeInTheDocument();
    expectNoImperativeNavigation();
  });

  it('posts the capture as multipart through the shared transport seam', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(apiResponse(200, scanResult([])));

    renderWithIntl(<ScanClient />);
    await startAndCapture(user);
    await screen.findByTestId('scan-no-result');

    expect(mockedBuildHeaders).toHaveBeenCalledWith('/api/v1/products/scan-label');
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockedApiFetch.mock.calls[0];
    expect(path).toBe('/api/v1/products/scan-label');
    expect(init?.method).toBe('POST');
    // The session/age cookies ride along (the age gate precedes model cost).
    expect(init?.credentials).toBe('include');
    // The JSON Content-Type default is stripped so the browser sets the
    // multipart boundary itself.
    expect(init?.headers).toEqual({});
    expect(init?.body).toBeInstanceOf(FormData);
    const image = (init?.body as FormData).get('image');
    expect(image).toBeInstanceOf(File);
    expect((image as File).type).toBe('image/jpeg');
    expect((image as File).name).toBe('label.jpg');
  });
});

describe('ScanClient no-result state (spec: no-result hands off to search)', () => {
  it('links the catalog search with the extracted brand prefilled as q', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(apiResponse(200, scanResult([])));

    renderWithIntl(<ScanClient />);
    await startAndCapture(user);

    expect(await screen.findByTestId('scan-no-result')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute(
      'data-status',
      'no-result',
    );

    const handoff = screen.getByTestId('scan-no-result-link');
    expect(handoff).toHaveTextContent('Hae hakusanalla "Żołądkowa"');
    const href = handoff.getAttribute('href') ?? '';
    expect(
      new URL(href, 'https://rajahinta.fi').searchParams.get('q'),
    ).toBe('Żołądkowa');
    expect(
      new URL(href, 'https://rajahinta.fi').pathname,
    ).toBe('/products');

    // The privacy notice rides the no-result state too.
    expect(screen.getByTestId('scan-privacy')).toHaveTextContent(
      PRIVACY_NOTICE_FI,
    );
    expectNoImperativeNavigation();
  });

  it('falls back through the extraction chain when the brand is absent', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(
      apiResponse(
        200,
        scanResult([], { brand: null, product: 'Vanha Maahinen' }),
      ),
    );

    renderWithIntl(<ScanClient />);
    await startAndCapture(user);

    const handoff = await screen.findByTestId('scan-no-result-link');
    const href = handoff.getAttribute('href') ?? '';
    // The product name outranks the raw transcription in the fallback.
    expect(
      new URL(href, 'https://rajahinta.fi').searchParams.get('q'),
    ).toBe('Vanha Maahinen');
    expect(handoff).toHaveTextContent('Hae hakusanalla "Vanha Maahinen"');
  });
});

describe('ScanClient extracting state', () => {
  it('renders the extracting state while the scan-label request is pending', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockReturnValue(new Promise<Response>(() => undefined));

    renderWithIntl(<ScanClient />);

    await user.click(screen.getByTestId('scan-start'));
    await screen.findByTestId('scan-preview');

    // The camera ask is the rear camera (fill-the-frame capture)…
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
    // …and the preview carries the capture guidance affordance.
    expect(screen.getByTestId('scan-video')).toBeInTheDocument();
    expect(
      screen.getByText('Sovita etiketti kehysseen ja täytä kuva etiketillä.'),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('scan-capture'));

    expect(await screen.findByTestId('scan-extracting')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute(
      'data-status',
      'extracting',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Luetaan etikettiä…');
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    // No outcome state leaks while the request is in flight.
    expect(screen.queryByTestId('scan-candidates')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-no-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument();
    expectNoImperativeNavigation();
  });
});

describe('ScanClient retryable error state (502 envelope)', () => {
  it('renders the retryable error state on a 502 without crashing and recovers via a fresh capture', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(
      apiResponse(502, {
        statusCode: 502,
        message: 'Label recognition is temporarily unavailable. Please try again.',
        error: 'BadGateway',
        code: 'MODEL_UNAVAILABLE',
        retryable: true,
      }),
    );

    renderWithIntl(<ScanClient />);
    await startAndCapture(user);

    expect(await screen.findByTestId('scan-error')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute('data-status', 'error');
    expect(screen.getByText('Tunnistus epäonnistui')).toBeInTheDocument();

    // Retry means a fresh capture, not a silent re-request: the restart
    // returns to the idle state with the previous answer dropped.
    await user.click(screen.getByRole('button', { name: 'Ota uusi kuva' }));
    expect(screen.getByTestId('scan-root')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('scan-start')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-error')).not.toBeInTheDocument();
    expectNoImperativeNavigation();
  });
});

describe('ScanClient camera denied (spec: camera permission denied)', () => {
  it('renders the recovery state on getUserMedia rejection without calling scan-label', async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    renderWithIntl(<ScanClient />);
    await user.click(screen.getByTestId('scan-start'));

    expect(await screen.findByTestId('scan-denied')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute('data-status', 'denied');
    expect(screen.getByText('Kamera ei ole käytettävissä')).toBeInTheDocument();

    // The endpoint is never reached from the denial path.
    expect(mockedApiFetch).not.toHaveBeenCalled();
    expect(mockedBuildHeaders).not.toHaveBeenCalled();

    // Recovery affordances: retry the camera, or search by hand.
    expect(screen.getByTestId('scan-camera-retry')).toHaveTextContent(
      'Yritä kameraa uudelleen',
    );
    expect(
      screen.getByRole('link', { name: 'Selaa tuoteluetteloa' }),
    ).toHaveAttribute('href', '/products');

    // The retry prompt re-asks for the camera and recovers to the preview.
    getUserMedia.mockResolvedValue(fakeStream());
    await user.click(screen.getByTestId('scan-camera-retry'));
    await screen.findByTestId('scan-preview');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('treats a missing media-devices API as denial and never calls the endpoint', async () => {
    const user = userEvent.setup();
    stubMediaDevices(false);

    renderWithIntl(<ScanClient />);
    await user.click(screen.getByTestId('scan-start'));

    expect(await screen.findByTestId('scan-denied')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute('data-status', 'denied');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});

describe('ScanClient age gate (403 AGE_GATE_REQUIRED)', () => {
  it('renders the age-gate state and re-opens the site-wide gate event', async () => {
    const user = userEvent.setup();
    const gateEvents: string[] = [];
    const gateListener = (event: Event): void => {
      gateEvents.push(event.type);
    };
    window.addEventListener('age-gate:required', gateListener);
    mockedApiFetch.mockResolvedValue(
      apiResponse(403, {
        statusCode: 403,
        message: 'Age confirmation required.',
        error: 'Forbidden',
        code: 'AGE_GATE_REQUIRED',
      }),
    );

    try {
      renderWithIntl(<ScanClient />);
      await startAndCapture(user);

      expect(await screen.findByTestId('scan-age-gate')).toBeInTheDocument();
      expect(screen.getByTestId('scan-root')).toHaveAttribute(
        'data-status',
        'age-gate',
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Vahvista ikäsi jatkaaksesi',
      );
      // The recovery event the AgeGate modal listens for fired exactly once.
      expect(gateEvents).toEqual(['age-gate:required']);
      expectNoImperativeNavigation();
    } finally {
      window.removeEventListener('age-gate:required', gateListener);
    }
  });
});

describe('ScanClient quota (429)', () => {
  it('renders the rate-limited state with the Retry-After wait from the envelope', async () => {
    const user = userEvent.setup();
    mockedApiFetch.mockResolvedValue(
      apiResponse(429, {
        statusCode: 429,
        message: 'Scan quota exceeded.',
        error: 'TooManyRequests',
        retryAfterSeconds: 600,
      }),
    );

    renderWithIntl(<ScanClient />);
    await startAndCapture(user);

    expect(await screen.findByTestId('scan-rate-limited')).toBeInTheDocument();
    expect(screen.getByTestId('scan-root')).toHaveAttribute(
      'data-status',
      'rate-limited',
    );
    expect(screen.getByText('Odota hetki')).toBeInTheDocument();
    expect(
      screen.getByText('Raja palautuu noin 600 sekunnin kuluttua.'),
    ).toBeInTheDocument();
    expectNoImperativeNavigation();
  });
});

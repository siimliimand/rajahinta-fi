/**
 * Env-gated Faro bootstrap — a complete no-op without build-time
 * `NEXT_PUBLIC_FARO_URL`, the client twin of the optional-METRICS-binding
 * emitters in apps/api-worker/src/observability/metrics.ts. Session-scoped
 * and identity-free (D1): the collector sees Faro's anonymous session id
 * only. Observability output, never a calculation or ranking input (D2).
 *
 * @module TelemetryInit
 */

import {
  getWebInstrumentations,
  initializeFaro,
  type Faro,
} from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

const FARO_APP_NAME = 'rajahinta-frontend';

export interface FaroEndpoint {
  readonly url: string;
}

/** Pure so the unconfigured → null gate stays unit-testable. */
export function resolveFaroEndpoint(
  raw: string | undefined,
): FaroEndpoint | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : { url: trimmed };
}

let faro: Faro | null = null;

/** True only after a live SDK init — never for a merely configured build. */
export function isTelemetryActive(): boolean {
  return faro !== null;
}

/** The live SDK, or null when telemetry is off; emitters no-op on null. */
export function getFaro(): Faro | null {
  return faro;
}

/**
 * Initialize Faro + web tracing when the endpoint is configured.
 * Idempotent; returns whether telemetry is live afterwards.
 */
export function initFaroTelemetry(): boolean {
  if (faro) return true;
  const endpoint = resolveFaroEndpoint(process.env.NEXT_PUBLIC_FARO_URL);
  if (!endpoint) return false;
  try {
    faro = initializeFaro({
      url: endpoint.url,
      app: {
        name: FARO_APP_NAME,
        environment:
          process.env.NODE_ENV === 'production' ? 'production' : 'development',
      },
      instrumentations: [
        ...getWebInstrumentations(),
        new TracingInstrumentation(),
      ],
    });
    return true;
  } catch {
    // telemetry must never take a page down — degrade to the no-op emitters
    faro = null;
    return false;
  }
}

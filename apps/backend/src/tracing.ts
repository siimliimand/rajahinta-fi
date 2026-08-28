/**
 * OpenTelemetry tracing bootstrap (task 6.3, deployment-observability spec:
 * "Distributed tracing").
 *
 * This module MUST be the first import in `main.ts`. The instrumentations
 * patch module loading and cached module objects when they start; anything
 * required before `startTracing()` runs (bullmq and express are pulled in
 * transitively by AppModule) would escape instrumentation.
 *
 * Configuration is purely environmental — no endpoint or credential is
 * ever hardcoded (Grafana Cloud key travels in the headers env var):
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP gateway base URL, e.g.
 *       https://otlp-gateway-<host>.grafana.net/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS — 'authorization=Basic <base64 instance:token>'
 *   OTEL_SERVICE_NAME          — overrides the default resource name
 *
 * Both OTEL_* export variables are read natively by the OTLP exporter —
 * this file never parses them. When the endpoint is absent the SDK is not
 * started at all: no spans, no export attempts, no background timers.
 *
 * @module tracing
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import pino from 'pino';

const logger = pino({
  name: 'tracing',
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});

let sdk: NodeSDK | null = null;

export function startTracing(): void {
  // Idempotent: the module body self-starts; an explicit second call
  // (tests, host scripts) must not create a second SDK instance.
  if (sdk) return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) {
    logger.info('OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled (clean no-op)');
    return;
  }

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'rajahinta-backend',
    // Reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS / _TIMEOUT from env.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      // HTTP server+client spans for every request the API serves and
      // every outbound call it makes.
      new HttpInstrumentation(),
      // Replaces raw-path span names with low-cardinality route
      // templates ("GET /api/v1/products/:id").
      new ExpressInstrumentation(),
      // NOTE: BullMQ job spans are intentionally absent — there is no
      // official @opentelemetry/instrumentation-bullmq. Job outcomes stay
      // covered by structured worker logs until one exists.
    ],
  });

  sdk.start();
  logger.info('OpenTelemetry tracing started (OTLP/HTTP exporter, env-configured)');
}

/** Flush buffered spans to the collector — call before process exit. */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shut down cleanly');
  } catch (err) {
    logger.error({ err }, 'OpenTelemetry shutdown failed — pending spans may be lost');
  }
}

// Self-start at module evaluation. Import order is what makes this work:
// main.ts imports './tracing' before @nestjs/core and AppModule, so the
// instrumentation hooks are in place before instrumented packages load.
startTracing();

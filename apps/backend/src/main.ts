// Tracing must be imported FIRST — the OTel instrumentations patch module
// loading at evaluation time; AppModule pulls in bullmq/express further
// down this list. See ./tracing.ts.
import { shutdownTracing } from './tracing';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Structured logging — pino JSON to stdout
// ---------------------------------------------------------------------------

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // ISO timestamps keep log lines correlated with the readiness body and
  // the ops dashboard, which both report ISO strings.
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    // The request log line is built from safe fields only (method, path
    // without query, route pattern, status, duration) — these paths guard
    // against future widening of the logged object.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-auth-token"]',
      'req.headers["x-user-id"]',
      'req.query.token',
      'req.query.accessToken',
    ],
    censor: '[REDACTED]',
  },
});

/** Accept a client-supplied request ID only when it is a plain UUID. */
function sanitizeRequestId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function attachRequestLogging(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const typedReq = req as typeof req & {
      requestId?: string;
      route?: { path?: string };
    };
    const requestId = sanitizeRequestId(req.headers['x-request-id']) ?? randomUUID();
    typedReq.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      // Route pattern (low cardinality) when matched, pathname otherwise;
      // the query string is deliberately dropped — it can carry tokens.
      const route = typedReq.route?.path ?? req.path;
      logger.info(
        {
          req: { id: requestId, method: req.method, url: req.path, route },
          res: { statusCode: res.statusCode },
          durationMs: Math.round(durationMs * 100) / 100,
        },
        'request completed',
      );
    });
    next();
  });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  attachRequestLogging(app);

  // Swagger is a non-production surface: mounted outside production, or in
  // production only when explicitly enabled via env flag.
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Rajahinta.fi API')
      .setDescription('Finnish cross-border beverage landed-cost intelligence API')
      .setVersion('0.1.0')
      .addTag('calculations', 'Landed-cost calculation endpoints')
      .addTag('products', 'Product and price data endpoints')
      .addTag('health', 'Service health checks')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    // The session cookie is httpOnly and travels only on credentialed
    // requests (`credentials: 'include'` in apps/frontend/src/lib/api.ts).
    // Without Allow-Credentials the browser drops the cookie on every
    // cross-origin API call — an explicit origin (never "*") is required
    // for this flag, which the env-driven origin above already provides.
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.info(`Rajahinta backend listening on http://localhost:${port}`);
  installShutdownHandlers(app);
}

/**
 * Best-effort graceful shutdown: close the HTTP listeners (which also runs
 * Nest lifecycle hooks — the internal metrics endpoint among them), then
 * flush the OTel batch span processor before exiting. Signal handlers
 * replace the default immediate-exit behaviour, so exit(0) is explicit.
 */
function installShutdownHandlers(app: INestApplication): void {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down`);
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, 'app.close() during shutdown failed');
    }
    await shutdownTracing();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap();

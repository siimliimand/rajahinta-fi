/**
 * CORS shim for the browser E2E stack — REPORTED-DEFECT WORKAROUND.
 *
 * Defect: apps/backend/src/main.ts calls enableCors({ origin, methods })
 * WITHOUT `credentials: true`. The frontend API client sends every request
 * with `credentials: 'include'` (apps/frontend/src/lib/api.ts documents that
 * a cross-domain API origin MUST answer with credentials support), so the
 * browser rejects the CORS preflight and drops every API call — search,
 * calculator, compare and account journeys all fail against the dev-stack
 * topology (frontend :3001 → API :3000).
 *
 * This shim sits on its own port in front of the backend and adds exactly
 * the one response header NestJS would emit with `credentials: true`:
 * `Access-Control-Allow-Credentials: true`. Everything else — the real
 * CORS preflight, the explicit-origin check, cookie flow, session
 * issuance — is exercised for real against the real backend.
 *
 * REMOVE THIS SHIM once the backend fix lands; boot-stack.sh then points
 * the frontend straight at the backend (see E2E_DIRECT=1).
 *
 * Usage: node cors-shim.mjs  (PORT=3002 TARGET=http://localhost:3000)
 */

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3002);
const TARGET = process.env.TARGET ?? 'http://localhost:3000';
const target = new URL(TARGET);

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: target.host },
    },
    (up) => {
      const headers = { ...up.headers };
      // The single header the defective enableCors() omits.
      headers['access-control-allow-credentials'] = 'true';
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'CorsShimUpstreamError',
        message: err.message,
      }),
    );
  });

  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[cors-shim] listening on :${PORT} → ${TARGET} ` +
      '(+ access-control-allow-credentials)',
  );
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

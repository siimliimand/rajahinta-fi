# OTLP trace export → Grafana Cloud (task 6.2, design D8)

Workers tracing replaces the NestJS/OTel SDK bootstrap
(`InstrumentationService`): instrumentation is automatic (fetch calls,
binding operations — D1/R2/DO/Queues — and every fetch/scheduled/queue
handler), zero SDK code in the Worker. Grafana Cloud stays the APM
destination ("no vendor change for APM" — design D8): traces land in
Grafana Tempo, export logs would land in Loki.

## What is configured (wrangler.jsonc)

```jsonc
"observability": {
  "enabled": true,            // Workers Logs (design D8 log story)
  "traces": {
    "enabled": true,          // turn tracing on
    "head_sampling_rate": 0.05, // head-sample 5% (high-volume API; counts live in METRICS, not traces)
    "persist": false,         // export ONLY — skip Cloudflare dashboard trace storage
    "destinations": ["rajahinta-grafana-traces"] // dashboard-destination NAME (below)
  }
}
```

These are the current Cloudflare keys
(`developers.cloudflare.com/workers/observability/traces/` and
`/exporting-opentelemetry-data/`): the OTLP endpoint and credentials are
NOT wrangler config — they live in an account-level **destination**
created in the dashboard, and `destinations` references it by name.

## One-time setup per Cloudflare account

1. **Grafana side** — Cloud portal → Connections → "OpenTelemetry (OTLP)"
   → Quickstart → JavaScript → create a token (e.g.
   `cloudflare-workers-otel`). From the "Environment variables" block,
   save (do NOT commit):
   - `OTEL_EXPORTER_OTLP_ENDPOINT` — e.g.
     `https://otlp-gateway-prod-eu-west.grafana.net/otlp`
     (traces URL = endpoint + `/v1/traces`)
   - `OTEL_EXPORTER_OTLP_HEADERS` — the auth header, shape
     `Authorization=Basic MTMx…` (instance-id:token, base64'd by Grafana)
2. **Cloudflare side** — dashboard → Workers & Pages → Observability →
   pipelines ("Add destination"):
   - Name: `rajahinta-grafana-traces` — must match
     `observability.traces.destinations` in wrangler.jsonc
   - Type: `Traces`
   - OTLP endpoint: the Grafana traces URL from step 1
   - Custom header: `Authorization` = `Basic MTMx…` from step 1
3. Redeploy the Worker. First data can take a few minutes; the
   destination row in the dashboard shows delivery status/health.

EU note (design D9): pick the Grafana region and the EU placement hints
deliberately — the OTLP gateway region is part of the residency review.

## Credential handling (no secrets in this repo)

The values above are placeholders only. They are entered once into the
dashboard destination and Grafana's token store — never into git, never
into `wrangler.jsonc` (which is committed).

Today's exporter is platform-side (Workers runtime → destination), so no
Worker runtime secret is read. If a future code path ever needs the
Grafana OTLP endpoint/credentials directly (e.g. a custom-span exporter),
configure them as per-environment secrets, never plaintext vars:

```bash
wrangler secret put GRAFANA_OTLP_ENDPOINT --env staging
wrangler secret put GRAFANA_OTLP_AUTH_HEADER --env staging   # "Basic MTMx…" value
wrangler secret put GRAFANA_OTLP_ENDPOINT --env production
wrangler secret put GRAFANA_OTLP_AUTH_HEADER --env production
```

and read them off `env` (add to `src/env.ts` at that point — do not add
unused bindings "for later").

## Billing/limits note

Tracing is billed per span from 2026-10-01 (Workers Paid: 20M
events/month included) — the reason for `head_sampling_rate: 0.05` +
`persist: false`. Raise sampling temporarily when diagnosing (staging can
run at `1`); keep production at the low default.

## Frontend → API trace propagation (note for task 5.2 — not implemented here)

Workers tracing continues a distributed trace from an inbound
`traceparent` (W3C Trace Context) header automatically, and the browser
fetch client (`apps/web`, task 5.2) should propagate the current trace so
a UI-span → API-span waterfall is possible in Tempo:

- The fetch client must send `traceparent` (and `tracestate` when
  present) headers on API calls — same-origin `/api/*` requests only;
  create a root span per user action client-side if a RUM SDK is present,
  otherwise a standalone `traceparent` (version `00`, all-zero parent
  span id is invalid — use a generated span id) is enough for the API to
  join.
- Do not log full traceparent values client-side (they are not secret but
  noise); do not add CORS allowances for them — requests are same-origin.
- Backend work needed for 5.2 is ZERO in the Worker (automatic
  continuation); only the frontend client changes.

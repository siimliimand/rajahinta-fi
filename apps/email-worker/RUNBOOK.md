# Email Worker runbook

Operational runbook for `apps/email-worker` — the only sender in the system
(migrate-to-cloudflare task 5.3, design D7, spec `cloudflare-email-service`).
All outbound email goes through the Cloudflare Email Service `send_email`
binding; SPF/DKIM are managed by Cloudflare. No SMTP provider, no provider
API keys.

## 1. Enable Cloudflare Email Service for the domain

1. Cloudflare dashboard → select the `rajahinta.fi` zone → **Email** →
   **Email Service**.
2. Enable the service for the zone. Cloudflare publishes the DNS records it
   needs on the zone:
   - **SPF** — a TXT record adding Cloudflare's Email Service include to the
     domain's SPF policy.
   - **DKIM** — the Cloudflare DKIM selector TXT records used to sign
     outbound mail.
3. Confirm the records exist under **DNS → Records**. They are added
   automatically because the zone runs on Cloudflare DNS. Do not remove or
   edit them — removal breaks deliverability for every environment at once.
4. Verify the sending identity under **Email → Email Service → Settings**:
   verify a single sender address, or verify the whole `rajahinta.fi` domain
   (domain-level verification is preferred so each environment can use its
   own `EMAIL_FROM` address on the same domain). Cloudflare signs and aligns
   SPF/DKIM; there is no signing key to manage or rotate here.

## 2. Create the `send_email` binding

The binding is declared in `apps/email-worker/wrangler.jsonc` under the
`send_email` key, bound as `EMAIL`. The verified sending address/domain and
the pinned destination address are chosen at binding creation:

- `destination_address` pins every message the binding sends to one verified
  operator inbox. This is the current mode — the first consumer is the ops
  freshness alert (task 6.3), which targets a fixed operator address.
- Alternative for multiple permitted recipients:
  `allowed_destination_addresses` (a list). Switch modes only with a spec
  update — the contract currently assumes the pinned destination.

Steps:

1. Replace the placeholder `destination_address` values in `wrangler.jsonc`
   (top level and each of `env.dev` / `env.staging` / `env.production`) with
   the verified destination address chosen in step 1.
2. Keep `EMAIL_FROM` (a plain `vars` entry, per environment) on the verified
   domain. The Worker validates it at request time and refuses to send from
   an address that does not parse as a valid sender.
3. Deploy — `wrangler deploy --env <env>` creates the binding on first
   deploy. Verify in **Workers & Pages → rajahinta-email-\<env\> → Settings →
   Bindings** that a **Send Email** binding named `EMAIL` exists.

## 3. Set the shared secret per environment

The send contract is authenticated by a shared secret carried in the
`X-Email-Send-Secret` request header, compared constant-time. The secret is
a Worker Secret — never a committed var, never defaulted in code.

```bash
# generate one secret per environment (never reuse, never commit)
openssl rand -hex 32

# set it for each environment (reads the value from the terminal, not argv)
wrangler secret put EMAIL_SEND_SECRET --env dev
wrangler secret put EMAIL_SEND_SECRET --env staging
wrangler secret put EMAIL_SEND_SECRET --env production
```

Callers (the API Worker's cron alert handler) read the same value from their
own per-environment secret store. Rotate by re-running `wrangler secret put`
in both workers within one deploy window.

## 4. Deploy and smoke-test with curl

Local dev (no real sending without a deployed binding):

```bash
pnpm --filter @rajahinta/email-worker dev
```

Smoke test (placeholders shown as environment references — do not paste real
secrets into shells, docs, or issue comments):

```bash
curl -i -X POST http://localhost:8787/internal/email/send \
  -H 'Content-Type: application/json' \
  -H "X-Email-Send-Secret: $EMAIL_SEND_SECRET" \
  -d '{
    "to": "ops@example.com",
    "subject": "rajahinta email worker smoke test",
    "text": "If you can read this, the send_email binding works.",
    "replyTo": "ops@example.com"
  }'
```

Expected: `HTTP/1.1 202 Accepted` with
`{"accepted":true,"messageId":"<uuid@rajahinta.fi>","to":"ops@example.com","status":"sent"}`.

Diagnosis by status code (body is always the unified envelope
`{statusCode, message, error, timestamp, path}`):

| Status | Meaning |
|---|---|
| 401 | `X-Email-Send-Secret` missing or wrong — check the secret in the target environment |
| 400/413/422 | Request rejected by validation — `message` names the field |
| 502 | Binding rejected the dispatch — check Workers Logs |
| 503 | Worker misconfiguration (`EMAIL` binding or `EMAIL_FROM`) — deploy config is wrong |

For a deployed environment, point curl at the worker's
`https://rajahinta-email-<env>.<account-subdomain>.workers.dev` URL. The
production caller is the API Worker's freshness Cron (task 6.3); direct curl
is for verification only.

## 5. Verify SPF/DKIM end to end

1. Send a message to a deliverability-tester inbox (e.g. a mail-tester
   service) or a mailbox where you can inspect raw headers.
2. Check `Authentication-Results` on the received message:
   - `spf=pass` with the Cloudflare Email Service include,
   - `dkim=pass` with `d=` aligned to `rajahinta.fi`,
   - no `softfail`/`fail` from the receiving side.
3. If authentication fails: re-check the DNS records from step 1, confirm the
   binding's sender (`EMAIL_FROM`) is on the verified domain, and allow a few
   minutes for DNS propagation after first enabling the service.

## 6. Operational notes

- Caps enforced at the contract: subject ≤ 255 characters, `text`/`html`
  ≤ 256 KiB each (UTF-8 bytes), at least one of `text`/`html` required.
- Recipient addresses are validated syntactically only (conservative rules
  mirrored from `packages/application-api/src/accounts/email-verification.ts`).
- Keep `EMAIL_SEND_SECRET` out of `wrangler.jsonc`, `vars`, logs, and docs.
  It exists only as a Worker Secret per environment.

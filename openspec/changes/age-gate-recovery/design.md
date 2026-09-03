# Design: Age Gate Recovery

## Context

The Phase 1 age gate records self-attestation in two client stores, added at different times for different consumers:

| Store | Key | Lifetime | Consumer |
|---|---|---|---|
| `localStorage.age_confirmed` | `'true'` | never expires | `AgeGate.tsx` — decides whether the modal renders |
| cookie `age_confirmed` | `'true'` | 24h (`max-age=86400`) | `api.ts buildHeaders()` — sent as `x-age-confirmed` to the API |

The failure timeline:

```
Day 0: user confirms            localStorage=true   cookie=true(24h)   OK
Day 1+: cookie expires          localStorage=true   cookie=(gone)      DESYNC
  ├─ AgeGate reads localStorage → "verified" → no modal, ever
  └─ API client finds no cookie → no x-age-confirmed header
       → backend 403 "Age confirmation required…"
       → calculator renders the raw backend message in ErrorState
       → no button, no modal, no way out
```

Nothing re-syncs the stores on mount, so every confirmed user reaches this state exactly 24 hours after confirming. The same 403 dead end affects every client-side gated surface (calculator, ranking, product details, history) — the guard has 16 call sites.

## Goals / Non-Goals

**Goals**
- Make the confirmation state desync impossible by construction.
- Give users an in-place recovery path when the backend rejects a gated call.
- Replace the raw backend error string with localized, actionable copy.
- Self-heal users who are stuck today, with no migration step.

**Non-Goals**
- Auto-retrying the request that failed (user retries manually; replay plumbing is disproportionate).
- Changing backend enforcement, guard coverage, or the verification-provider design.
- Stronger verification (DOB, identity documents) — the pluggable-provider interface already reserves that path.

## Decisions

### D1 — Cookie is the single source of truth (option A) + 403 recovery trigger (option C)

Alternatives considered in exploration (2026-09-03):

| Option | Approach | Verdict |
|---|---|---|
| A + C **(chosen)** | Cookie is the only gate input; 403 code opens the modal in place | Desync impossible; all dead ends recoverable; stuck users self-heal |
| B + C | Keep localStorage primary, raise cookie TTL, silently re-sync on mount | Works, but keeps two stores and quietly re-attests without asking |
| B only | TTL band-aid | Smallest diff, leaves the desync class intact |

With cookie-as-truth, expiry and re-prompting are the same mechanism: when the cookie is gone the modal renders again. Deny semantics are preserved (clear cookie → declined page → prompt on return).

### D2 — Machine-readable rejection code, not message matching

The 403 body gains `code: "AGE_GATE_REQUIRED"` (missing/invalid token) and `"AGE_VERIFICATION_FAILED"` (provider rejection) alongside the existing human message. Added to both implementations to keep Nest-parity:

- `apps/api-worker/src/middleware/age-gate.ts` — `ApiHttpError` already passes object payloads through the error envelope unchanged.
- `packages/application-api/src/age-gate/age-gate.guard.ts` — `ForbiddenException` accepts an object body the same way.

The frontend matches on the code in the shared request path (`executeRequest`), never on the message string.

### D3 — Confirmation TTL: 90 days, one named constant

`AGE_CONFIRMATION_TTL_DAYS = 90` in `AgeGate.tsx`, written into the cookie `max-age`. This replaces the implicit 24h. Re-prompt cadence is a product/legal knob, not a technical one — changing it is a one-line edit. Risk note: Safari ITP caps script-set cookies at ~7 days, so Safari users may re-prompt weekly. That is acceptable for Phase 1 self-attestation (a nuisance, not a dead end); a server-set cookie is the future upgrade if it matters.

## Migration / Compatibility

- No server state, no schema, no API-contract break: the 403 body only gains a field; existing message and status are unchanged.
- Existing stuck users: localStorage says verified, cookie absent → with cookie-as-truth the modal reappears on their next visit. The mount-time cleanup removes the stale localStorage key.
- Existing tests that seed localStorage to bypass the gate are updated to seed the cookie.

## Risks / Trade-offs

- Users re-see the prompt after TTL expiry — intended behavior, previously "never".
- Safari weekly re-prompt (above) — accepted for Phase 1.
- The window-event coupling (`age-gate:required`) must keep a single dispatcher (the shared request path) and a single listener (`AgeGate`); both are covered by tests.

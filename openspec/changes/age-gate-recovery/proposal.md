# Age Gate Recovery

## Why

The age gate has two client-side stores with mismatched lifetimes: the gate UI reads `localStorage.age_confirmed` (never expires), while the API client sends the `age_confirmed` cookie (24-hour `max-age`). After 24 hours the two disagree: the confirmation modal never reappears (localStorage still says verified), yet every gated API call is rejected with 403 because the cookie is gone. The UI then displays the backend's raw instruction — "Age confirmation required. Please confirm your age via the age-gate prompt." — with no prompt reachable and no recovery path.

Every user who confirms once is guaranteed to hit this dead end a day later. A dead-ended visitor has no option but to leave; only a developer can clear site data. Observed on staging 2026-09-03 via the calculator search flow (`/en/calculator`).

## What Changes

- **Cookie becomes the single client source of truth**: `AgeGate` derives its verified state solely from the `age_confirmed` cookie with a bounded lifetime (default 90 days) instead of localStorage. When the cookie expires, the prompt reappears naturally — the desync class becomes impossible by construction, and currently-stuck users self-heal on their next visit. The stale localStorage key is cleaned up on mount.
- **Gate rejection becomes recoverable**: the age-gate 403 payload gains a stable machine-readable `code: "AGE_GATE_REQUIRED"` (added to both the Worker Hono middleware and the NestJS reference guard). The frontend API client detects that code centrally in the shared request path and raises an `age-gate:required` window event; `AgeGate` listens and opens the prompt in place. After confirming, the user retries and succeeds — no page reload, no dead end.
- **Localized recovery copy**: the calculator's error surface maps the age-gate rejection to a localized title/description (en/fi) instead of showing the raw backend string.

## Decisions

- **D1 — Cookie as single source of truth (A) + 403 recovery trigger (C)**, chosen over the lifetime-matching band-aid (option B: raise cookie TTL and silently re-sync from localStorage) during exploration 2026-09-03. A prevents the desync class; C catches every residual path to the dead end (blocked cookies, partial storage clearing, future bugs).
- **D2 — Machine-readable error code** rather than matching the human message string, which is brittle against copy changes and localization.
- **D3 — Cookie TTL 90 days** (product knob, single named constant), replacing the implicit 24h. Self-attestation semantics are unchanged; only the re-prompt cadence moves.

# Load test baseline — capture attempts (task 1.5)

## Attempt 1 — 2026-10-11 (blocked: pre-existing yamllint violations)

- **Date:** 2026-10-11
- **Run id:** [38154891120](https://github.com/siimliimand/rajahinta-fi/actions/runs/38154891120) (`workflow_dispatch` of load-tests.yml)
- **Deployed staging head:** 93e9f85 (from task 1.4); the run checked out `master` @ eec3fd9 — the workflow file is identical, and `STAGING_API_URL` is a repo-level variable, so the target is unaffected.
- **Run conclusion:** `failure` — **the live Artillery phase never executed.** The job "Artillery HTTP suite (Workers staging)" failed in its first step, *Validate artillery suites*, before any HTTP request was sent. No p95, error-rate, 429-count, or RPS numbers exist for the staging HTTP baseline yet.

## Why the live phase is blocked

`run.sh --validate` runs `yamllint` on the three suite YAMLs when it is installed on the runner. This runner image ships yamllint; all prior runs of this workflow were PR events where this job was skipped entirely, so these pre-existing style violations never surfaced in CI. The files are identical on `master` and `feature/ops-wiring-day`. Violations (style only — the YAML parses fine):

- `tests/load/artillery/basket-optimizer-suite.yml`: 56:81 line-length (146 > 80)
- `tests/load/artillery/calculator-suite.yml`: 43:81 line-length (146 > 80), 107:30 missing newline at EOF
- `tests/load/artillery/steady-429-check.yml`: 86:30 missing newline at EOF
- (warnings: missing `---` document start in all three)

Minimal fix for a follow-up: wrap the two long lines, add trailing newlines (optionally the `---` headers). No thresholds, no workflow changes, no behavior change.

## Workflow's own assertions (as configured) — status

| Assertion | Status |
|---|---|
| p95 < 2 s (steady window) | **not evaluated** — suite blocked at validation |
| error rate < 1 % | **not evaluated** — suite blocked at validation |
| zero 429s in steady window | **not evaluated** — suite blocked at validation |

## Measured numbers (in-process vitest job — passed)

The companion job "Load test (calculator, in-process)" succeeded. These are in-process numbers against local service instances, not against staging Workers — interim reference only, not the HTTP baseline:

| Scenario | p95 | p99 | Error rate | Threshold |
|---|---|---|---|---|
| AllowanceFill, 50 concurrent 4-line fills | 15.44 ms | 15.94 ms | 0.00 % | p95 < 2000 ms |
| AllowanceFill, 5 concurrent 10-line fills (max-cap) | 3.25 ms | 3.25 ms | 0.00 % | p95 < 5000 ms |
| LandedCostCalculator, 50 concurrent | 2.50 ms | 2.53 ms | 0.00 % | p95 < 2000 ms |
| BasketOptimizer, 50 concurrent 4-item baskets | 100.37 ms | 100.42 ms | 0.00 % | p95 < 2000 ms |
| BasketOptimizer, 5 concurrent 10-item baskets (max-cap) | 2507.02 ms | 2507.02 ms | 0.00 % | p95 < 20000 ms |
| BasketOptimizer, 10 concurrent 30-item baskets (cap-30) | 5.97 ms | 5.97 ms | 0.00 % | p95 < 2000 ms |

## Decision D — promote to blocking? (as of attempt 1)

**Left open for the operator.** The promote decision was scoped to happen after a staging HTTP baseline exists; the numbers above are in-process only and do not satisfy that precondition. Recommendation: fix the three yamllint violations in a small follow-up, re-dispatch load-tests.yml, and take Decision D against the resulting live p95 / error-rate / 429 numbers recorded here.

## Attempt 2 — 2026-10-11 (blocked again: yamllint — fix commit incomplete)

- **Date:** 2026-10-11
- **Run id:** [38155541442](https://github.com/siimliimand/rajahinta-fi/actions/runs/38155541442) (`workflow_dispatch` of load-tests.yml, `--ref feature/ops-wiring-day`)
- **Deployed staging head / checked-out head:** bd502a3 (`fix(load): yamllint style in artillery suites`). Note: bd502a3 existed only locally before this attempt; it was pushed to `origin/feature/ops-wiring-day` (93e9f85 → bd502a3) so the dispatch could run it. Attempt 1 ran `master` @ eec3fd9, which also carries the violations, so the ref change is what makes the fix visible to the runner; `STAGING_API_URL` is a repo-level variable, so the test target is unaffected.
- **Run conclusion:** `failure` — **the live Artillery phase still never executed.** Same job, same step as attempt 1 ("Artillery HTTP suite (Workers staging)" → *Validate artillery suites*), before any HTTP request was sent. No p95, error-rate, 429-count, or RPS numbers exist for the staging HTTP baseline yet. The companion in-process vitest job passed again (interim reference only, see Attempt 1 table).

### Decisive errors (`gh run view --log-failed`, yamllint exit 1 under `run.sh --validate`)

bd502a3 resolved attempt 1's error-level violations (missing newline at EOF ×2), and `---`/line-length remain warning-level, but the wrap of the two long expression lines introduced two new **error-level** violations and left both wrapped lines at 95 chars:

- `tests/load/artillery/basket-optimizer-suite.yml`
  - `57:61 [trailing-spaces]` — the expression wrap leaves a trailing space after the `+` at the line break
  - `58:81 [line-length] line too long (95 > 80 characters)`
- `tests/load/artillery/calculator-suite.yml`
  - `44:61 [trailing-spaces]` — same pattern: trailing space after the wrapped `+`
  - `45:81 [line-length] line too long (95 > 80 characters)`

Both files: the `- expression: "http.response_status.{code:4xx}.count +` / continuation line pair (the < 1 % non-2xx condition). The repo ships no `.yamllint*` config, so the runner uses yamllint defaults (`trailing-spaces` and `new-line-at-end-of-file` are error-level; `line-length` and `document-start` are warnings — the exit 1 comes from the trailing-spaces errors).

### Minimal completion of the fix (follow-up)

In each file, remove the trailing space at the wrap point and re-break so both halves are ≤ 80 chars (e.g. break the continuation at a different token, or fold the condition differently); alternatively add a `.yamllint` config relaxing `line-length` for `tests/load/artillery/**`. Then re-dispatch `load-tests.yml --ref feature/ops-wiring-day`. No thresholds, no workflow changes, no behavior change.

## Workflow's own assertions (as configured) — status (both attempts)

| Assertion | Status |
|---|---|
| p95 < 2 s (steady window) | **not evaluated** — both runs blocked at suite validation |
| error rate < 1 % | **not evaluated** — both runs blocked at suite validation |
| zero 429s in steady window | **not evaluated** — both runs blocked at suite validation |

## Decision D — promote to blocking? (after attempt 2)

**Still open for the operator, unchanged.** No staging HTTP baseline exists yet; Decision D remains gated on a successful live run. One more small YAML-only fix commit is required before a third dispatch can produce the numbers.

## Attempt 3 — 2026-10-11 (yamllint cleared; live phase ran; blocked at runtime by filtrex parse crash)

- **Date:** 2026-10-11
- **Run id:** [38156062442](https://github.com/siimliimand/rajahinta-fi/actions/runs/38156062442) (`workflow_dispatch` of load-tests.yml, `--ref feature/ops-wiring-day`)
- **Checked-out head:** f5409c4 (`fix(load): no trailing spaces, folds within 80 cols (ops-wiring-day round 3)`). Dispatched with `--ref feature/ops-wiring-day` deliberately: `origin/master` last touched the suites at b19f884 and does not carry the fix, so a default-branch dispatch would have failed yamllint a third time regardless.
- **Run conclusion:** `failure` — **but the failure mode changed.** *Validate artillery suites* **passed** (f5409c4 resolved the remaining `trailing-spaces` errors; no lines > 80, EOFs fine), and the live Artillery phase executed against Workers staging for the first time across the three attempts. The job then died at runtime in the ensure plugin after Phase 1's summary. Phase 2 (`steady-429-check.yml`) never started. The companion in-process vitest job passed again (reference numbers as in Attempt 1).

### Decisive error (from `gh run view --log-failed`)

Artillery 2.0.34 `artillery-plugin-ensure` → `filtrex@2.2.3` cannot lex the metric-reference syntax used in calculator-suite.yml's custom condition:

```
Error: Lexical error on line 1. Unrecognized text.
...ttp.response_status.{code:4xx}.count + h
-----------------------^
    at Parser.parseError (.../filtrex/dist/cjs/filtrex.js:1229:19)
    at EnsurePlugin.runChecks (.../artillery-plugin-ensure/dist/plugin.js:114:31)
##[error]Process completed with exit code 1.
```

The `{code:4xx}` brace syntax is not filtrex grammar. Checks printed before the crash: `ok: max < 10000`, `ok: p95 < 2000`, then `fail:` on the unparseable non-2xx condition (it reports fail-by-crash, never evaluates). Minimal follow-up: rewrite the ensure conditions against filtrex-parseable metric names (e.g. `http.codes.4xx.count`-style dotted metrics, per filtrex identifier rules) in both calculator-suite.yml and basket-optimizer-suite.yml, and the analogous `http.response_status.{code:429}.count == 0` in steady-429-check.yml. Config-only; no thresholds or workflow changes.

### Measured numbers (calculator-suite.yml, live Workers staging, ramp 1→50 over 60 s + steady 50 for 120 s)

| Metric | Value |
|---|---|
| p95, all responses | **37 ms** (ensure `ok: p95 < 2000`) |
| p95, 2xx only | **658.6 ms** (p99 1720.2 ms, mean 456.7 ms, max 2183 ms) |
| Error rate (non-2xx) | **not evaluated** — expression crashed; raw share 9575 / 9755 = **98.2 %** (all 429) |
| HTTP 429 total | **9575** (ramp+steady combined; steady window not isolated) |
| RPS (`http.request_rate`) | **≈ 53/sec** aggregate (peaked ≈ 66/sec in steady ramp-out) |
| http.codes.200 | 180; `http.responses` 9755; `vusers.failed` 0; vusers 7530 (beer-light 3031 / spirits-full 2274 / basket 2225) |

Reading note: 429 latency (mean 23.6 ms) dominates the all-response stats; the 2xx-only row is the honest service-latency baseline. The 9575 429s come from the staging rate limiter under 50-concurrent load — expected for ramp phases, which is exactly why the zero-429 criterion is scoped to the separate steady suite.

### Workflow's own assertions (as configured) — attempt 3

| Assertion | Status |
|---|---|
| p95 < 2 s (steady window) | **pass** — `ok: p95 < 2000` (37 ms all responses; 658.6 ms 2xx-only) |
| error rate < 1 % | **not evaluated** — ensure condition crashed filtrex (lexical error); raw non-2xx share 98.2 % |
| zero 429s in steady window | **not evaluated** — steady-429-check phase never ran (process exited after Phase 1 crash); Phase-1 raw shows 9575 429s overall |

## Decision D — promote to blocking? (after attempt 3)

**Left open for the operator.** A live staging HTTP dataset now exists, but two of the three configured assertions remain unevaluated (error-rate condition unparseable; steady-429 suite never ran), so the configured gate as written has not produced a complete pass. Raw evidence cuts both ways: latency is comfortably inside thresholds (2xx p95 658.6 ms < 2 s), while the 429 share (98.2 % of responses under 50-concurrent load) makes an unqualified zero-429-steady result unlikely without isolating the steady window as designed. Recommendation: apply the filtrex expression fix above, re-dispatch, and take Decision D against a run where all three assertions actually evaluate.

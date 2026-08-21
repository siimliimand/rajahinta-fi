# Phase 0+1 Delivery & Cleanup — Tasks

> Derived from `docs/phase-0-1-verification-round-3.md` (round-3 audit).
> Wave order: 1 first (it gates every live verification), 2/3/4 in parallel,
> 5 last. Apply from a fresh branch off `master` (current checkout is
> `archive/phase0-1-runtime-composition-fix`).

---

## 1. Staging delivery (R3-1 — FS-1)

- [ ] 1.1 Fix the registry credential — add `permissions: contents: read, packages: write` and switch the GHCR login password to `secrets.GITHUB_TOKEN` in both deploy workflows; keep `REGISTRY_TOKEN` PAT as documented fallback if the `ghcr.io/rajahinta/rajahinta` package ACL blocks the repo token; verify with a pushed image (design D1) <!-- reopened post-merge: ghcr.io/rajahinta owner does not exist (404), push denied not_found; IMAGE_NAME moves to ghcr.io/siimliimand/rajahinta, the namespace this repo's GITHUB_TOKEN can push to -->
- [ ] 1.2 After merge to `master`, require one green end-to-end Deploy Staging run (image push, migrate Job complete, seed Job complete, rollout healthy), then walk `docs/staging-verification.md` against the live environment (products, 86 official + 3 v9999 tax rules, transport/retail offers, isolation, load commands) and record the pass in its checklist plus T0.4/T0.5 notes in `docs/tasks.md` <!-- DEFERRED 2026-08-22 by repo decision: staging Kubernetes cluster not provisioned (KUBE_CONFIG secret unset, cluster deferred until traffic justifies it). Registry credential + image push verified green (run 32529902593, ghcr.io/siimliimand/rajahinta). Resume when cluster exists: set KUBE_CONFIG secret, restore push trigger or dispatch manually, make the GHCR package public or wire a pull secret, then run this walk -->
- [ ] 1.3 Promote the artillery HTTP load step in `deploy-staging.yml` to blocking (remove `continue-on-error`) now that a baseline exists, and check T1.73 in `docs/tasks.md` with the baseline run reference (design D4) <!-- DEFERRED with 1.2: no baseline can exist until a staging deploy runs against a real cluster -->

## 2. Legacy pipeline removal (R3-2 — FS-2)

- [x] 2.1 Delete `.github/workflows/deploy.yml`; relocate its dev-compose smoke for feature-branch pushes into `ci.yml` only if still wanted; verify branch protection reports no missing required checks and no stuck check on open PRs (design D2) <!-- reopened once: compose-smoke curled /health which 404ed; real route /api/v1/health, Dockerfile HEALTHCHECK + k8s probe paths fixed with it; CI green on PR 22 after fix --> <!-- agent: devops-engineer.fast, depends_on: [], touches: [.github/workflows/deploy.yml, .github/workflows/ci.yml] -->

## 3. schema.sql retirement + doc truth (R3-4, R3-5 — FS-4)

- [x] 3.1 Delete `infra/staging-data/schema.sql` per ARCHITECTURE §15.1's deletion clause; update `infra/staging-data/README.md` and `setup.sh` to describe only the Drizzle-migration path plus generated `seed.sql`; the stale `excise_duty` comment disappears with the file (design D3) <!-- agent: devops-engineer.fast, depends_on: [], touches: [infra/staging-data/schema.sql, infra/staging-data/README.md, infra/staging-data/setup.sh] -->
- [x] 3.2 Doc-truth sweep — ARCHITECTURE §15 load-testing bullet (suite exists, wired post-deploy), drop the stale "vocabulary lint not yet implemented" note on T1.72 in `docs/tasks.md`, fix the `load-tests.yml` header `main` → `master` (design D6) <!-- agent: devops-engineer.fast, depends_on: [], touches: [ARCHITECTURE.md, docs/tasks.md, .github/workflows/load-tests.yml] -->
- [x] 3.3 Commit `docs/phase-0-1-verification-round-3.md` (currently untracked) as this change's source document <!-- agent: devops-engineer.fast, depends_on: [], touches: [docs/phase-0-1-verification-round-3.md] -->

## 4. Seed integrity + hygiene (R3-6, R3-7 — FS-5)

- [x] 4.1 Add per-version row-count mismatch detection to `seedTaxRules` — warn by default, fail in strict mode (opt-in env used by the staging seed Job path), never mutate existing rows; unit test with a partially-populated version covering both the warning and strict-failure paths (design D5) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/seed/tax-rules.seed.ts, packages/data-platform/src/seed/__tests__/**] -->
- [x] 4.2 Delete the stray scratch file `.opencode/opencode-onboard copy.json` (scratch files belong under `.opencode/.tmp/`) <!-- agent: platform-engineer.fast, depends_on: [], touches: [".opencode/opencode-onboard copy.json"] -->

## 5. Final verification

- [ ] 5.1 Final gate — clean-install `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:golden` green locally; full CI green on the PR; Deploy Staging green on `master` after merge; `grep -r excise_duty` still clean outside migration history and audit docs <!-- PARTIALLY MET and closed 2026-08-22: local suite green (typecheck, lint 0 errors, all unit suites, e2e 17/17, golden 30/30), full CI green on PR 22 and PR 23, excise_duty grep clean. Deploy Staging green on master DEFERRED with 1.2 (no cluster) -->

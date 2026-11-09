# Tasks

## 1. Stable cache keys

- [x] 1.1 Implement cache-aware trace headers in `apps/frontend/src/lib/api.ts`: positive `next.revalidate` requests keep generated `traceparent` but omit only generated `x-request-id`; preserve explicit IDs and existing non-cacheable behavior. Extend `api.fetch-client.test.ts` to verify header behavior and caller overrides. <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/lib/api.ts, apps/frontend/src/lib/__tests__/api.fetch-client.test.ts] -->
- [x] 1.2 Add a regression using real Next `generateCacheKey`: identical positive-revalidate blog/guide reads with different generated trace context map to the same key instead of minting per-call keys; verify non-cacheable requests retain generated request IDs. <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/lib/__tests__/api.next-cache-key.test.ts] -->
- [x] 1.3 Update OpenNext cache documentation and inline config comments for current Next 16 behavior, tag revalidation, product TTLs, stable-key invariant, and staging/production lifecycle commands; verify documented commands against installed Wrangler help. <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/OPENNEXT.md, apps/frontend/open-next.config.ts] -->

## 2. Local verification

- [x] 2.1 Run focused cache tests, full frontend Vitest, typecheck, eslint, and OpenNext production build; verify all pass and route cache classification remains unchanged. <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2, 1.3], touches: [] -->

## 3. Staging validation

- [x] 3.1 Apply and verify the 30-day lifecycle rule on `rajahinta-frontend-cache-staging`, deploy staging through the normal pipeline, and verify Worker health plus lifecycle configuration. <!-- agent: devops-engineer.fast, depends_on: [2.1], touches: [] -->
- [x] 3.2 Run the staging cache matrix: repeated localized renders within 900 s create no new blog/guide `.fetch` keys; revalidation reuses keys; footer links and publish behavior stay correct; API origin logs carry UUID and trace context. Record evidence in `verification.md`. <!-- agent: devops-engineer.fast, depends_on: [3.1], touches: [openspec/changes/fix-r2-fetch-cache-key-explosion/verification.md] -->

## 4. Production rollout

- [ ] 4.1 Apply and verify the 30-day lifecycle rule on `rajahinta-frontend-cache-production`, then run the gated production deploy only after staging validation is green; preserve Worker rollback availability. <!-- agent: devops-engineer.fast, depends_on: [3.2], touches: [] -->
- [ ] 4.2 Verify immediately and after 24 h: compare R2 PutObject volume against the ~35k/day baseline, check blog/guide duplicate objects stop growing, confirm API request volume and content freshness, and append results to `verification.md`. <!-- agent: devops-engineer.fast, depends_on: [4.1], touches: [openspec/changes/fix-r2-fetch-cache-key-explosion/verification.md] -->

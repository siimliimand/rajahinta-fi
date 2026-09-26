# Notes — unit-integrity-and-result-trust

## Task 1.3 — backfill applied locally + seed export path normalized (2026-09-26)

Branch `feature/unit-integrity-and-result-trust`. Local D1 = wrangler miniflare state of
`apps/api-worker` (binding `DB`, database `rajahinta-api-dev`).

### Apply command

```
cd apps/api-worker
CI=true ./node_modules/.bin/wrangler d1 execute DB --local \
  --file ../../openspec/changes/unit-integrity-and-result-trust/backfill.sql
```

### Counts (product_master)

| measure | before | after |
|---|---|---|
| total rows | 1,570 | 1,570 |
| ml-like (`unit_volume >= 5`) | 1,502 | 5 |
| `unit_volume >= 100` | 1,500 | 0 |
| `unit_volume < 0` | 0 | 0 |
| entity-bearing `name` (`&#…` or `&amp;`) | 196 | 0 |
| entity-bearing `brand` | 0 | 0 |

Baseline matches the 2026-09-25 header figures (1,502 ml-like of 1,570; 68 litre-like).

The 5 post-backfill rows still `>= 5` are correct litre values, not misses: two 5 l BIBs,
two 15 l BIBs ("1500cl BIB"), and one feed claim "24×33 l" (Karhu case; the feed name
itself says 33 l). They were ml-shaped only because the old mapper stored ml
(15000 → 15.0 etc.), so the single division fixed them. Consequence: the pass is NOT
re-runnable for those rows; the "idempotent" header claim was corrected in backfill.sql.

### Findings that changed backfill.sql

1. **Column affinity**: `product_master.unit_volume` is REAL (drizzle `real`), not TEXT
   as assumed in the task context. `typeof` was `real` for all 1,570 rows. Division by
   1000.0 is plain float arithmetic; spot values land on the same IEEE doubles the litre
   literals use (0.5, 0.33, 0.75) and a 10-decimal GLOB scan found zero artifacts.
   No CAST needed.
2. **LIKE guard was too narrow**: it matched `%&#0%` / `%&#8%` / `%&amp;%`, which misses
   `&#215;`-only rows — 79 occurrences (mostly `24×0.33 l` case names). Guard broadened
   to `%&#%` OR `%&amp;%`.
3. **Missing entity form**: `&#8211;` (en dash, 10 occurrences) was not in the REPLACE
   chain. Added. Full census: `&#038;`×29, `&#215;`×79, `&#8211;`×10, `&#8217;`×57,
   `&#8221;`×8, `&amp;`×17 (200 tokens total; 0 remain).

### Post-condition deviation: 20 zero-volume rows

`unit_volume <= 0 OR >= 100` cannot reach 0: 20 rows hold `unit_volume = 0.0` (feed
names with no parsable volume token, e.g. "33CLx24" — the parser's word-boundary rule
skips `Lx`; kept-by-design records). Unit conversion cannot invent a volume. The
post-condition was split into `>= 100` (0 ✓) and `< 0` (0 ✓), and the zero-volume
population is documented in backfill.sql as known residue. Task 1.4's quality invariant
(`0 < unit_volume < 100`) is the fix point going forward; these 20 rows predate it.

### Seed export path normalization (`scripts/seed-d1.ts`)

Reality found: the D1 seed export path (`writeSeedSqlFiles` → `staging.d1.sql`) emits the
45 staging fixtures, which already carry litre values and decoded text; the litres +
entity-decoding fix point for feed data is the ingestion mapper (tasks 1.1/1.2, already
committed). The ml rows in the local DB (product ids 9003+) came from pre-1.1 ingestion
runs, not from the seed.

Change: `scripts/seed-d1.ts` gained a fixture integrity gate that runs first in every
mode (including `--emit-sql-only`), failing loudly (exit 2) if any fixture volume sits
outside the canonical band (0, 100) litres or any fixture `name`/`manufacturer`/`brand`
is entity-bearing. Entity detection reuses `decodeHtmlEntities` from
`@rajahinta/data-acquisition` (imported from source; see follow-ups) as the single
decoding truth — no second entity map. The gate turns "reseeding cannot reintroduce ml"
into an enforced contract instead of an accident of current fixture values.

Note: `generate.ts` emits fixture values verbatim (`String(unitVolume)`, raw strings),
so validating the fixtures is equivalent to validating the emitted SQL.

### Reseed evidence

```
cd apps/api-worker && CI=true pnpm db:seed:d1:local
```

Output: fixture gate passed → generate (sha256 identical to the committed-on-disk
generation) → migrate → seed → `verification PASSED`. Post-reseed counts identical to
the post-backfill table above; Koskenkorva fixture (id 2) and the swept
"Koskenkorva 38% 50cl PET x 10 pullon laatikko" (id 10439) both read 0.5; a former
`&#038;` row reads a literal `&`.

One-time local cleanup: seed verification initially failed on
`transport_offers_total: expected 12, got 15` — ids 9101–9103 (carriers
`test-merchant-de`/`test-merchant-se`) were residue from test runs against local
miniflare state, unrelated to this change. Deleted locally; reseed then passed.

### Follow-ups for the lead

- `packages/data-acquisition/dist` is stale (built before wave 1; `dist/index.js` does
  not export `decodeHtmlEntities`). The gate imports the module from source like the
  script's existing relative imports; a dist rebuild may be worth a separate pass.
- No typecheck/lint coverage covers `scripts/` today (no tsconfig there); the script was
  verified by tsx execution in both `--emit-sql-only` and `--local` modes plus eslint.

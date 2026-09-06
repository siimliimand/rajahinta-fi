# G3 vertical-slice spike (historical)

Historical spike from the Cloudflare migration (migrate-to-cloudflare task 1.3),
kept frozen as the recorded G3 smoke/load evidence (`results/`) cited in
ARCHITECTURE.md. It predates change `drop-sweden-eur-only-alko-benchmark`, so its
seed and smoke fixtures still carry the since-removed Swedish merchant, SEK
conversion cases, and ECB rate references — none of that vocabulary exists in the
live product anymore. Do not run it against the current schema.

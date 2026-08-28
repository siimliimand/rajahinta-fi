-- Task 8.2 / design D4 (change technical-assessment-remediation):
-- adopt TimescaleDB for real — extension in migrations, price_observations
-- converted to a hypertable on observed_at.
--
-- drizzle-kit cannot emit CREATE EXTENSION / create_hypertable, so the
-- PK change it generated (id -> (id, observed_at), matching meta
-- snapshot 0014) is expressed here alongside the conversion. The
-- composite PK is required: a hypertable's unique constraints must
-- include the partitioning column. Queries and the watermark scan are
-- unchanged — semantics over a hypertable are identical, only storage
-- is chunked by time.

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint
ALTER TABLE "price_observations" DROP CONSTRAINT "price_observations_pkey";
--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_id_observed_at_pk" PRIMARY KEY ("id","observed_at");
--> statement-breakpoint
SELECT create_hypertable(
	'price_observations',
	'observed_at',
	chunk_time_interval => INTERVAL '7 days',
	migrate_data => true
);

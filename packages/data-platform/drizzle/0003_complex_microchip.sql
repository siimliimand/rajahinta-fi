CREATE TABLE "price_history_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"granularity" varchar(16) NOT NULL,
	"period_start" date NOT NULL,
	"product_id" integer NOT NULL,
	"merchant" varchar(128),
	"price_open_cents" integer NOT NULL,
	"price_close_cents" integer NOT NULL,
	"price_min_cents" integer NOT NULL,
	"price_max_cents" integer NOT NULL,
	"price_avg_cents" integer NOT NULL,
	"landed_cost_open_cents" integer NOT NULL,
	"landed_cost_close_cents" integer NOT NULL,
	"landed_cost_min_cents" integer NOT NULL,
	"landed_cost_max_cents" integer NOT NULL,
	"landed_cost_avg_cents" integer NOT NULL,
	"observation_count" integer NOT NULL,
	"strictest_reliability" varchar(16) NOT NULL,
	CONSTRAINT "price_history_summaries_bucket_key" UNIQUE NULLS NOT DISTINCT("granularity","period_start","product_id","merchant")
);
--> statement-breakpoint
ALTER TABLE "price_history_summaries" ADD CONSTRAINT "price_history_summaries_product_id_product_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_summaries_granularity_product_id_period_start_idx" ON "price_history_summaries" USING btree ("granularity","product_id","period_start");
CREATE TABLE "aggregation_watermarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(128) NOT NULL,
	"watermark" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aggregation_watermarks_job_name_unique" UNIQUE("job_name")
);
--> statement-breakpoint
CREATE INDEX "price_observations_observed_at_idx" ON "price_observations" USING btree ("observed_at");
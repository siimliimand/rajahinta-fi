CREATE TABLE "fx_rate_datasets" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_label" varchar(64) NOT NULL,
	"source_name" varchar(128) NOT NULL,
	"source_url" varchar(512),
	"reference_date" date NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"confirmed_by" varchar(128),
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_datasets_version_label_unique" UNIQUE("version_label")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset_id" integer NOT NULL,
	"base_currency" varchar(3) NOT NULL,
	"quote_currency" varchar(3) NOT NULL,
	"rate" numeric(24, 12) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_dataset_pair_unique" UNIQUE("dataset_id","base_currency","quote_currency")
);
--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_dataset_id_fx_rate_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."fx_rate_datasets"("id") ON DELETE no action ON UPDATE no action;
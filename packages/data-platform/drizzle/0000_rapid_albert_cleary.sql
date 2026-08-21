CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"email" varchar(320) NOT NULL,
	"tier" varchar(16) DEFAULT 'FREE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "calculation_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_master_id" integer NOT NULL,
	"retail_offer_ids" jsonb,
	"transport_offer_id" integer,
	"excise_rule_version_id" integer,
	"container_duty_rule_version_id" integer,
	"total_cents" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"confidence" varchar(6) NOT NULL,
	"quantity" integer NOT NULL,
	"destination" varchar(4) NOT NULL,
	"disclaimer" text NOT NULL,
	"session_id" varchar(64),
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_master" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(512) NOT NULL,
	"manufacturer" varchar(256) NOT NULL,
	"brand" varchar(256) NOT NULL,
	"category" varchar(32) NOT NULL,
	"alcohol_by_volume" numeric(5, 3),
	"unit_volume" numeric(10, 4) NOT NULL,
	"container_type" varchar(32) NOT NULL,
	"regulatory_classification" varchar(64) NOT NULL,
	"deposit_system_status" boolean,
	"ean" varchar(13),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant" varchar(128) NOT NULL,
	"country" varchar(4) NOT NULL,
	"product_id" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"availability" varchar(16) DEFAULT 'unknown' NOT NULL,
	"source_url" varchar(1024),
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"reliability_status" varchar(16) DEFAULT 'ESTIMATED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_baskets" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"items" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_type" varchar(32) NOT NULL,
	"product_category" varchar(32) NOT NULL,
	"rate" numeric(12, 6) NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"exemption_conditions" jsonb,
	"calculation_formula_reference" varchar(128) NOT NULL,
	"official_source" varchar(512) NOT NULL,
	"verification_date" timestamp,
	"version_label" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier" varchar(64) NOT NULL,
	"origin_country" varchar(4) NOT NULL,
	"destination_country" varchar(4) DEFAULT 'FI' NOT NULL,
	"weight_min_kg" numeric(10, 4),
	"weight_max_kg" numeric(10, 4),
	"package_tier" varchar(32) NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"seller_involvement_indicator" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	"reliability_status" varchar(16) DEFAULT 'ESTIMATED' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_product_master_id_product_master_id_fk" FOREIGN KEY ("product_master_id") REFERENCES "public"."product_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_transport_offer_id_transport_offers_id_fk" FOREIGN KEY ("transport_offer_id") REFERENCES "public"."transport_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_excise_rule_version_id_tax_rules_id_fk" FOREIGN KEY ("excise_rule_version_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_container_duty_rule_version_id_tax_rules_id_fk" FOREIGN KEY ("container_duty_rule_version_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_offers" ADD CONSTRAINT "retail_offers_product_id_product_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_baskets" ADD CONSTRAINT "saved_baskets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
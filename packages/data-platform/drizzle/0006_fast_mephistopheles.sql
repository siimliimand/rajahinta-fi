CREATE TABLE "basket_calculation_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64),
	"destination" text NOT NULL,
	"transport_arrangement" text NOT NULL,
	"input_basket" jsonb NOT NULL,
	"shipment_breakdown" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"confidence" varchar(6) NOT NULL,
	"disclaimer" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"minimum_order_value_cents" integer,
	"currency" text NOT NULL,
	"source_url" text,
	"reliability_status" varchar(16) DEFAULT 'ESTIMATED' NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_terms_merchant_id_unique" UNIQUE("merchant_id")
);

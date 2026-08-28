CREATE TABLE "merchant_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" varchar(128) NOT NULL,
	"name" varchar(256) NOT NULL,
	"country" varchar(4) NOT NULL,
	"feed_url" text NOT NULL,
	"feed_format" varchar(8) NOT NULL,
	"polling_interval_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_registry_merchant_id_unique" UNIQUE("merchant_id")
);

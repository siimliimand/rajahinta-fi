CREATE TABLE "click_counter_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" varchar(128) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"click_count" integer NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "click_counter_snapshots_merchant_url_captured_at_unique" UNIQUE("merchant_id","url","captured_at")
);

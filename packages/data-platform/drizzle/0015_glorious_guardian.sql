ALTER TABLE "retail_offers" ADD COLUMN "original_price_cents" integer;--> statement-breakpoint
ALTER TABLE "retail_offers" ADD COLUMN "original_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "retail_offers" ADD COLUMN "fx_dataset_version" varchar(64);
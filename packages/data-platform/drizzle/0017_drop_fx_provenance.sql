DROP TABLE "fx_rate_datasets" CASCADE;--> statement-breakpoint
DROP TABLE "fx_rates" CASCADE;--> statement-breakpoint
ALTER TABLE "retail_offers" DROP COLUMN "original_price_cents";--> statement-breakpoint
ALTER TABLE "retail_offers" DROP COLUMN "original_currency";--> statement-breakpoint
ALTER TABLE "retail_offers" DROP COLUMN "fx_dataset_version";
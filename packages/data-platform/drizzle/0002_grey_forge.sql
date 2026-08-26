CREATE TABLE "price_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"merchant" varchar(128) NOT NULL,
	"retail_offer_id" integer NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"foreign_retail_price_cents" integer NOT NULL,
	"transport_cost_cents" integer NOT NULL,
	"transport_offer_id" integer,
	"excise_rule_version_id" integer,
	"container_duty_rule_version_id" integer,
	"landed_cost_cents" integer NOT NULL,
	"input_reliability" jsonb NOT NULL,
	"confidence" varchar(6) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_product_id_product_master_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_retail_offer_id_retail_offers_id_fk" FOREIGN KEY ("retail_offer_id") REFERENCES "public"."retail_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_transport_offer_id_transport_offers_id_fk" FOREIGN KEY ("transport_offer_id") REFERENCES "public"."transport_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_excise_rule_version_id_tax_rules_id_fk" FOREIGN KEY ("excise_rule_version_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_container_duty_rule_version_id_tax_rules_id_fk" FOREIGN KEY ("container_duty_rule_version_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_observations_product_id_observed_at_idx" ON "price_observations" USING btree ("product_id","observed_at");--> statement-breakpoint
CREATE INDEX "price_observations_merchant_product_id_observed_at_idx" ON "price_observations" USING btree ("merchant","product_id","observed_at");
-- Task 8.1 (change technical-assessment-remediation): convert
-- calculation_records and basket_calculation_records to monthly range
-- partitions on their time columns.
--
-- drizzle-kit cannot express PARTITION BY, so this migration is
-- hand-written (precedent: 0001_tax_type_migration). The declared
-- schema.ts state it converges to — composite PK (id, calculated_at) /
-- (id, created_at) plus the sessions index — matches meta snapshot
-- 0013 exactly. Existing rows are carried over; the id sequences are
-- re-based so post-conversion inserts never collide with copied ids.
-- Partition parents get current-month, next-month, and a DEFAULT
-- partition; the retention job (CalculationRecordRetentionService)
-- keeps creating future partitions ahead of the writes.

--> statement-breakpoint
ALTER TABLE "calculation_records" RENAME TO "calculation_records_unpartitioned";
--> statement-breakpoint
CREATE TABLE "calculation_records" (
	"id" serial NOT NULL,
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
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calculation_records_id_calculated_at_pk" PRIMARY KEY ("id","calculated_at")
) PARTITION BY RANGE ("calculated_at");
--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_product_master_id_product_master_id_fk" FOREIGN KEY ("product_master_id") REFERENCES "public"."product_master"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_transport_offer_id_transport_offers_id_fk" FOREIGN KEY ("transport_offer_id") REFERENCES "public"."transport_offers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_excise_rule_version_id_tax_rules_id_fk" FOREIGN KEY ("excise_rule_version_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculation_records" ADD CONSTRAINT "calculation_records_container_duty_rule_version_id_tax_rules_id_fk" FOREIGN KEY ("container_duty_rule_version_id") REFERENCES "public"."tax_rules"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "calculation_records_session_id_calculated_at_idx" ON "calculation_records" USING btree ("session_id","calculated_at");
--> statement-breakpoint
DO $$
DECLARE
	month_start date;
	month_end date;
BEGIN
	FOR offset_months IN 0..1 LOOP
		month_start := (date_trunc('month', now()) + make_interval(months => offset_months))::date;
		month_end := (date_trunc('month', now()) + make_interval(months => offset_months + 1))::date;
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS "calculation_records_%s" PARTITION OF "calculation_records" FOR VALUES FROM (%L) TO (%L)',
			to_char(month_start, 'YYYY_MM'), month_start, month_end
		);
	END LOOP;
END
$$;
--> statement-breakpoint
CREATE TABLE "calculation_records_default" PARTITION OF "calculation_records" DEFAULT;
--> statement-breakpoint
INSERT INTO "calculation_records" SELECT * FROM "calculation_records_unpartitioned";
--> statement-breakpoint
SELECT setval(
	pg_get_serial_sequence('calculation_records', 'id'),
	COALESCE((SELECT MAX("id") FROM "calculation_records"), 1),
	(SELECT COUNT(*) FROM "calculation_records") > 0
);
--> statement-breakpoint
DROP TABLE "calculation_records_unpartitioned";
--> statement-breakpoint
ALTER TABLE "basket_calculation_records" RENAME TO "basket_calculation_records_unpartitioned";
--> statement-breakpoint
CREATE TABLE "basket_calculation_records" (
	"id" serial NOT NULL,
	"session_id" varchar(64),
	"destination" text NOT NULL,
	"transport_arrangement" text NOT NULL,
	"input_basket" jsonb NOT NULL,
	"shipment_breakdown" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"confidence" varchar(6) NOT NULL,
	"disclaimer" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "basket_calculation_records_id_created_at_pk" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
DO $$
BEGIN
	FOR offset_months IN 0..1 LOOP
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS "basket_calculation_records_%s" PARTITION OF "basket_calculation_records" FOR VALUES FROM (%L) TO (%L)',
			to_char((date_trunc('month', now()) + make_interval(months => offset_months))::date, 'YYYY_MM'),
			(date_trunc('month', now()) + make_interval(months => offset_months))::date,
			(date_trunc('month', now()) + make_interval(months => offset_months + 1))::date
		);
	END LOOP;
END
$$;
--> statement-breakpoint
CREATE TABLE "basket_calculation_records_default" PARTITION OF "basket_calculation_records" DEFAULT;
--> statement-breakpoint
INSERT INTO "basket_calculation_records" SELECT * FROM "basket_calculation_records_unpartitioned";
--> statement-breakpoint
SELECT setval(
	pg_get_serial_sequence('basket_calculation_records', 'id'),
	COALESCE((SELECT MAX("id") FROM "basket_calculation_records"), 1),
	(SELECT COUNT(*) FROM "basket_calculation_records") > 0
);
--> statement-breakpoint
DROP TABLE "basket_calculation_records_unpartitioned";

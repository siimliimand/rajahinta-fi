CREATE TABLE "audit_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"action" varchar(16) NOT NULL,
	"author" varchar(128) NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_events_entity_type_entity_id_occurred_at_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");
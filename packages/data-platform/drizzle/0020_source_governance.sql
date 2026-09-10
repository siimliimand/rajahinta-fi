CREATE TABLE "source_governance" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" varchar(128) NOT NULL,
	"acquisition_method" varchar(32) NOT NULL,
	"permission_status" varchar(16) NOT NULL,
	"source_url" text NOT NULL,
	"status_reason" text,
	"last_verified_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_governance_acquisition_method_check" CHECK ("source_governance"."acquisition_method" IN ('PERMITTED_FEED', 'RETAILER_API', 'STRUCTURED_MERCHANT_FEED', 'LICENSED_PROVIDER', 'COMPLIANT_CRAWLING', 'MANUAL_VERIFICATION')),
	CONSTRAINT "source_governance_permission_status_check" CHECK ("source_governance"."permission_status" IN ('GRANTED', 'PENDING', 'EXPIRED', 'REVOKED'))
);

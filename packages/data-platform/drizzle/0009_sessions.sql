CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"account_id" integer NOT NULL,
	"rotated_from_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rotated_from_id_sessions_id_fk" FOREIGN KEY ("rotated_from_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_account_id_idx" ON "sessions" USING btree ("account_id");
-- Task 5.1 (change technical-assessment-remediation): product search over
-- name, brand, and manufacturer (spec: product-search).
--
-- pg_trgm is chosen over tsvector: the product list is matched by short
-- partial words inside compound Finnish names ("karhu" inside
-- "Karhu III Olut"), which trigram similarity handles natively while
-- tsvector would need per-token prefix matching and cannot rank partial
-- hits. The GIN trgm indexes also accelerate the ILIKE recall filter the
-- ranked query uses, so one index serves both match and rank paths.
--
-- drizzle-kit cannot express gin_trgm_ops operator classes, and
-- schema.ts gains no columns for this change, so meta/0016_snapshot.json
-- is a verbatim copy of 0015 (schema state unchanged from drizzle-kit's
-- perspective) with only the chain id/prevId advanced. Future
-- drizzle-kit generate runs diff against that copy as usual.

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "product_master_name_trgm_idx" ON "product_master" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_master_brand_trgm_idx" ON "product_master" USING gin ("brand" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_master_manufacturer_trgm_idx" ON "product_master" USING gin ("manufacturer" gin_trgm_ops);

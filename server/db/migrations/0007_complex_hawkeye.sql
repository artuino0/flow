ALTER TABLE "record_relations" ADD COLUMN "tenant_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_relations_tenant_idx" ON "record_relations" USING btree ("tenant_id");
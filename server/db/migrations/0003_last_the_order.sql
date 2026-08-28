CREATE TABLE IF NOT EXISTS "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "records" ADD CONSTRAINT "records_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "records_tenant_idx" ON "records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "records_entity_idx" ON "records" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "records_custom_data_gin_idx" ON "records" USING gin ("custom_data");
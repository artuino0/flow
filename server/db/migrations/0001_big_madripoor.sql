CREATE TABLE IF NOT EXISTS "entity_field_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_field_id" uuid NOT NULL,
	"data_type" text NOT NULL,
	"validation_rules" jsonb NOT NULL,
	"is_required" boolean NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_field_history" ADD CONSTRAINT "entity_field_history_entity_field_id_entity_fields_id_fk" FOREIGN KEY ("entity_field_id") REFERENCES "public"."entity_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

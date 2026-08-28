CREATE TABLE IF NOT EXISTS "record_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relation_definition_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"target_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relation_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_relations" ADD CONSTRAINT "record_relations_relation_definition_id_relation_definitions_id_fk" FOREIGN KEY ("relation_definition_id") REFERENCES "public"."relation_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_relations" ADD CONSTRAINT "record_relations_source_record_id_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_relations" ADD CONSTRAINT "record_relations_target_record_id_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relation_definitions" ADD CONSTRAINT "relation_definitions_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relation_definitions" ADD CONSTRAINT "relation_definitions_target_entity_id_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_relations_source_idx" ON "record_relations" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_relations_target_idx" ON "record_relations" USING btree ("target_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "relation_definitions_tenant_name_unique" ON "relation_definitions" USING btree ("tenant_id","name");
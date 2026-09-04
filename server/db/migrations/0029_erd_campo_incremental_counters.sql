CREATE TABLE "entity_field_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_field_id" uuid NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"last_value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_field_counters" ADD CONSTRAINT "entity_field_counters_entity_field_id_entity_fields_id_fk" FOREIGN KEY ("entity_field_id") REFERENCES "public"."entity_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_field_counters_field_prefix_unique" ON "entity_field_counters" USING btree ("entity_field_id","prefix");
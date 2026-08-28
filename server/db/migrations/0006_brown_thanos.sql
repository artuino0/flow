CREATE TABLE IF NOT EXISTS "role_entity_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_entity_permissions" ADD CONSTRAINT "role_entity_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_entity_permissions" ADD CONSTRAINT "role_entity_permissions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_entity_permissions_role_entity_unique" ON "role_entity_permissions" USING btree ("role_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenant_name_unique" ON "roles" USING btree ("tenant_id","name");
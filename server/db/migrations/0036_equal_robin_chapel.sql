-- ERD-88: tabla print_reports (plantillas guardadas del Disenador de reportes
-- imprimibles) - ver comentario largo en server/db/schema.ts.
--
-- NOTA: drizzle-kit generate tambien detecto records.deleted_at/su indice
-- como "faltantes" porque la migracion 0035 (erd87_records_deleted_at) se
-- escribio a mano sin correr generate, dejando el snapshot de drizzle-kit
-- desactualizado - esas dos lineas se quitaron de este archivo a mano (ya
-- existen en la base desde 0035) para no intentar crearlas dos veces.
CREATE TABLE "print_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"title" text NOT NULL,
	"base_entity_slug" text NOT NULL,
	"dsl" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "print_reports" ADD CONSTRAINT "print_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_reports_tenant_idx" ON "print_reports" USING btree ("tenant_id");

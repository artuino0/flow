-- 0036/0037 predate 0035 in the historical journal. Databases already at
-- 0035 skipped them, even when later migrations (0038) were applied.
-- Forward repair preserves existing templates and also works on fresh installs.
CREATE TABLE IF NOT EXISTS "print_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "base_entity_slug" text NOT NULL,
  "dsl" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "print_reports_tenant_idx" ON "print_reports" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "print_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_reports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_print_reports ON "print_reports";
CREATE POLICY tenant_isolation_print_reports ON "print_reports"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "print_reports" TO erp_app;

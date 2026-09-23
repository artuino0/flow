-- Relaciones fiscales universales: un documento puede vincularse a varios
-- registros de cualquier módulo dinámico sin convertir el CFDI en dinámico.
CREATE TABLE IF NOT EXISTS "cfdi_document_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "cfdi_documents"("id") ON DELETE cascade,
  "entity_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "relation_type" text DEFAULT 'source' NOT NULL,
  "amount" numeric(18,2),
  "currency" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "cfdi_document_links_unique"
  ON "cfdi_document_links" ("tenant_id", "document_id", "entity_id", "record_id", "relation_type");
CREATE INDEX IF NOT EXISTS "cfdi_document_links_document_idx" ON "cfdi_document_links" ("document_id");
CREATE INDEX IF NOT EXISTS "cfdi_document_links_record_idx" ON "cfdi_document_links" ("tenant_id", "entity_id", "record_id");
CREATE INDEX IF NOT EXISTS "cfdi_document_links_tenant_idx" ON "cfdi_document_links" ("tenant_id");

-- Compatibilidad: los documentos creados antes de esta migración conservan
-- source_* y se reflejan aquí una sola vez.
INSERT INTO "cfdi_document_links" ("tenant_id", "document_id", "entity_id", "record_id", "relation_type")
SELECT "tenant_id", "id", "source_entity_id", "source_record_id", 'source'
FROM "cfdi_documents"
WHERE "source_entity_id" IS NOT NULL AND "source_record_id" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE cfdi_document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_document_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cfdi_document_links ON cfdi_document_links;
CREATE POLICY tenant_isolation_cfdi_document_links ON cfdi_document_links
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Dominio fiscal fijo: emision de CFDI 4.0 con PAC.
-- Pedido directo del usuario (2026-09-14): "la facturacion no debe ser un modulo
-- dinamico, la facturacion es fija". Ver DOCS/HU_Timbrado_CFDI_PAC.md (fases A-H)
-- y los comentarios de server/db/schema.ts. Tablas fijas con RLS por tenant
-- (patron HU-ERD-12/0037), folio atomico por row-lock en cfdi_series, y
-- auditoria append-only en cfdi_events (trigger, espiritu ERD-10).

CREATE TABLE IF NOT EXISTS "cfdi_series" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "serie" text NOT NULL,
  "tipo_comprobante" text NOT NULL CHECK ("tipo_comprobante" IN ('I', 'E', 'P')),
  "lugar_expedicion" text NOT NULL,
  "next_folio" integer DEFAULT 1 NOT NULL,
  "estado" text DEFAULT 'activa' NOT NULL CHECK ("estado" IN ('activa', 'inactiva')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT cfdi_series_next_folio_positive CHECK ("next_folio" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "cfdi_series_serie_tipo_unique" ON "cfdi_series" ("tenant_id", "serie", "tipo_comprobante");
CREATE INDEX IF NOT EXISTS "cfdi_series_tenant_idx" ON "cfdi_series" ("tenant_id");

CREATE TABLE IF NOT EXISTS "cfdi_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "serie_id" uuid NOT NULL REFERENCES "cfdi_series"("id") ON DELETE restrict,
  "folio" integer,
  "tipo" text NOT NULL CHECK ("tipo" IN ('I', 'E', 'P')),
  "estado" text DEFAULT 'borrador' NOT NULL CHECK ("estado" IN ('borrador', 'timbrando', 'timbrada', 'error', 'cancelada')),
  "fecha_emision" timestamptz,
  "emisor_rfc" text,
  "emisor_nombre" text,
  "emisor_regimen_fiscal" text,
  "emisor_codigo_postal" text,
  "customer_entity_id" uuid,
  "customer_record_id" uuid,
  "receptor_rfc" text,
  "receptor_nombre" text,
  "receptor_codigo_postal" text,
  "receptor_regimen_fiscal" text,
  "receptor_correo" text,
  "uso_cfdi" text,
  "forma_pago" text,
  "metodo_pago" text DEFAULT 'PUE' NOT NULL CHECK ("metodo_pago" IN ('PUE', 'PPD')),
  "moneda" text DEFAULT 'MXN' NOT NULL,
  "tipo_cambio" numeric(18,6),
  "subtotal" numeric(18,2) DEFAULT '0' NOT NULL,
  "descuento" numeric(18,2) DEFAULT '0' NOT NULL,
  "total" numeric(18,2) DEFAULT '0' NOT NULL,
  "impuestos" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "exportacion" text DEFAULT '01' NOT NULL CHECK ("exportacion" IN ('01', '02', '03')),
  "cfdi_relacionado_id" uuid REFERENCES "cfdi_documents"("id") ON DELETE restrict,
  "tipo_relacion" text,
  "source_entity_id" uuid,
  "source_record_id" uuid,
  "fecha_pago" timestamptz,
  "uuid_fiscal" text,
  "fecha_timbrado" timestamptz,
  "xml_storage_key" text,
  "pdf_storage_key" text,
  "mensaje_pac" text,
  "pac_provider" text,
  "pac_document_id" text,
  "intentos" integer DEFAULT 0 NOT NULL,
  "observaciones" text,
  "custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT cfdi_documents_folio_positivo CHECK ("folio" IS NULL OR "folio" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "cfdi_documents_folio_unique" ON "cfdi_documents" ("tenant_id", "serie_id", "folio") WHERE "folio" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cfdi_documents_uuid_fiscal_unique" ON "cfdi_documents" ("uuid_fiscal") WHERE "uuid_fiscal" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "cfdi_documents_tenant_estado_idx" ON "cfdi_documents" ("tenant_id", "estado");
CREATE INDEX IF NOT EXISTS "cfdi_documents_serie_idx" ON "cfdi_documents" ("serie_id");
CREATE INDEX IF NOT EXISTS "cfdi_documents_source_idx" ON "cfdi_documents" ("source_entity_id", "source_record_id");
CREATE INDEX IF NOT EXISTS "cfdi_documents_relacionado_idx" ON "cfdi_documents" ("cfdi_relacionado_id");

CREATE TABLE IF NOT EXISTS "cfdi_conceptos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "cfdi_documents"("id") ON DELETE cascade,
  "orden" integer DEFAULT 1 NOT NULL,
  "clave_prod_serv" text NOT NULL,
  "clave_unidad" text NOT NULL,
  "cantidad" numeric(18,6) NOT NULL CHECK ("cantidad" > 0),
  "descripcion" text NOT NULL,
  "valor_unitario" numeric(18,6) NOT NULL CHECK ("valor_unitario" >= 0),
  "descuento" numeric(18,6) DEFAULT '0' NOT NULL CHECK ("descuento" >= 0),
  "importe" numeric(18,6) NOT NULL CHECK ("importe" >= 0),
  "impuestos" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cfdi_conceptos_document_idx" ON "cfdi_conceptos" ("document_id");
CREATE INDEX IF NOT EXISTS "cfdi_conceptos_tenant_idx" ON "cfdi_conceptos" ("tenant_id");

CREATE TABLE IF NOT EXISTS "cfdi_payment_docs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "cfdi_documents"("id") ON DELETE cascade,
  "related_cfdi_id" uuid NOT NULL REFERENCES "cfdi_documents"("id") ON DELETE restrict,
  "num_parcialidad" integer,
  "imp_saldo_ant" numeric(18,2) NOT NULL,
  "imp_pagado" numeric(18,2) NOT NULL,
  "imp_saldo_ins" numeric(18,2) NOT NULL,
  "moneda_dr" text DEFAULT 'MXN' NOT NULL,
  "tipo_cambio_dr" numeric(18,6),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT cfdi_payment_docs_no_self CHECK ("document_id" <> "related_cfdi_id")
);
CREATE INDEX IF NOT EXISTS "cfdi_payment_docs_document_idx" ON "cfdi_payment_docs" ("document_id");
CREATE INDEX IF NOT EXISTS "cfdi_payment_docs_related_idx" ON "cfdi_payment_docs" ("related_cfdi_id");
CREATE INDEX IF NOT EXISTS "cfdi_payment_docs_tenant_idx" ON "cfdi_payment_docs" ("tenant_id");

CREATE TABLE IF NOT EXISTS "cfdi_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "cfdi_documents"("id") ON DELETE cascade,
  "tipo" text NOT NULL CHECK ("tipo" IN ('folio_asignado', 'intento_timbrado', 'timbrado_ok', 'error_pac', 'verificacion_getstatus', 'cancelacion_solicitada', 'cancelacion_confirmada', 'email_enviado')),
  "detalle" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cfdi_events_document_idx" ON "cfdi_events" ("document_id");
CREATE INDEX IF NOT EXISTS "cfdi_events_tenant_idx" ON "cfdi_events" ("tenant_id");

CREATE TABLE IF NOT EXISTS "tenant_pac_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "provider" text DEFAULT 'facturapi' NOT NULL,
  "api_key_encrypted" text,
  "sandbox" boolean DEFAULT true NOT NULL,
  "csd_cer_storage_key" text,
  "csd_key_storage_key" text,
  "csd_cer_file_name" text,
  "csd_key_file_name" text,
  "csd_password_encrypted" text,
  "csd_valid_until" timestamptz,
  "last_test_at" timestamptz,
  "last_test_ok" boolean,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_pac_settings_tenant_unique" ON "tenant_pac_settings" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_pac_settings_tenant_idx" ON "tenant_pac_settings" ("tenant_id");

-- Auditoria fiscal append-only: nada ni nadie (ni la app) modifica o borra
-- eventos ya registrados. El ON DELETE CASCADE de document_id sigue aplicando
-- (borrar el tenant completo en cascada es administracion, no auditoria).
CREATE OR REPLACE FUNCTION cfdi_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cfdi_events es append-only: % no permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cfdi_events_no_update ON cfdi_events;
CREATE TRIGGER cfdi_events_no_update BEFORE UPDATE ON cfdi_events
  FOR EACH ROW EXECUTE FUNCTION cfdi_events_append_only();

DROP TRIGGER IF EXISTS cfdi_events_no_delete ON cfdi_events;
CREATE TRIGGER cfdi_events_no_delete BEFORE DELETE ON cfdi_events
  FOR EACH ROW EXECUTE FUNCTION cfdi_events_append_only();

-- RLS por tenant (mismo patron que 0037_print_reports_rls.sql).
ALTER TABLE cfdi_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_series FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cfdi_series ON cfdi_series;
CREATE POLICY tenant_isolation_cfdi_series ON cfdi_series
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE cfdi_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cfdi_documents ON cfdi_documents;
CREATE POLICY tenant_isolation_cfdi_documents ON cfdi_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE cfdi_conceptos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_conceptos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cfdi_conceptos ON cfdi_conceptos;
CREATE POLICY tenant_isolation_cfdi_conceptos ON cfdi_conceptos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE cfdi_payment_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_payment_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cfdi_payment_docs ON cfdi_payment_docs;
CREATE POLICY tenant_isolation_cfdi_payment_docs ON cfdi_payment_docs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE cfdi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfdi_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cfdi_events ON cfdi_events;
CREATE POLICY tenant_isolation_cfdi_events ON cfdi_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_pac_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_pac_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_pac_settings ON tenant_pac_settings;
CREATE POLICY tenant_isolation_tenant_pac_settings ON tenant_pac_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

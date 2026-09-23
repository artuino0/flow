-- R2 / almacenamiento multi-tenant. La cuota se mide en bytes reales;
-- el límite lo asigna el plan del tenant.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS storage_limit_bytes bigint NOT NULL DEFAULT 2147483648,
  ADD COLUMN IF NOT EXISTS storage_used_bytes bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS site_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_assets_tenant_idx ON site_assets(tenant_id);
CREATE INDEX IF NOT EXISTS site_assets_site_idx ON site_assets(site_id);

-- Cuenta el contenido que ya existía antes de activar las cuotas.
UPDATE tenants t
SET storage_used_bytes =
  COALESCE((SELECT SUM(f.size_bytes)::bigint FROM files f WHERE f.tenant_id = t.id), 0) +
  COALESCE((SELECT SUM(c.size_bytes)::bigint FROM chat_attachments c WHERE c.tenant_id = t.id), 0) +
  COALESCE(t.logo_size_bytes, 0);

GRANT SELECT, INSERT, UPDATE, DELETE ON site_assets TO erp_app;
ALTER TABLE site_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_assets ON site_assets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

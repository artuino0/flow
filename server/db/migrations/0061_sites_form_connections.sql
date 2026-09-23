CREATE TABLE IF NOT EXISTS site_form_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  form_key text NOT NULL,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_form_connections_form_unique ON site_form_connections(tenant_id, site_id, page_id, form_key);
CREATE INDEX IF NOT EXISTS site_form_connections_tenant_idx ON site_form_connections(tenant_id);
CREATE INDEX IF NOT EXISTS site_form_connections_entity_idx ON site_form_connections(entity_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON site_form_connections TO erp_app;
ALTER TABLE site_form_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_form_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_form_connections ON site_form_connections USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

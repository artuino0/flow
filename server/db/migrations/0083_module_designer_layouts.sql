CREATE TABLE module_designer_layouts (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  positions jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON module_designer_layouts TO erp_app;
ALTER TABLE module_designer_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_designer_layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_module_designer_layouts ON module_designer_layouts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

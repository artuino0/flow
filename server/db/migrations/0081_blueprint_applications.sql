CREATE TABLE IF NOT EXISTS blueprint_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid,
  idempotency_key text NOT NULL,
  blueprint_hash text NOT NULL,
  applied_blueprint jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blueprint_applications_tenant_key_unique ON blueprint_applications(tenant_id, idempotency_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON blueprint_applications TO erp_app;
ALTER TABLE blueprint_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprint_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_blueprint_applications ON blueprint_applications;
CREATE POLICY tenant_isolation_blueprint_applications ON blueprint_applications
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

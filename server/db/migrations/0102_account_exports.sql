CREATE TABLE account_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
 storage_key text, expires_at timestamptz NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE account_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY account_exports_tenant ON account_exports USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON account_exports TO erp_app;

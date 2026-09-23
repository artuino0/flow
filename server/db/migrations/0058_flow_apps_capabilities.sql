CREATE TABLE IF NOT EXISTS tenant_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_apps_tenant_app_unique ON tenant_apps(tenant_id, app_key);
CREATE INDEX IF NOT EXISTS tenant_apps_tenant_idx ON tenant_apps(tenant_id);

CREATE TABLE IF NOT EXISTS role_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS role_capabilities_role_key_unique ON role_capabilities(role_id, capability_key);
CREATE INDEX IF NOT EXISTS role_capabilities_tenant_idx ON role_capabilities(tenant_id);

CREATE TABLE IF NOT EXISTS user_capability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  allowed boolean,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_capability_overrides_user_key_unique ON user_capability_overrides(user_id, capability_key);
CREATE INDEX IF NOT EXISTS user_capability_overrides_tenant_idx ON user_capability_overrides(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_apps, role_capabilities, user_capability_overrides TO erp_app;

ALTER TABLE tenant_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_apps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_apps ON tenant_apps USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_role_capabilities ON role_capabilities USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE user_capability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_capability_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_capability_overrides ON user_capability_overrides USING (tenant_id = current_setting('app.tenant_id', true)::uuid);


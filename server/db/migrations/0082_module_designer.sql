CREATE TABLE module_design_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','applied','discarded','error')),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  blueprint jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  credits_consumed integer NOT NULL DEFAULT 0,
  processing_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  discarded_at timestamptz
);
CREATE INDEX module_design_sessions_tenant_idx ON module_design_sessions(tenant_id, created_at DESC);
CREATE TABLE ai_credit_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  remaining integer NOT NULL CHECK (remaining >= 0 AND remaining <= quantity),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL
);
CREATE INDEX ai_credit_packages_available_idx ON ai_credit_packages(tenant_id, purchased_at) WHERE remaining > 0;
CREATE TABLE ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES module_design_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('generate','iterate','refund')),
  credits integer NOT NULL CHECK (credits > 0),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  model text,
  package_id uuid REFERENCES ai_credit_packages(id),
  period_start timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_credit_ledger_tenant_date_idx ON ai_credit_ledger(tenant_id, created_at);
CREATE TABLE module_design_rate_limits (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  bucket timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, scope, bucket)
);
INSERT INTO plan_limits (plan_id, concept, value)
SELECT id, 'aiCredits', CASE key WHEN 'agenda' THEN 0 WHEN 'starter' THEN 20 WHEN 'crecimiento' THEN 100 WHEN 'escala' THEN 300 ELSE NULL END
FROM plans ON CONFLICT (plan_id, concept) DO NOTHING;
GRANT SELECT, INSERT, UPDATE, DELETE ON module_design_sessions, ai_credit_packages, ai_credit_ledger, module_design_rate_limits TO erp_app;
ALTER TABLE module_design_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_design_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_module_design_sessions ON module_design_sessions USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE ai_credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ai_credit_packages ON ai_credit_packages USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE ai_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ai_credit_ledger ON ai_credit_ledger USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE module_design_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_design_rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_module_design_rate_limits ON module_design_rate_limits USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

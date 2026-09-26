-- Actualiza los planes existentes al catálogo comercial ERD-100.
UPDATE subscription_plans SET
  code = CASE code WHEN 'inicio' THEN 'starter' WHEN 'enterprise' THEN 'empresarial' ELSE code END,
  name = CASE code WHEN 'inicio' THEN 'Starter' WHEN 'enterprise' THEN 'Empresarial' ELSE name END,
  limits = CASE code
    WHEN 'inicio' THEN '{"storageBytes":5368709120,"users":8,"usersIncluded":3,"modules":10,"activeFlows":5,"automationExecutions":1000,"emails":2000,"stamps":20,"sites":1,"pages":3,"forms":3,"formSubmissions":500}'::jsonb
    WHEN 'crecimiento' THEN '{"storageBytes":10737418240,"users":null,"usersIncluded":10,"modules":null,"activeFlows":25,"automationExecutions":10000,"emails":10000,"stamps":50,"sites":3,"pages":15,"forms":null,"formSubmissions":3000}'::jsonb
    WHEN 'escala' THEN '{"storageBytes":53687091200,"users":null,"usersIncluded":30,"modules":null,"activeFlows":null,"automationExecutions":100000,"emails":30000,"stamps":200,"sites":10,"pages":null,"forms":null,"formSubmissions":null}'::jsonb
    WHEN 'enterprise' THEN '{"storageBytes":null,"users":null,"usersIncluded":null,"modules":null,"activeFlows":null,"automationExecutions":null,"emails":null,"stamps":null,"sites":null,"pages":null,"forms":null,"formSubmissions":null}'::jsonb
    ELSE limits END,
  monthly_price_cents = CASE code WHEN 'inicio' THEN 69900 WHEN 'crecimiento' THEN 149900 WHEN 'escala' THEN 349900 ELSE monthly_price_cents END,
  annual_price_cents = CASE code WHEN 'inicio' THEN 699000 WHEN 'crecimiento' THEN 1499000 WHEN 'escala' THEN 3499000 ELSE annual_price_cents END,
  updated_at = now();
INSERT INTO subscription_plans (code,name,description,monthly_price_cents,annual_price_cents,limits,is_public,sort_order)
VALUES ('agenda','Agenda','Plan de agenda, próximamente.',29900,299000,'{"storageBytes":1073741824,"users":2,"usersIncluded":1,"modules":0,"activeFlows":0,"automationExecutions":0,"emails":300,"stamps":2,"sites":0,"pages":0,"forms":0,"formSubmissions":0}'::jsonb,true,5)
ON CONFLICT (code) DO UPDATE SET limits=EXCLUDED.limits, name=EXCLUDED.name;
UPDATE tenants t SET storage_limit_bytes = (p.limits->>'storageBytes')::bigint
FROM tenant_subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
WHERE s.tenant_id=t.id AND p.limits->>'storageBytes' IS NOT NULL;
ALTER TABLE tenants ALTER COLUMN storage_limit_bytes SET DEFAULT 5368709120;
UPDATE tenants SET storage_limit_bytes=5368709120
WHERE NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id=tenants.id);
CREATE TABLE IF NOT EXISTS plan_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  concept text NOT NULL,
  value bigint,
  CONSTRAINT plan_limits_plan_concept_unique UNIQUE(plan_id, concept)
);
INSERT INTO plan_limits (plan_id, concept, value)
SELECT p.id, concepts.concept,
  CASE WHEN p.limits ? concepts.json_key AND p.limits->concepts.json_key <> 'null'::jsonb
    THEN (p.limits->>concepts.json_key)::bigint ELSE NULL END
FROM subscription_plans p
CROSS JOIN (VALUES
  ('users','users'), ('usersIncluded','usersIncluded'), ('modules','modules'), ('activeFlows','activeFlows'),
  ('executions','automationExecutions'), ('emails','emails'), ('storageBytes','storageBytes'), ('stamps','stamps'),
  ('sites','sites'), ('pages','pages'), ('forms','forms'), ('formSubmissions','formSubmissions')
) AS concepts(concept,json_key)
ON CONFLICT (plan_id,concept) DO UPDATE SET value=EXCLUDED.value;
ALTER TABLE subscription_plans DROP COLUMN limits;
ALTER TABLE subscription_plans RENAME TO plans;
ALTER TABLE plans RENAME COLUMN code TO key;
ALTER TABLE plans RENAME COLUMN is_active TO active;
ALTER INDEX subscription_plans_code_key RENAME TO plans_key_unique;
CREATE TABLE IF NOT EXISTS tenant_limit_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  concept text NOT NULL,
  value bigint,
  reason text NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_limit_overrides_tenant_concept_unique UNIQUE(tenant_id,concept)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_limits, tenant_limit_overrides TO erp_app;
GRANT SELECT ON plans TO erp_app;
ALTER TABLE tenant_limit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_limit_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_limit_overrides ON tenant_limit_overrides
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE TABLE IF NOT EXISTS stamp_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0), remaining integer NOT NULL CHECK (remaining >= 0),
  purchased_at timestamptz NOT NULL DEFAULT now(), origin text NOT NULL, stripe_session_id text
);
CREATE INDEX IF NOT EXISTS stamp_packages_available_idx ON stamp_packages(tenant_id,purchased_at) WHERE remaining > 0;
GRANT SELECT, INSERT, UPDATE, DELETE ON stamp_packages TO erp_app;
ALTER TABLE stamp_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE stamp_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stamp_packages ON stamp_packages USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

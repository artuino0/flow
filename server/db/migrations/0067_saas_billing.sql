-- Suscripción comercial de Flow. Estas tablas no son CFDI del tenant:
-- describen lo que Flow cobra al tenant y los límites que puede consumir.
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  monthly_price_cents integer NOT NULL DEFAULT 0,
  annual_price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'trialing',
  billing_interval text NOT NULL DEFAULT 'month',
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_tenant_idx ON tenant_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'stripe',
  provider_invoice_id text,
  status text NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  subtotal_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  amount_paid_cents integer NOT NULL DEFAULT 0,
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  hosted_invoice_url text,
  invoice_pdf_url text,
  provider_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_invoice_id)
);
CREATE INDEX IF NOT EXISTS tenant_billing_invoices_tenant_issued_idx ON tenant_billing_invoices(tenant_id, issued_at);

CREATE TABLE IF NOT EXISTS tenant_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  resource_key text NOT NULL,
  quantity bigint NOT NULL DEFAULT 0,
  limit_value bigint,
  captured_on date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'daily',
  UNIQUE(tenant_id, resource_key, captured_on)
);
CREATE INDEX IF NOT EXISTS tenant_usage_snapshots_tenant_day_idx ON tenant_usage_snapshots(tenant_id, captured_on);

-- Planes iniciales. Los Price IDs se llenan desde Stripe sin cambiar código.
INSERT INTO subscription_plans (code, name, description, monthly_price_cents, annual_price_cents, limits, is_public, sort_order)
VALUES
  ('inicio', 'Inicio', 'Para equipos pequeños que comienzan a centralizar su operación.', 69900, 670800, '{"storageBytes":2147483648,"users":3,"sites":1,"customDomains":1,"automationExecutions":300,"emails":0}'::jsonb, true, 10),
  ('crecimiento', 'Crecimiento', 'Para equipos que ya automatizan, venden y operan desde Flow.', 149900, 1438800, '{"storageBytes":10737418240,"users":10,"sites":3,"customDomains":3,"automationExecutions":3000,"emails":0}'::jsonb, true, 20),
  ('escala', 'Escala', 'Para operaciones consolidadas con mayor volumen y capacidad.', 349900, 3358800, '{"storageBytes":53687091200,"users":25,"sites":10,"customDomains":10,"automationExecutions":15000,"emails":0}'::jsonb, true, 30),
  ('enterprise', 'Enterprise', 'Límites, soporte e integración definidos para cada operación.', 0, 0, '{"storageBytes":0,"users":0,"sites":0,"customDomains":0,"automationExecutions":0,"emails":0}'::jsonb, false, 40)
ON CONFLICT (code) DO NOTHING;

-- Todo tenant existente inicia con Inicio; se puede migrar a un plan pagado
-- en cuanto Stripe confirme checkout o una importación de contrato.
INSERT INTO tenant_subscriptions (tenant_id, plan_id, provider, status, billing_interval, current_period_start)
SELECT t.id, p.id, 'manual', 'trialing', 'month', now()
FROM tenants t CROSS JOIN subscription_plans p
WHERE p.code = 'inicio'
ON CONFLICT (tenant_id) DO NOTHING;

-- El límite vigente de almacenamiento debe seguir al plan asignado.
UPDATE tenants t
SET storage_limit_bytes = COALESCE(NULLIF((p.limits->>'storageBytes')::bigint, 0), storage_limit_bytes)
FROM tenant_subscriptions s
JOIN subscription_plans p ON p.id = s.plan_id
WHERE s.tenant_id = t.id;

GRANT SELECT ON subscription_plans TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_subscriptions, tenant_billing_invoices, tenant_usage_snapshots TO erp_app;

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_subscriptions ON tenant_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_billing_invoices ON tenant_billing_invoices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_usage_snapshots ON tenant_usage_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

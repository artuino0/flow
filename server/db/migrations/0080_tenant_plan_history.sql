CREATE TABLE IF NOT EXISTS tenant_plan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  source text NOT NULL
);
CREATE INDEX IF NOT EXISTS tenant_plan_history_tenant_plan_idx ON tenant_plan_history(tenant_id, plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_plan_history_open_unique ON tenant_plan_history(tenant_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_plan_history TO erp_app;
ALTER TABLE tenant_plan_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_plan_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_plan_history ON tenant_plan_history;
CREATE POLICY tenant_isolation_tenant_plan_history ON tenant_plan_history
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

INSERT INTO tenant_plan_history (tenant_id, plan_id, started_at, source)
SELECT s.tenant_id, s.plan_id, COALESCE(s.current_period_start, s.created_at), 'backfill'
FROM tenant_subscriptions s
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_plan_history h WHERE h.tenant_id = s.tenant_id AND h.ended_at IS NULL
);

CREATE OR REPLACE FUNCTION record_tenant_plan_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.plan_id IS NOT DISTINCT FROM NEW.plan_id THEN
      RETURN NEW;
    END IF;
    UPDATE tenant_plan_history SET ended_at = now()
    WHERE tenant_id = NEW.tenant_id AND ended_at IS NULL;
  END IF;

  INSERT INTO tenant_plan_history (tenant_id, plan_id, started_at, source)
  VALUES (
    NEW.tenant_id,
    NEW.plan_id,
    CASE WHEN TG_OP = 'INSERT' THEN COALESCE(NEW.current_period_start, NEW.created_at) ELSE now() END,
    COALESCE(NULLIF(current_setting('app.plan_change_source', true), ''),
      CASE WHEN TG_OP = 'INSERT' THEN 'initial' ELSE 'subscription_update' END)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_plan_history_change ON tenant_subscriptions;
CREATE TRIGGER tenant_plan_history_change
AFTER INSERT OR UPDATE OF plan_id ON tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION record_tenant_plan_history();

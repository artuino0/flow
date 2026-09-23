ALTER TABLE entities ADD COLUMN IF NOT EXISTS board_config jsonb;

CREATE TABLE IF NOT EXISTS trigger_action_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trigger_action_id uuid NOT NULL REFERENCES trigger_actions(id) ON DELETE CASCADE,
  source_record_id uuid REFERENCES records(id) ON DELETE SET NULL,
  target_record_id uuid REFERENCES records(id) ON DELETE SET NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trigger_action_outputs_tenant_idx ON trigger_action_outputs(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS trigger_action_outputs_action_source_unique ON trigger_action_outputs(trigger_action_id, source_record_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON trigger_action_outputs TO erp_app;
ALTER TABLE trigger_action_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_action_outputs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_trigger_action_outputs ON trigger_action_outputs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

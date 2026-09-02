-- RLS sobre triggers/trigger_actions/trigger_logs (HU-ERD-47), mismo patron
-- que HU-ERD-12/HU-ERD-14/HU-ERD-27/HU-ERD-78. Las tres tablas tienen
-- tenant_id propio (trigger_actions/trigger_logs lo denormalizan a proposito -
-- ver comentario largo en server/db/schema.ts) para que la policy de cada
-- una filtre directo, sin depender de un join a triggers.

ALTER TABLE triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE triggers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_triggers ON triggers;
CREATE POLICY tenant_isolation_triggers ON triggers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE trigger_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_actions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_trigger_actions ON trigger_actions;
CREATE POLICY tenant_isolation_trigger_actions ON trigger_actions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE trigger_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_trigger_logs ON trigger_logs;
CREATE POLICY tenant_isolation_trigger_logs ON trigger_logs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

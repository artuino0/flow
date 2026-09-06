-- RLS sobre reports (Épica ERD-46, Reportería con IA), mismo patron que
-- HU-ERD-12/HU-ERD-27/HU-ERD-47/HU-ERD-78.

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_reports ON reports;
CREATE POLICY tenant_isolation_reports ON reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

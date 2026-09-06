-- RLS sobre print_reports (HU-ERD-88, Disenador de reportes imprimibles),
-- mismo patron que HU-ERD-12/HU-ERD-27/HU-ERD-47/HU-ERD-78/HU-ERD-46.

ALTER TABLE print_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_print_reports ON print_reports;
CREATE POLICY tenant_isolation_print_reports ON print_reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

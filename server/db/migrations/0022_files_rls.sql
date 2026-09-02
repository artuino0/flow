-- RLS sobre files (HU-ERD-78), mismo patron que HU-ERD-12/HU-ERD-14/HU-ERD-27.
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_files ON files;
CREATE POLICY tenant_isolation_files ON files
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

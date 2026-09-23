ALTER TABLE entities ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
GRANT SELECT, INSERT, UPDATE, DELETE ON entities TO erp_app;

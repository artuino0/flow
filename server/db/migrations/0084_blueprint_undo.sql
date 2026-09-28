ALTER TABLE blueprint_applications ADD COLUMN undone_at timestamptz;
ALTER TABLE blueprint_applications ADD COLUMN undone_by uuid;

ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_shortcuts jsonb NOT NULL DEFAULT '[]'::jsonb;

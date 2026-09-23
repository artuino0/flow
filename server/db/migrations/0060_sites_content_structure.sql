ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'website';
CREATE INDEX IF NOT EXISTS site_pages_kind_idx ON site_pages(tenant_id, kind);
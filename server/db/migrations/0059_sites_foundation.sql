CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  locale text NOT NULL DEFAULT 'es-MX',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_tenant_slug_unique ON sites(tenant_id, slug);
CREATE INDEX IF NOT EXISTS sites_tenant_idx ON sites(tenant_id);

CREATE TABLE IF NOT EXISTS site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_version_id uuid,
  published_version_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_pages_site_path_unique ON site_pages(site_id, path);
CREATE INDEX IF NOT EXISTS site_pages_tenant_idx ON site_pages(tenant_id);
CREATE INDEX IF NOT EXISTS site_pages_site_idx ON site_pages(site_id);

CREATE TABLE IF NOT EXISTS site_page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  html text NOT NULL DEFAULT '',
  css text NOT NULL DEFAULT '',
  form_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_page_versions_page_version_unique ON site_page_versions(page_id, version);
CREATE INDEX IF NOT EXISTS site_page_versions_tenant_idx ON site_page_versions(tenant_id);
CREATE INDEX IF NOT EXISTS site_page_versions_page_idx ON site_page_versions(page_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON sites, site_pages, site_page_versions TO erp_app;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sites ON sites USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_pages ON site_pages USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE site_page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_page_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_page_versions ON site_page_versions USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

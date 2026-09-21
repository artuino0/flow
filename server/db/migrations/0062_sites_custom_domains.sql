CREATE TABLE IF NOT EXISTS site_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  is_primary boolean NOT NULL DEFAULT false,
  root_page_id uuid REFERENCES site_pages(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'vercel',
  provider_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_domains_status_check CHECK (status IN ('pending','active','error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS site_domains_hostname_unique ON site_domains(lower(hostname));
CREATE INDEX IF NOT EXISTS site_domains_tenant_idx ON site_domains(tenant_id);
CREATE INDEX IF NOT EXISTS site_domains_site_idx ON site_domains(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS site_domains_primary_unique ON site_domains(site_id) WHERE is_primary;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_domains TO erp_app;
ALTER TABLE site_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_domains ON site_domains
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION resolve_published_site_domain(p_hostname text, p_path text)
RETURNS TABLE (site_id uuid,page_id uuid,site_name text,site_locale text,page_title text,page_path text,seo jsonb,html text,css text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,p.id,s.name,s.locale,p.title,p.path,p.seo,v.html,v.css
 FROM site_domains d
 JOIN sites s ON s.id=d.site_id AND s.tenant_id=d.tenant_id
 JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=d.tenant_id
  AND ((p_path='/' AND d.root_page_id IS NOT NULL AND p.id=d.root_page_id)
   OR ((p_path<>'/' OR d.root_page_id IS NULL) AND p.path=p_path))
 JOIN site_page_versions v ON v.id=p.published_version_id AND v.tenant_id=d.tenant_id
 WHERE lower(d.hostname)=lower(p_hostname) AND d.status='active'
  AND s.status='published' AND p.status='published' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION resolve_published_site_preview(p_site_id uuid,p_path text)
RETURNS TABLE (site_id uuid,page_id uuid,site_name text,site_locale text,page_title text,page_path text,seo jsonb,html text,css text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,p.id,s.name,s.locale,p.title,p.path,p.seo,v.html,v.css
 FROM sites s
 JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=s.tenant_id AND p.path=p_path
 JOIN site_page_versions v ON v.id=p.published_version_id AND v.tenant_id=s.tenant_id
 WHERE s.id=p_site_id AND s.status='published' AND p.status='published' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_active_site_domain(p_hostname text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM site_domains WHERE lower(hostname)=lower(p_hostname) AND status='active');
$$;
REVOKE ALL ON FUNCTION resolve_published_site_domain(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_published_site_preview(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_active_site_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_published_site_domain(text,text) TO erp_app;
GRANT EXECUTE ON FUNCTION resolve_published_site_preview(uuid,text) TO erp_app;
GRANT EXECUTE ON FUNCTION is_active_site_domain(text) TO erp_app;

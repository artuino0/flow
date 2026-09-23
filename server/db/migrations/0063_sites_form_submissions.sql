-- Capturas públicas de Flow Sites y su entrega genérica a cualquier módulo de Flow Core.
CREATE TABLE IF NOT EXISTS site_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES site_form_connections(id) ON DELETE SET NULL,
  form_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_form_submissions_status_check CHECK (status IN ('received','processed','failed'))
);
CREATE INDEX IF NOT EXISTS site_form_submissions_tenant_idx ON site_form_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS site_form_submissions_form_idx ON site_form_submissions(site_id,page_id,form_key,created_at DESC);
CREATE INDEX IF NOT EXISTS site_form_submissions_origin_gin_idx ON site_form_submissions USING gin(origin_metadata);

CREATE TABLE IF NOT EXISTS site_form_submission_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES site_form_submissions(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  action text NOT NULL DEFAULT 'created',
  mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_form_submission_targets_action_check CHECK (action IN ('created','updated','linked'))
);
CREATE INDEX IF NOT EXISTS site_form_submission_targets_tenant_idx ON site_form_submission_targets(tenant_id);
CREATE INDEX IF NOT EXISTS site_form_submission_targets_submission_idx ON site_form_submission_targets(submission_id);
CREATE INDEX IF NOT EXISTS site_form_submission_targets_record_idx ON site_form_submission_targets(record_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON site_form_submissions, site_form_submission_targets TO erp_app;

ALTER TABLE site_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_form_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_form_submissions ON site_form_submissions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE site_form_submission_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_form_submission_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_site_form_submission_targets ON site_form_submission_targets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Resuelve exclusivamente formularios publicados. El endpoint público obtiene
-- el tenant desde esta función y nunca acepta tenant_id enviado por el cliente.
CREATE OR REPLACE FUNCTION resolve_published_site_form(p_site_id uuid,p_page_id uuid,p_form_key text)
RETURNS TABLE (
  tenant_id uuid,
  site_id uuid,
  page_id uuid,
  connection_id uuid,
  entity_id uuid,
  entity_slug text,
  field_mapping jsonb,
  form_manifest jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT s.tenant_id,s.id,p.id,c.id,c.entity_id,e.slug,c.field_mapping,form_item.value
  FROM sites s
  JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=s.tenant_id
  JOIN site_page_versions v ON v.id=p.published_version_id AND v.tenant_id=s.tenant_id
  JOIN LATERAL jsonb_array_elements(v.form_manifest) form_item(value)
    ON form_item.value->>'id'=p_form_key
  JOIN site_form_connections c ON c.tenant_id=s.tenant_id AND c.site_id=s.id
    AND c.page_id=p.id AND c.form_key=p_form_key AND c.status='active'
  JOIN entities e ON e.id=c.entity_id AND e.tenant_id=s.tenant_id
    AND e.is_active=true AND e.deleted_at IS NULL
  WHERE s.id=p_site_id AND p.id=p_page_id
    AND s.status='published' AND p.status='published'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_published_site_form(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_published_site_form(uuid,uuid,text) TO erp_app;

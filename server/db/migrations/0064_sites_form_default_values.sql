ALTER TABLE site_form_connections
  ADD COLUMN IF NOT EXISTS default_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS value_mappings jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS resolve_published_site_form(uuid,uuid,text);

CREATE FUNCTION resolve_published_site_form(p_site_id uuid,p_page_id uuid,p_form_key text)
RETURNS TABLE (
  tenant_id uuid,
  site_id uuid,
  page_id uuid,
  connection_id uuid,
  entity_id uuid,
  entity_slug text,
  field_mapping jsonb,
  default_values jsonb,
  value_mappings jsonb,
  form_manifest jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT s.tenant_id,s.id,p.id,c.id,c.entity_id,e.slug,c.field_mapping,c.default_values,c.value_mappings,form_item.value
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

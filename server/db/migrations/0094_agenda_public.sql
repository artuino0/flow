CREATE TABLE agenda_site_settings (
 site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 config jsonb NOT NULL DEFAULT '{"enabled":false}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agenda_public_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE, page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 client_email_hash text, client_phone_hash text, service_ids jsonb NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
 created_at timestamptz NOT NULL DEFAULT now(), canceled_at timestamptz, expires_at timestamptz NOT NULL,
 origin_hash text NOT NULL, user_agent text NOT NULL CHECK (length(user_agent)<=300),
 reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count>=0)
);
CREATE INDEX agenda_public_contact_idx ON agenda_public_bookings(tenant_id,client_email_hash,client_phone_hash) WHERE status='active';
CREATE INDEX agenda_public_site_idx ON agenda_public_bookings(tenant_id,site_id,created_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON agenda_site_settings,agenda_public_bookings TO erp_app;
ALTER TABLE agenda_site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_site_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agenda_site_settings ON agenda_site_settings
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.tenant_id=agenda_site_settings.tenant_id));
ALTER TABLE agenda_public_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_public_bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agenda_public_bookings ON agenda_public_bookings
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM sites s WHERE s.id=site_id AND s.tenant_id=agenda_public_bookings.tenant_id)
 AND EXISTS(SELECT 1 FROM site_pages p WHERE p.id=page_id AND p.site_id=agenda_public_bookings.site_id AND p.tenant_id=agenda_public_bookings.tenant_id)
 AND EXISTS(SELECT 1 FROM records r JOIN entities e ON e.id=r.entity_id AND e.tenant_id=r.tenant_id WHERE r.id=record_id AND r.tenant_id=agenda_public_bookings.tenant_id AND e.slug='agenda-citas' AND e.template_key='agenda'));

-- Descubrimiento público acotado: solo tenant de una página efectivamente
-- publicada y una agenda activada; el hostname Flow se valida en el servidor.
CREATE FUNCTION resolve_public_agenda(sid uuid,pid uuid,hostname text,flow_preview boolean)
RETURNS TABLE(tenant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.tenant_id FROM sites s
 JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=s.tenant_id
 JOIN site_page_versions v ON v.id=p.published_version_id AND v.page_id=p.id AND v.site_id=s.id AND v.tenant_id=s.tenant_id
 JOIN agenda_site_settings a ON a.site_id=s.id AND a.tenant_id=s.tenant_id
 WHERE s.id=sid AND p.id=pid AND s.status='published' AND p.status='published'
 AND a.config->>'enabled'='true'
 AND (flow_preview OR EXISTS(SELECT 1 FROM site_domains d WHERE d.site_id=s.id AND d.tenant_id=s.tenant_id AND d.hostname=hostname AND d.status='active')) LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_public_agenda(uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_agenda(uuid,uuid,text,boolean) TO erp_app;

ALTER TABLE site_page_versions ADD COLUMN seo jsonb;
--> statement-breakpoint
-- Congela el SEO público anterior ANTES de permitir editar el nuevo borrador.
UPDATE site_page_versions v SET seo=p.seo FROM site_pages p
WHERE v.id=p.published_version_id AND v.tenant_id=p.tenant_id AND v.site_id=p.site_id;
--> statement-breakpoint
-- NULL mantiene el SEO histórico de páginas que aún no se han republicado.
CREATE OR REPLACE FUNCTION resolve_published_site_domain(p_hostname text, p_path text)
RETURNS TABLE (site_id uuid,page_id uuid,site_name text,site_locale text,page_title text,page_path text,seo jsonb,html text,css text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,p.id,s.name,s.locale,p.title,p.path,coalesce(v.seo,p.seo),v.html,v.css
 FROM site_domains d JOIN sites s ON s.id=d.site_id AND s.tenant_id=d.tenant_id
 JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=d.tenant_id
  AND ((p_path='/' AND d.root_page_id IS NOT NULL AND p.id=d.root_page_id)
   OR ((p_path<>'/' OR d.root_page_id IS NULL) AND p.path=p_path))
 JOIN site_page_versions v ON v.id=p.published_version_id AND v.tenant_id=d.tenant_id
 WHERE lower(d.hostname)=lower(p_hostname) AND d.status='active'
 AND s.status='published' AND p.status='published' LIMIT 1;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_published_site_preview(p_site_id uuid,p_path text)
RETURNS TABLE (site_id uuid,page_id uuid,site_name text,site_locale text,page_title text,page_path text,seo jsonb,html text,css text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,p.id,s.name,s.locale,p.title,p.path,coalesce(v.seo,p.seo),v.html,v.css
 FROM sites s JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=s.tenant_id AND p.path=p_path
 JOIN site_page_versions v ON v.id=p.published_version_id AND v.tenant_id=s.tenant_id
 WHERE s.id=p_site_id AND s.status='published' AND p.status='published' LIMIT 1;
$$;
--> statement-breakpoint
-- Únicamente datos públicos; nunca IDs de organización ni configuración interna.
CREATE FUNCTION public_site_seo_context(p_hostname text)
RETURNS TABLE(site_id uuid, status text, site_status text, primary_host text, root_path text, verification jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,d.status,s.status,main.hostname,coalesce(root.path,'/'),s.settings->'searchVerification'
 FROM site_domains d JOIN sites s ON s.id=d.site_id AND s.tenant_id=d.tenant_id
 LEFT JOIN LATERAL (SELECT x.hostname,x.root_page_id FROM site_domains x
   WHERE x.site_id=s.id AND x.tenant_id=s.tenant_id AND x.status='active'
   ORDER BY x.is_primary DESC,x.created_at,x.hostname LIMIT 1) main ON true
 LEFT JOIN site_pages root ON root.id=main.root_page_id AND root.site_id=s.id AND root.tenant_id=s.tenant_id
 WHERE lower(d.hostname)=lower(p_hostname) LIMIT 1;
$$;
--> statement-breakpoint
CREATE FUNCTION public_site_sitemap(p_hostname text)
RETURNS TABLE(path text,seo jsonb,lastmod timestamptz,html text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT p.path,coalesce(v.seo,p.seo),v.updated_at,v.html
 FROM site_domains d JOIN sites s ON s.id=d.site_id AND s.tenant_id=d.tenant_id
 JOIN site_pages p ON p.site_id=s.id AND p.tenant_id=s.tenant_id
 JOIN site_page_versions v ON v.id=p.published_version_id AND v.tenant_id=s.tenant_id
 WHERE lower(d.hostname)=lower(p_hostname) AND d.status='active' AND s.status='published'
 AND p.status='published' AND coalesce(v.seo,p.seo)->>'noindex' IS DISTINCT FROM 'true'
 ORDER BY p.path LIMIT 50000;
$$;
--> statement-breakpoint
CREATE FUNCTION public_site_seo_image(p_hostname text,p_asset_id uuid)
RETURNS TABLE(file_name text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT a.file_name FROM site_domains d JOIN sites s ON s.id=d.site_id AND s.tenant_id=d.tenant_id
 JOIN site_assets a ON a.site_id=s.id AND a.tenant_id=s.tenant_id AND a.id=p_asset_id
 WHERE lower(d.hostname)=lower(p_hostname) AND d.status='active' AND s.status='published'
 AND a.mime_type IN ('image/png','image/jpeg','image/webp','image/gif','image/avif')
 AND a.storage_key LIKE 'tenants/'||s.tenant_id||'/sites/'||s.id||'/assets/%'
 AND a.size_bytes BETWEEN 0 AND 15728640
 -- El middleware sirve aliases de activos mediante la página de inicio publicada.
 AND EXISTS(SELECT 1 FROM site_pages p WHERE p.site_id=s.id AND p.tenant_id=s.tenant_id AND p.status='published' AND p.published_version_id IS NOT NULL
   AND ((d.root_page_id IS NOT NULL AND p.id=d.root_page_id) OR (d.root_page_id IS NULL AND p.path='/')))
 AND (SELECT count(*) FROM site_assets x WHERE x.site_id=s.id AND x.tenant_id=s.tenant_id AND x.file_name=a.file_name)=1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_site_seo_context(text),public_site_sitemap(text),public_site_seo_image(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_site_seo_context(text),public_site_sitemap(text),public_site_seo_image(text,uuid) TO erp_app;

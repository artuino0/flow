-- La prueba del catálogo descubrió 17 tenant_id sin FK directa además
-- de las 6 FK con NO ACTION. No inventar excepciones para sus huérfanos.
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['dim_cliente','dim_sucursal','entities','fact_eventos','files','print_reports','record_activities','record_relations','records','relation_definitions','reports','roles','trigger_action_outputs','trigger_actions','trigger_logs','triggers','users']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE',relation,relation||'_account_tenant_fk');
 END LOOP;
END $$;

CREATE FUNCTION account_capture_crm_event(flow_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO platform_crm_events(tenant_id) VALUES(flow_tenant) ON CONFLICT(tenant_id) DO UPDATE SET generation=gen_random_uuid();
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'account_crm_capture_failed';
END $$;
REVOKE ALL ON FUNCTION account_capture_crm_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_capture_crm_event(uuid) TO erp_app;

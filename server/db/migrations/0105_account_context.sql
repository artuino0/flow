-- Una ida a la BD, manteniendo las guardias. VOLATILE obtiene un snapshot
-- nuevo para la consulta de estado después de esperar el candado del borrado.
CREATE FUNCTION account_tenant_context(flow_tenant uuid,flow_user uuid,flow_role uuid,flow_system boolean,flow_now timestamptz,flow_platform text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 PERFORM set_config('app.person_id','00000000-0000-0000-0000-000000000000',true),
  set_config('app.tenant_id',flow_tenant::text,true),set_config('app.user_id',flow_user::text,true),
  set_config('app.role_id',flow_role::text,true),set_config('app.record_system',CASE WHEN flow_system THEN 'on' ELSE 'off' END,true);
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(flow_tenant::text,191));
 RETURN account_lifecycle_state(flow_tenant,flow_now,flow_platform);
END $$;
REVOKE ALL ON FUNCTION account_tenant_context(uuid,uuid,uuid,boolean,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_tenant_context(uuid,uuid,uuid,boolean,timestamptz,text) TO erp_app;

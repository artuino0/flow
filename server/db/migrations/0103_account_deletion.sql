CREATE TABLE account_deletion_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('file','domain','subscription','customer')), ref text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}', done_at timestamptz, UNIQUE(tenant_id,kind,ref)
);
ALTER TABLE account_deletion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_items FORCE ROW LEVEL SECURITY;
CREATE POLICY account_deletion_items_tenant ON account_deletion_items USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON account_deletion_items TO erp_app;

-- Catálogo real y presupuesto por tabla. No se puede pasar SQL ni una tabla
-- arbitraria desde el cliente. Solo una cuenta marcada tras las salvaguardas.
CREATE FUNCTION account_delete_batch(flow_tenant uuid,flow_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item record; affected integer; total integer := 0; previous_delete text := current_setting('app.account_deleting_tenant',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=flow_tenant AND account_lifecycle->>'deletionStarted'='true') THEN RAISE EXCEPTION 'Account deletion not started'; END IF;
 PERFORM set_config('app.account_deleting_tenant',flow_tenant::text,true);
 FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN
  ('account_deletion_items','account_notices','tenant_subscriptions','users','roles','platform_crm_events') ORDER BY c.relname
 LOOP
  BEGIN
   EXECUTE format('DELETE FROM public.%I WHERE ctid IN (SELECT ctid FROM public.%I WHERE tenant_id=$1 LIMIT $2 FOR UPDATE SKIP LOCKED)',item.relname,item.relname)
    USING flow_tenant,least(greatest(flow_limit,1),500);
   GET DIAGNOSTICS affected=ROW_COUNT; total:=total+affected;
   IF total>=500 THEN PERFORM set_config('app.account_deleting_tenant',coalesce(previous_delete,''),true); RETURN total; END IF;
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
 END LOOP;
 PERFORM set_config('app.account_deleting_tenant',coalesce(previous_delete,''),true);
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION account_delete_batch(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_delete_batch(uuid,integer) TO erp_app;

CREATE FUNCTION account_delete_finish(flow_tenant uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t tenants%ROWTYPE; members uuid[]; client record; previous_delete text := current_setting('app.account_deleting_tenant',true);
BEGIN
 SELECT * INTO t FROM tenants WHERE id=flow_tenant FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF t.account_lifecycle->>'deletionStarted' IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM account_deletion_items WHERE tenant_id=flow_tenant AND done_at IS NULL) THEN RAISE EXCEPTION 'Incomplete deletion'; END IF;
 SELECT array_agg(person_id) INTO members FROM users WHERE tenant_id=flow_tenant;
 PERFORM set_config('app.account_deleting_tenant',flow_tenant::text,true);
 DELETE FROM tenants WHERE id=flow_tenant;
 PERFORM set_config('app.account_deleting_tenant',coalesce(previous_delete,''),true);
 -- Sobrescribir la captura histórica inmediatamente: sin correos ni atribución.
 UPDATE platform_crm_events SET payload=jsonb_build_object('deleted',jsonb_build_object('nombre',t.name,'correo',NULL,'fecha_alta',t.created_at,'fecha_baja',now(),'purged',true)),generation=gen_random_uuid() WHERE tenant_id=flow_tenant;
 UPDATE job_queue SET payload=jsonb_build_object('tenantId',flow_tenant,'deleted',jsonb_build_object('nombre',t.name,'correo',NULL,'fecha_alta',t.created_at,'fecha_baja',now(),'purged',true))
 WHERE kind='platform_crm' AND payload->>'tenantId'=flow_tenant::text;
 FOR client IN SELECT r.id,r.tenant_id,r.custom_data FROM records r JOIN entities e ON e.id=r.entity_id
  WHERE e.slug='clientes' AND r.custom_data->>'origen'='flow_saas' AND r.custom_data->>'organizacion_id'=flow_tenant::text
  AND EXISTS(SELECT 1 FROM blueprint_applications a WHERE a.tenant_id=r.tenant_id AND a.idempotency_key='platform:crm:v1' AND a.undone_at IS NULL)
 LOOP
  UPDATE records SET custom_data=jsonb_build_object('nombre',t.name,'origen','flow_saas','estado','Cancelado/Eliminado','plan',client.custom_data->'plan',
   'fecha_alta',t.created_at,'fecha_baja',now(),'organizacion_id',flow_tenant::text),updated_at=now() WHERE id=client.id AND tenant_id=client.tenant_id;
  DELETE FROM record_activities WHERE tenant_id=client.tenant_id AND record_id=client.id;
 END LOOP;
 DELETE FROM people WHERE id=ANY(members) AND NOT EXISTS(SELECT 1 FROM users WHERE person_id=people.id);
 INSERT INTO account_lifecycle_events(tenant_hash,phase,reason) VALUES(encode(digest(flow_tenant::text,'sha256'),'hex'),'deleted','retention_expired');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION account_delete_finish(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_delete_finish(uuid) TO erp_app;

-- La auditoría fiscal continúa inmutable en el uso ordinario. Solo el
-- procedimiento interno de borrado de esta organización permite DELETE.
CREATE OR REPLACE FUNCTION cfdi_events_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('app.account_deleting_tenant',true)=OLD.tenant_id::text THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'cfdi_events es append-only: % no permitido',TG_OP;
END $$;
REVOKE ALL ON FUNCTION cfdi_events_append_only() FROM PUBLIC;

-- Ampliar el catálogo instalado de HU-187; conserva opciones propias.
UPDATE entity_fields f SET validation_rules=jsonb_set(f.validation_rules,'{options}',coalesce(f.validation_rules->'options','[]'::jsonb)||
 '[{"value":"Suspendido","label":"Suspendido"},{"value":"Borrado programado","label":"Borrado programado"},{"value":"Cancelado/Eliminado","label":"Cancelado/Eliminado"}]'::jsonb)
FROM entities e WHERE f.entity_id=e.id AND f.name='estado' AND e.slug='clientes'
AND EXISTS(SELECT 1 FROM blueprint_applications a WHERE a.tenant_id=e.tenant_id AND a.idempotency_key='platform:crm:v1' AND a.undone_at IS NULL);

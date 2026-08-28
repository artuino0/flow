-- Row-Level Security (HU-ERD-12): aislamiento multi-tenant a nivel de Postgres,
-- ultima barrera si un endpoint olvida filtrar por tenant_id.
-- La aplicacion debe hacer SET LOCAL app.tenant_id = '<uuid>' al inicio de cada
-- transaccion/request (Nitro), segun el tenant autenticado.

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
ALTER TABLE relation_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE relation_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE record_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_entities ON entities;
CREATE POLICY tenant_isolation_entities ON entities
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_records ON records;
CREATE POLICY tenant_isolation_records ON records
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_relation_definitions ON relation_definitions;
CREATE POLICY tenant_isolation_relation_definitions ON relation_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_record_relations ON record_relations;
CREATE POLICY tenant_isolation_record_relations ON record_relations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_roles ON roles;
CREATE POLICY tenant_isolation_roles ON roles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Actualiza el trigger de integridad de record_relations (HU-ERD-10) para que
-- tambien valide/propague tenant_id de forma consistente con relation_definitions.
CREATE OR REPLACE FUNCTION fn_validate_record_relation() RETURNS trigger AS $$
DECLARE
  v_expected_source uuid;
  v_expected_target uuid;
  v_source_entity uuid;
  v_target_entity uuid;
  v_tenant uuid;
BEGIN
  SELECT source_entity_id, target_entity_id, tenant_id
    INTO v_expected_source, v_expected_target, v_tenant
    FROM relation_definitions
    WHERE id = NEW.relation_definition_id;

  IF v_expected_source IS NULL THEN
    RAISE EXCEPTION 'relation_definition % no existe', NEW.relation_definition_id;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant;
  ELSIF NEW.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'tenant_id de record_relations no coincide con el de relation_definition';
  END IF;

  SELECT entity_id INTO v_source_entity FROM records WHERE id = NEW.source_record_id;
  IF v_source_entity IS NULL THEN
    RAISE EXCEPTION 'source_record % no existe', NEW.source_record_id;
  END IF;
  IF v_source_entity <> v_expected_source THEN
    RAISE EXCEPTION 'source_record % no es del tipo de entidad esperado por la relacion', NEW.source_record_id;
  END IF;

  SELECT entity_id INTO v_target_entity FROM records WHERE id = NEW.target_record_id;
  IF v_target_entity IS NULL THEN
    RAISE EXCEPTION 'target_record % no existe', NEW.target_record_id;
  END IF;
  IF v_target_entity <> v_expected_target THEN
    RAISE EXCEPTION 'target_record % no es del tipo de entidad esperado por la relacion', NEW.target_record_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

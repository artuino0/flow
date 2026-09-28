ALTER TABLE entity_fields ADD COLUMN is_owner_field boolean NOT NULL DEFAULT false;
ALTER TABLE role_entity_permissions ADD COLUMN visibility text NOT NULL DEFAULT 'all'
  CONSTRAINT role_entity_permissions_visibility_check CHECK (visibility IN ('all', 'own'));
ALTER TABLE records ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX records_created_by_idx ON records (tenant_id, entity_id, created_by) WHERE deleted_at IS NULL;

-- Las inserciones de cualquier origen autenticado registran al creador; los
-- procesos internos y los registros previos conservan NULL.
CREATE OR REPLACE FUNCTION app_stamp_record_creator() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actor text;
BEGIN
  actor := nullif(current_setting('app.user_id', true), '');
  IF NEW.created_by IS NULL AND actor IS NOT NULL AND actor <> '00000000-0000-0000-0000-000000000000' THEN
    NEW.created_by := actor::uuid;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stamp_record_creator BEFORE INSERT ON records
FOR EACH ROW EXECUTE FUNCTION app_stamp_record_creator();

-- SECURITY DEFINER lee el padre sin volver a disparar la política de records.
-- Solo heredan hijos con una relación declarada en detail_layout o con un
-- único vínculo en record_relations. La profundidad acotada corta ciclos.
CREATE OR REPLACE FUNCTION app_record_visible(
  p_id uuid, p_tenant uuid, p_entity uuid, p_data jsonb, p_created_by uuid, p_depth integer DEFAULT 0
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid;
  actor_role uuid;
  mode text;
  parent_field text;
  parent_slug text;
  relation_count integer;
  child_slug text;
  parent_row records%ROWTYPE;
BEGIN
  actor := nullif(current_setting('app.user_id', true), '')::uuid;
  IF actor IS NULL OR actor = '00000000-0000-0000-0000-000000000000' THEN RETURN true; END IF;
  actor_role := nullif(current_setting('app.role_id', true), '')::uuid;
  IF actor_role IS NULL OR p_depth > 8 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM roles WHERE id = actor_role AND tenant_id = p_tenant AND is_system) THEN RETURN true; END IF;
  SELECT visibility INTO mode FROM role_entity_permissions WHERE role_id = actor_role AND entity_id = p_entity;
  IF mode IS DISTINCT FROM 'own' THEN RETURN true; END IF;
  IF p_created_by = actor THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM entity_fields f WHERE f.entity_id = p_entity AND f.data_type = 'user' AND f.is_owner_field
      AND ((p_data->>f.name) = actor::text OR
        (jsonb_typeof(p_data->f.name) = 'array' AND (p_data->f.name) ? actor::text))
  ) THEN RETURN true; END IF;

  SELECT count(*), min(name), min(validation_rules->>'relationEntity')
    INTO relation_count, parent_field, parent_slug
    FROM entity_fields WHERE entity_id = p_entity AND data_type = 'relation';
  IF relation_count = 1 AND parent_slug IS NOT NULL
      AND (p_data->>parent_field) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT slug INTO child_slug FROM entities WHERE id = p_entity AND tenant_id = p_tenant;
    SELECT r.* INTO parent_row FROM records r JOIN entities e ON e.id = r.entity_id
      WHERE r.id = (p_data->>parent_field)::uuid AND r.tenant_id = p_tenant AND e.slug = parent_slug
        AND r.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(e.detail_layout->'relations', '[]'::jsonb)) link
          WHERE link->>'entitySlug' = child_slug AND link->>'fieldName' = parent_field
        );
    IF FOUND AND app_record_visible(parent_row.id, parent_row.tenant_id, parent_row.entity_id,
      parent_row.custom_data, parent_row.created_by, p_depth + 1) THEN RETURN true; END IF;
  END IF;

  SELECT count(*) INTO relation_count FROM record_relations
    WHERE tenant_id = p_tenant AND (source_record_id = p_id OR target_record_id = p_id);
  IF relation_count = 1 THEN
    SELECT r.* INTO parent_row FROM records r JOIN record_relations link
      ON r.id = CASE WHEN link.source_record_id = p_id THEN link.target_record_id ELSE link.source_record_id END
      WHERE link.tenant_id = p_tenant AND (link.source_record_id = p_id OR link.target_record_id = p_id)
        AND r.tenant_id = p_tenant AND r.deleted_at IS NULL LIMIT 1;
    IF FOUND AND app_record_visible(parent_row.id, parent_row.tenant_id, parent_row.entity_id,
      parent_row.custom_data, parent_row.created_by, p_depth + 1) THEN RETURN true; END IF;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION app_record_visible(uuid, uuid, uuid, jsonb, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_record_visible(uuid, uuid, uuid, jsonb, uuid, integer) TO erp_app;

CREATE POLICY own_records_read ON records AS RESTRICTIVE FOR SELECT TO erp_app
  USING (app_record_visible(id, tenant_id, entity_id, custom_data, created_by));
CREATE POLICY own_records_update ON records AS RESTRICTIVE FOR UPDATE TO erp_app
  USING (app_record_visible(id, tenant_id, entity_id, custom_data, created_by))
  WITH CHECK (app_record_visible(id, tenant_id, entity_id, custom_data, created_by));
CREATE POLICY own_records_delete ON records AS RESTRICTIVE FOR DELETE TO erp_app
  USING (app_record_visible(id, tenant_id, entity_id, custom_data, created_by));

-- El actor ausente nunca concede acceso a records. Solo un proceso interno
-- que fija app.record_system=on explícitamente puede consultar sin usuario.
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
  IF actor IS NULL OR actor = '00000000-0000-0000-0000-000000000000' THEN
    RETURN current_setting('app.record_system', true) = 'on';
  END IF;
  actor_role := nullif(current_setting('app.role_id', true), '')::uuid;
  IF actor_role IS NULL OR p_depth > 8 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM roles WHERE id = actor_role AND tenant_id = p_tenant AND is_system) THEN RETURN true; END IF;
  SELECT visibility INTO mode FROM role_entity_permissions WHERE role_id = actor_role AND entity_id = p_entity;
  IF mode IS DISTINCT FROM 'own' THEN RETURN true; END IF;

  SELECT slug INTO child_slug FROM entities WHERE id = p_entity AND tenant_id = p_tenant;
  SELECT count(*), min(f.name), min(f.validation_rules->>'relationEntity')
    INTO relation_count, parent_field, parent_slug
    FROM entity_fields f JOIN entities parent
      ON parent.tenant_id = p_tenant AND parent.slug = f.validation_rules->>'relationEntity'
    WHERE f.entity_id = p_entity AND f.data_type = 'relation'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(parent.detail_layout->'relations', '[]'::jsonb)) link
        WHERE link->>'entitySlug' = child_slug AND link->>'fieldName' = f.name
      );
  IF relation_count = 1 AND parent_slug IS NOT NULL
      AND (p_data->>parent_field) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT r.* INTO parent_row
      FROM records r JOIN entities e ON e.id = r.entity_id
      JOIN role_entity_permissions permission ON permission.entity_id = r.entity_id AND permission.role_id = actor_role
      WHERE r.id = (p_data->>parent_field)::uuid AND r.tenant_id = p_tenant AND e.slug = parent_slug
        AND r.deleted_at IS NULL AND permission.can_read;
    IF FOUND THEN
      RETURN app_record_visible(parent_row.id, parent_row.tenant_id, parent_row.entity_id,
        parent_row.custom_data, parent_row.created_by, p_depth + 1);
    END IF;
  END IF;

  SELECT count(*) INTO relation_count FROM record_relations
    WHERE tenant_id = p_tenant AND (source_record_id = p_id OR target_record_id = p_id);
  IF relation_count = 1 THEN
    SELECT r.* INTO parent_row FROM records r
      JOIN record_relations link ON link.source_record_id = r.id AND link.target_record_id = p_id
      JOIN relation_definitions definition ON definition.id = link.relation_definition_id
      JOIN role_entity_permissions permission ON permission.entity_id = r.entity_id AND permission.role_id = actor_role
      WHERE link.tenant_id = p_tenant AND r.tenant_id = p_tenant AND r.deleted_at IS NULL
        AND definition.source_entity_id = r.entity_id AND definition.target_entity_id = p_entity
        AND permission.can_read LIMIT 1;
    IF FOUND THEN
      RETURN app_record_visible(parent_row.id, parent_row.tenant_id, parent_row.entity_id,
        parent_row.custom_data, parent_row.created_by, p_depth + 1);
    END IF;
  END IF;

  IF p_created_by = actor THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM entity_fields f WHERE f.entity_id = p_entity AND f.data_type = 'user' AND f.is_owner_field
      AND ((p_data->>f.name) = actor::text OR
        (jsonb_typeof(p_data->f.name) = 'array' AND (p_data->f.name) ? actor::text))
  ) THEN RETURN true; END IF;
  RETURN false;
END;
$$;

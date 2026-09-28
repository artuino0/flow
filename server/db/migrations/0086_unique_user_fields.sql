-- Los perfiles de usuario pueden declarar validation_rules.unique=true.
-- El trigger corre como dueño para que un rol own no ignore duplicados ocultos por RLS.
CREATE OR REPLACE FUNCTION app_validate_unique_user_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  field_row record;
  assigned text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  FOR field_row IN
    SELECT name FROM entity_fields
    WHERE entity_id = NEW.entity_id AND data_type = 'user'
      AND validation_rules->>'unique' = 'true'
      AND coalesce(validation_rules->>'multiple', 'false') = 'false'
  LOOP
    assigned := NEW.custom_data->>field_row.name;
    IF assigned IS NULL OR assigned = '' THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.entity_id::text || ':' || field_row.name || ':' || assigned, 114));
    IF EXISTS (
      SELECT 1 FROM records existing
      WHERE existing.tenant_id = NEW.tenant_id AND existing.entity_id = NEW.entity_id
        AND existing.id <> NEW.id AND existing.deleted_at IS NULL
        AND existing.custom_data->>field_row.name = assigned
    ) THEN
      RAISE EXCEPTION 'El usuario ya tiene un perfil en este módulo' USING ERRCODE = '23505';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_unique_user_fields
BEFORE INSERT OR UPDATE OF custom_data, deleted_at ON records
FOR EACH ROW EXECUTE FUNCTION app_validate_unique_user_fields();

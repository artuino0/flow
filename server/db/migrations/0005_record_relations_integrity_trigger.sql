-- Integridad referencial de record_relations (HU-ERD-10): valida que el record
-- vinculado exista y sea del tipo de entidad esperado por su relation_definition.
-- La validacion de campos NO vive aqui (vive en Zod, Nitro) - ver seccion 3.1 del
-- documento de arquitectura.
CREATE OR REPLACE FUNCTION fn_validate_record_relation() RETURNS trigger AS $$
DECLARE
  v_expected_source uuid;
  v_expected_target uuid;
  v_source_entity uuid;
  v_target_entity uuid;
BEGIN
  SELECT source_entity_id, target_entity_id
    INTO v_expected_source, v_expected_target
    FROM relation_definitions
    WHERE id = NEW.relation_definition_id;

  IF v_expected_source IS NULL THEN
    RAISE EXCEPTION 'relation_definition % no existe', NEW.relation_definition_id;
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

DROP TRIGGER IF EXISTS trg_validate_record_relation ON record_relations;
CREATE TRIGGER trg_validate_record_relation
BEFORE INSERT OR UPDATE ON record_relations
FOR EACH ROW
EXECUTE FUNCTION fn_validate_record_relation();

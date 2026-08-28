-- Snapshot automatico en entity_field_history cada vez que cambia data_type,
-- validation_rules o is_required de un entity_field (HU-ERD-8).
CREATE OR REPLACE FUNCTION fn_entity_fields_history() RETURNS trigger AS $$
BEGIN
  IF (OLD.data_type IS DISTINCT FROM NEW.data_type)
     OR (OLD.validation_rules IS DISTINCT FROM NEW.validation_rules)
     OR (OLD.is_required IS DISTINCT FROM NEW.is_required) THEN
    INSERT INTO entity_field_history (entity_field_id, data_type, validation_rules, is_required, changed_at)
    VALUES (OLD.id, OLD.data_type, OLD.validation_rules, OLD.is_required, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entity_fields_history ON entity_fields;
CREATE TRIGGER trg_entity_fields_history
BEFORE UPDATE ON entity_fields
FOR EACH ROW
EXECUTE FUNCTION fn_entity_fields_history();

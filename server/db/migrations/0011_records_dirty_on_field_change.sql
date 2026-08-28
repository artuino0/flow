-- HU-ERD-18: revalidacion perezosa. Cuando cambian los metadatos de un campo
-- (entity_fields) se marcan is_dirty = true todos los records de esa entidad,
-- sin revalidar nada de inmediato (eso ocurre bajo demanda en el proximo
-- acceso/edicion, ver server/api/records/[entity]/[id].get.ts y .put.ts).
CREATE OR REPLACE FUNCTION fn_mark_records_dirty_on_field_change()
RETURNS trigger AS $$
DECLARE
  target_entity_id uuid;
BEGIN
  target_entity_id := COALESCE(NEW.entity_id, OLD.entity_id);
  UPDATE records SET is_dirty = true WHERE entity_id = target_entity_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Nuevo campo: cambia la forma esperada de custom_data para la entidad.
CREATE TRIGGER trg_records_dirty_on_field_insert
AFTER INSERT ON entity_fields
FOR EACH ROW
EXECUTE FUNCTION fn_mark_records_dirty_on_field_change();
--> statement-breakpoint
-- Cambio de tipo/reglas/requerido/nombre: invalida el schema Zod cacheado (ERD-17).
CREATE TRIGGER trg_records_dirty_on_field_update
AFTER UPDATE ON entity_fields
FOR EACH ROW
WHEN (
  OLD.data_type IS DISTINCT FROM NEW.data_type OR
  OLD.validation_rules IS DISTINCT FROM NEW.validation_rules OR
  OLD.is_required IS DISTINCT FROM NEW.is_required OR
  OLD.name IS DISTINCT FROM NEW.name
)
EXECUTE FUNCTION fn_mark_records_dirty_on_field_change();
--> statement-breakpoint
-- Campo eliminado: la forma esperada tambien cambio.
CREATE TRIGGER trg_records_dirty_on_field_delete
AFTER DELETE ON entity_fields
FOR EACH ROW
EXECUTE FUNCTION fn_mark_records_dirty_on_field_change();

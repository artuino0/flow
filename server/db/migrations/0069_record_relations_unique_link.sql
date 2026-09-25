-- Evita vinculos duplicados entre dos registros para la misma definicion.
-- Verificado antes de crear: no existian duplicados en record_relations.
CREATE UNIQUE INDEX IF NOT EXISTS "record_relations_unique_link"
  ON "record_relations" ("relation_definition_id", "source_record_id", "target_record_id");

-- Listados por organización y módulo (el caso de todas las pantallas de registros):
-- el índice compuesto sirve el orden por fecha de creación y el conteo sin
-- recorrer las filas de otros módulos de la misma organización. Medido con una
-- organización de 100 mil registros (16 mil en el módulo): la consulta de la página
-- baja de ~10 ms a ~0.3 ms y el conteo de ~13 ms a ~4 ms.
--
-- OJO en producción con tablas grandes: CREATE INDEX bloquea las escrituras de
-- `records` mientras se construye (segundos con millones de filas). Para evitarlo,
-- créalo a mano con CREATE INDEX CONCURRENTLY antes de aplicar la migración.
CREATE INDEX IF NOT EXISTS "records_tenant_entity_created_idx"
  ON "records" ("tenant_id", "entity_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

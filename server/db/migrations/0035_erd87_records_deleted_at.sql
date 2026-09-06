-- ERD-87: borrado logico de records.
-- deleted_at nulo = registro activo (comportamiento identico al de siempre).
-- deleted_at con fecha = "eliminado" sin haber borrado la fila fisica -
-- necesario para que el Diseñador de reportes imprimibles (ERD-88) pueda
-- incluir registros eliminados como filas atenuadas junto a los activos.
ALTER TABLE "records" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "records_deleted_at_idx" ON "records" USING btree ("deleted_at");

-- ERD-87: cursor global del ETL y lectura incremental indexada.
CREATE TABLE olap_etl_state (
  job text PRIMARY KEY,
  last_updated_at timestamptz NOT NULL,
  last_record_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON olap_etl_state TO erp_app;

-- En producción con tablas grandes, crear primero con CREATE INDEX CONCURRENTLY
-- para evitar bloquear escrituras; IF NOT EXISTS evita duplicar ese índice.
CREATE INDEX IF NOT EXISTS records_updated_at_id_idx ON records (updated_at, id);

-- SECURITY DEFINER usa el dueño de records/entities para una lectura global
-- ordenada. Solo expone los campos requeridos por el ETL; el rol erp_app sigue
-- sujeto a RLS en consultas directas a ambas tablas.
ALTER TABLE records NO FORCE ROW LEVEL SECURITY;
ALTER TABLE entities NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION olap_changed_records(p_after_ts timestamptz, p_after_id uuid, p_until timestamptz, p_limit integer)
RETURNS TABLE (id uuid, tenant_id uuid, entity_id uuid, entity_slug text, custom_data jsonb, created_at timestamptz, updated_at timestamptz, updated_at_cursor text, is_deleted boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.tenant_id, r.entity_id, e.slug, r.custom_data, r.created_at, r.updated_at, r.updated_at::text, (r.deleted_at IS NOT NULL)
  FROM records r
  JOIN entities e ON e.id = r.entity_id
  WHERE (r.updated_at, r.id) > (p_after_ts, p_after_id)
    AND r.updated_at <= p_until
  ORDER BY r.updated_at, r.id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION olap_changed_records(timestamptz, uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION olap_changed_records(timestamptz, uuid, timestamptz, integer) TO erp_app;

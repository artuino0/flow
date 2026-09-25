-- Toma de lotes rápida bajo RLS. Con la política de aislamiento (que compara con
-- current_setting) Postgres subestima la selectividad y recorre toda la cola
-- (~290 ms con 300 mil pendientes) en vez de usar el índice (~4 ms). La función
-- corre con los privilegios del dueño de la tabla (SECURITY DEFINER) y solo hace
-- esa operación: tomar un lote reparto-justo y marcarlo "processing".
--
-- FORCE se quita para que el dueño (quien crea la función) no quede sujeto a RLS;
-- el rol de la aplicación (erp_app) sigue sujeto a la política como siempre.
ALTER TABLE "job_queue" NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION claim_job_batch(p_batch integer, p_per_tenant integer, p_worker text, p_now timestamptz)
RETURNS TABLE (id uuid, tenant_id uuid, kind text, payload jsonb, attempts integer, max_attempts integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH due AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE EXISTS (
      SELECT 1 FROM job_queue q
      WHERE q.tenant_id = t.id AND q.status = 'pending' AND q.run_at <= p_now
    )
    ORDER BY random()
    LIMIT p_batch
  ), candidates AS (
    SELECT c.id, c.run_at
    FROM due d
    CROSS JOIN LATERAL (
      SELECT q.id, q.run_at FROM job_queue q
      WHERE q.tenant_id = d.tenant_id AND q.status = 'pending' AND q.run_at <= p_now
      ORDER BY q.run_at
      LIMIT p_per_tenant
      FOR UPDATE OF q SKIP LOCKED
    ) c
  ), picked AS (
    SELECT candidates.id FROM candidates ORDER BY candidates.run_at LIMIT p_batch
  )
  UPDATE job_queue j
  SET status = 'processing', locked_at = p_now, locked_by = p_worker, attempts = j.attempts + 1, updated_at = p_now
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.id, j.tenant_id, j.kind, j.payload, j.attempts, j.max_attempts;
$$;

REVOKE ALL ON FUNCTION claim_job_batch(integer, integer, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job_batch(integer, integer, text, timestamptz) TO erp_app;

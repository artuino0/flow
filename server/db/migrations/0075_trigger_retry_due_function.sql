CREATE INDEX IF NOT EXISTS trigger_logs_retrying_updated_idx ON trigger_logs (updated_at) WHERE status = 'retrying';

-- FORCE se quita para que el dueño de la tabla (quien crea la función con SECURITY DEFINER) 
-- no quede sujeto a RLS al calcular los reintentos vencidos de forma masiva en una sola 
-- pasada. El rol de la aplicación (erp_app) que se conecta a la base seguirá sujeto a 
-- RLS para las consultas directas a trigger_logs.
ALTER TABLE trigger_logs NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION due_trigger_retries(p_now timestamptz, p_limit integer)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id
  FROM trigger_logs
  WHERE status = 'retrying'
    AND updated_at + (power(2, attempt_count) * interval '1 minute') <= p_now
  ORDER BY updated_at
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION due_trigger_retries(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION due_trigger_retries(timestamptz, integer) TO erp_app;

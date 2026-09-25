-- Cola de trabajos en Postgres (correos y, más adelante, programaciones): los
-- envíos ya no se hacen dentro de la petición o del disparador; se encolan y un
-- proceso los toma con FOR UPDATE SKIP LOCKED, con reintentos con retroceso,
-- reparto justo entre organizaciones y un ritmo máximo por segundo.
CREATE TABLE IF NOT EXISTS "job_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 6,
  "run_at" timestamp with time zone NOT NULL DEFAULT now(),
  "locked_at" timestamp with time zone,
  "locked_by" text,
  "last_error" text,
  "idempotency_key" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "job_queue_status_check" CHECK ("status" IN ('pending', 'processing', 'succeeded', 'dead'))
);

-- Búsqueda de trabajos listos: solo las filas pendientes.
CREATE INDEX IF NOT EXISTS "job_queue_ready_idx" ON "job_queue" ("run_at") WHERE "status" = 'pending';
-- Recuperación de trabajos atascados (proceso caído a media ejecución).
CREATE INDEX IF NOT EXISTS "job_queue_processing_idx" ON "job_queue" ("locked_at") WHERE "status" = 'processing';
CREATE INDEX IF NOT EXISTS "job_queue_tenant_idx" ON "job_queue" ("tenant_id", "kind", "created_at" DESC);
-- Un mismo trabajo lógico (p. ej. el recordatorio de una cita) no se encola dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS "job_queue_idempotency_unique" ON "job_queue" ("tenant_id", "kind", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "job_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_queue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_job_queue ON "job_queue";
-- Cada organización solo ve sus trabajos; el proceso de la cola (que trabaja para
-- todas) se identifica con app.job_worker = 'on', que solo fija withJobWorker().
CREATE POLICY tenant_isolation_job_queue ON "job_queue"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.job_worker', true) = 'on')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.job_worker', true) = 'on');

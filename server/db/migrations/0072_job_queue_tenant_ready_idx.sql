-- Toma de lotes en tiempo constante: el proceso de la cola busca, por organización,
-- sus trabajos listos con este índice (organización + hora), sin recorrer toda la cola.
CREATE INDEX IF NOT EXISTS "job_queue_tenant_ready_idx" ON "job_queue" ("tenant_id", "run_at") WHERE "status" = 'pending';
DROP INDEX IF EXISTS "job_queue_ready_idx";

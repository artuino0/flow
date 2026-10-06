CREATE TABLE pending_registrations (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK(email=lower(trim(email))),
 full_name text NOT NULL, password_hash text NOT NULL,
 intent jsonb, challenge_hash text NOT NULL UNIQUE CHECK(challenge_hash ~ '^[a-f0-9]{64}$'),
 code_hash text NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'), code_expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), emissions jsonb NOT NULL,
 verified_at timestamptz, witness_hash text UNIQUE CHECK(witness_hash ~ '^[a-f0-9]{64}$'), witness_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX pending_registrations_expiry_idx ON pending_registrations(expires_at);
CREATE TABLE registration_receipts (
 witness_hash text PRIMARY KEY CHECK(witness_hash ~ '^[a-f0-9]{64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL, expires_at timestamptz NOT NULL
);
REVOKE ALL ON pending_registrations, registration_receipts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON pending_registrations, registration_receipts TO erp_app;

ALTER TABLE job_queue ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE job_queue ADD CONSTRAINT job_queue_platform_scope CHECK (
 tenant_id IS NOT NULL OR (kind='email' AND payload->>'platform'='true' AND payload->>'purpose'='registration')
);
-- El alcance provisional habilita solamente sus filas sin tenant. No amplía
-- la política de ninguna organización ni permite leer otras filas de la cola.
CREATE POLICY provisional_outbox ON job_queue
 USING (tenant_id IS NULL AND payload->>'pendingRegistrationId'=current_setting('app.pending_registration_id',true))
 WITH CHECK (tenant_id IS NULL AND kind='email' AND payload->>'platform'='true'
  AND payload->>'purpose'='registration' AND payload->>'pendingRegistrationId'=current_setting('app.pending_registration_id',true));
CREATE INDEX job_queue_platform_ready_idx ON job_queue(run_at) WHERE tenant_id IS NULL AND status='pending';

CREATE OR REPLACE FUNCTION claim_job_batch(p_batch integer, p_per_tenant integer, p_worker text, p_now timestamptz)
RETURNS TABLE(id uuid, tenant_id uuid, kind text, payload jsonb, attempts integer, max_attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH scopes AS (
  SELECT t.id AS tenant_id FROM tenants t WHERE EXISTS
   (SELECT 1 FROM job_queue q WHERE q.tenant_id=t.id AND q.status='pending' AND q.run_at<=p_now)
  UNION ALL SELECT NULL::uuid WHERE EXISTS
   (SELECT 1 FROM job_queue q WHERE q.tenant_id IS NULL AND q.status='pending' AND q.run_at<=p_now)
 ), due AS (SELECT tenant_id FROM scopes ORDER BY random() LIMIT p_batch), candidates AS (
  SELECT c.id,c.run_at FROM due d CROSS JOIN LATERAL (
   SELECT q.id,q.run_at FROM job_queue q
   WHERE q.tenant_id = d.tenant_id AND q.status='pending' AND q.run_at<=p_now
   ORDER BY q.run_at LIMIT p_per_tenant FOR UPDATE OF q SKIP LOCKED
  ) c
  UNION ALL
  SELECT c.id,c.run_at FROM due d CROSS JOIN LATERAL (
   SELECT q.id,q.run_at FROM job_queue q
   WHERE d.tenant_id IS NULL AND q.tenant_id IS NULL AND q.status='pending' AND q.run_at<=p_now
   ORDER BY q.run_at LIMIT p_per_tenant FOR UPDATE OF q SKIP LOCKED
  ) c
 ), picked AS (SELECT candidates.id FROM candidates ORDER BY candidates.run_at LIMIT p_batch)
 UPDATE job_queue j SET status='processing',locked_at=p_now,locked_by=p_worker,attempts=j.attempts+1,updated_at=p_now
 FROM picked WHERE j.id=picked.id RETURNING j.id,j.tenant_id,j.kind,j.payload,j.attempts,j.max_attempts;
$$;
REVOKE ALL ON FUNCTION claim_job_batch(integer,integer,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job_batch(integer,integer,text,timestamptz) TO erp_app;

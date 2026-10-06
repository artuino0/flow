ALTER TABLE email_verification_tokens ADD COLUMN code_hash text
 CHECK (code_hash IS NULL OR code_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE email_verification_tokens ADD COLUMN code_expires_at timestamptz;
ALTER TABLE email_verification_tokens ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5);
ALTER TABLE job_queue ADD COLUMN delivery_provider text;
ALTER TABLE job_queue ADD COLUMN delivery_id text;
ALTER TABLE job_queue ADD COLUMN delivery_started_at timestamptz;
ALTER TABLE cfdi_events DROP CONSTRAINT cfdi_events_tipo_check;
ALTER TABLE cfdi_events ADD CONSTRAINT cfdi_events_tipo_check CHECK (tipo IN
 ('folio_asignado','intento_timbrado','timbrado_ok','error_pac','verificacion_getstatus','cancelacion_solicitada','cancelacion_confirmada','email_enviado','email_encolado'));

-- Mismo contador persistente de HU-190, global para entradas sin tenant (registro).
CREATE TABLE auth_security_buckets (
 key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
 attempts integer NOT NULL CHECK (attempts > 0), expires_at timestamptz NOT NULL
);
CREATE INDEX auth_security_expiry_idx ON auth_security_buckets(expires_at);
REVOKE ALL ON auth_security_buckets FROM PUBLIC, erp_app;
CREATE FUNCTION consume_auth_security_bucket(bucket text, seconds integer) RETURNS TABLE(attempts integer, expires_at timestamptz)
 LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO auth_security_buckets AS b(key_hash,attempts,expires_at)
 VALUES(bucket,1,now()+make_interval(secs=>greatest(1,least(seconds,86400))))
 ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN b.expires_at<=now() THEN 1 ELSE least(b.attempts+1,1000000) END,
 expires_at=CASE WHEN b.expires_at<=now() THEN excluded.expires_at ELSE b.expires_at END
 RETURNING attempts,expires_at;
$$;
REVOKE ALL ON FUNCTION consume_auth_security_bucket(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_auth_security_bucket(text,integer) TO erp_app;
CREATE FUNCTION purge_auth_security_buckets() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM auth_security_buckets WHERE key_hash IN
 (SELECT key_hash FROM auth_security_buckets WHERE expires_at<=now() ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;
REVOKE ALL ON FUNCTION purge_auth_security_buckets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_auth_security_buckets() TO erp_app;

-- HU-191 no está en esta base. Solo altas vacías, sin contratación ni módulos.
-- Aislada y de activación explícita; nunca borra cuentas con datos de negocio.
CREATE FUNCTION purge_pending_registrations(retention_days integer) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE candidate record; locked_tenant uuid; person_ids uuid[]; removed integer:=0;
BEGIN
 DELETE FROM auth_security_buckets WHERE key_hash IN
 (SELECT key_hash FROM auth_security_buckets WHERE expires_at<=now() ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED);
 FOR candidate IN
  SELECT t.id, p.id AS person_id FROM tenants t JOIN people p ON p.email=t.email
  WHERE t.onboarding_status='email_pending' AND p.email_verified_at IS NULL
   AND t.created_at < now()-make_interval(days=>greatest(1,least(retention_days,365)))
   AND NOT EXISTS(SELECT 1 FROM entities e WHERE e.tenant_id=t.id)
   AND NOT EXISTS(SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id=t.id)
  ORDER BY t.created_at LIMIT 25 FOR UPDATE OF p SKIP LOCKED
 LOOP
  locked_tenant:=NULL;
  SELECT id INTO locked_tenant FROM tenants WHERE id=candidate.id AND onboarding_status='email_pending' FOR UPDATE SKIP LOCKED;
  IF locked_tenant IS NULL THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM entities WHERE tenant_id=locked_tenant) OR EXISTS(SELECT 1 FROM tenant_subscriptions WHERE tenant_id=locked_tenant) THEN CONTINUE; END IF;
  SELECT array_agg(person_id) INTO person_ids FROM users WHERE tenant_id=locked_tenant;
  DELETE FROM users WHERE tenant_id=locked_tenant;
  DELETE FROM roles WHERE tenant_id=locked_tenant;
  DELETE FROM tenants WHERE id=locked_tenant;
  DELETE FROM people p WHERE p.id=ANY(person_ids)
   AND (p.email_verified_at IS NULL OR p.password_hash LIKE '!invited:%')
   AND NOT EXISTS(SELECT 1 FROM users u WHERE u.person_id=p.id);
  removed:=removed+1;
 END LOOP;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION purge_pending_registrations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_pending_registrations(integer) TO erp_app;

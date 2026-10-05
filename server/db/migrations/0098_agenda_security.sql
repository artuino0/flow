CREATE TABLE agenda_security_buckets (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
 attempts integer NOT NULL CHECK (attempts > 0), expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,key_hash)
);
CREATE INDEX agenda_security_expiry_idx ON agenda_security_buckets(expires_at);
ALTER TABLE agenda_security_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_security_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agenda_security_buckets ON agenda_security_buckets
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON agenda_security_buckets TO erp_app;

ALTER TABLE agenda_public_bookings ADD COLUMN confirmation_hash text UNIQUE
 CHECK (confirmation_hash IS NULL OR confirmation_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE agenda_public_bookings ADD COLUMN confirmation_expires_at timestamptz;
ALTER TABLE agenda_public_bookings ADD COLUMN confirmation_state text NOT NULL DEFAULT 'none'
 CHECK (confirmation_state IN ('none','pending','confirmed','expired'));
CREATE INDEX agenda_confirmation_expiry_idx ON agenda_public_bookings(confirmation_expires_at) WHERE confirmation_state='pending';

-- Limpieza acotada del cron de cola existente; únicamente datos vencidos.
CREATE FUNCTION purge_agenda_security_buckets(at_time timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM agenda_security_buckets WHERE (tenant_id,key_hash) IN
 (SELECT tenant_id,key_hash FROM agenda_security_buckets WHERE expires_at<=at_time ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION purge_agenda_security_buckets(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_agenda_security_buckets(timestamptz) TO erp_app;

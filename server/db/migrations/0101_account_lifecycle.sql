CREATE TABLE account_lifecycle_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 policy jsonb NOT NULL DEFAULT '{"graceDays":7,"retentionDays":180,"warningDays":[30,7,1]}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO account_lifecycle_settings(id) VALUES(true);
REVOKE ALL ON account_lifecycle_settings FROM PUBLIC, erp_app;
GRANT SELECT, UPDATE ON account_lifecycle_settings TO erp_app;
ALTER TABLE tenants ADD COLUMN account_lifecycle jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION account_lifecycle_state(flow_tenant uuid, flow_now timestamptz, flow_platform_slug text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t tenants%ROWTYPE; s tenant_subscriptions%ROWTYPE; policy jsonb; data jsonb;
 plan_key text; due_at timestamptz; suspend_at timestamptz; delete_at timestamptz; reason text; phase text;
BEGIN
 SELECT * INTO t FROM tenants WHERE id=flow_tenant;
 IF NOT FOUND THEN RETURN jsonb_build_object('phase','suspended','reason','deleted'); END IF;
 SELECT * INTO s FROM tenant_subscriptions WHERE tenant_id=flow_tenant;
 SELECT key INTO plan_key FROM plans WHERE id=s.plan_id;
 SELECT g.policy || coalesce(t.account_lifecycle->'policy','{}'::jsonb) INTO policy FROM account_lifecycle_settings g WHERE id=true;
 data := t.account_lifecycle;
 IF coalesce((data->>'deletionStarted')::boolean,false) THEN
  RETURN jsonb_build_object('phase','pending_deletion','exempt',false,'policy',policy,'reason','deletion_started','suspendAt',data->>'suspendedAt','deleteAt',data->>'deletionScheduledAt');
 END IF;
 IF s.provider='manual' OR plan_key='empresarial' OR (flow_platform_slug<>'' AND t.slug=flow_platform_slug) OR coalesce((data->>'exempt')::boolean,false) THEN
  RETURN jsonb_build_object('phase','active','exempt',true,'policy',policy);
 END IF;
 IF data->>'manualSuspendedAt' IS NOT NULL THEN
  suspend_at := (data->>'manualSuspendedAt')::timestamptz; reason := 'manual';
 ELSIF s.status IN ('past_due','unpaid','incomplete_expired','paused') THEN
  due_at := coalesce((data->>'paymentDueAt')::timestamptz,s.updated_at);
  suspend_at := due_at + (policy->>'graceDays')::int * interval '1 day'; reason := 'payment_due';
 ELSIF s.status='canceled' OR (s.cancel_at_period_end AND s.current_period_end<=flow_now) THEN
  suspend_at := coalesce(s.current_period_end,s.updated_at); reason := 'canceled';
 ELSIF s.status='trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at<=flow_now THEN
  suspend_at := s.trial_ends_at; reason := 'trial_ended';
 ELSIF s.status='incomplete' THEN
  due_at := coalesce((data->>'paymentDueAt')::timestamptz,s.updated_at);
  suspend_at := due_at + (policy->>'graceDays')::int * interval '1 day'; reason := 'payment_due';
 END IF;
 IF suspend_at IS NULL THEN RETURN jsonb_build_object('phase','active','exempt',false,'policy',policy); END IF;
 delete_at := coalesce((data->>'retentionUntil')::timestamptz,suspend_at + (policy->>'retentionDays')::int * interval '1 day');
 IF flow_now<suspend_at THEN phase := CASE WHEN due_at IS NOT NULL THEN 'payment_due' ELSE 'active' END;
 ELSE
  phase := 'suspended';
  IF flow_now>=delete_at - (SELECT max(value::int) FROM jsonb_array_elements_text(policy->'warningDays')) * interval '1 day' THEN phase := 'pending_deletion'; END IF;
 END IF;
 RETURN jsonb_build_object('phase',phase,'paymentDueAt',due_at,'suspendAt',suspend_at,'deleteAt',delete_at,'reason',reason,'policy',policy,'exempt',false);
END $$;

CREATE OR REPLACE FUNCTION public_site_account(flow_host text,flow_now timestamptz,flow_platform_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT account_lifecycle_state(d.tenant_id,flow_now,flow_platform_slug) FROM site_domains d
 WHERE d.hostname=flow_host AND d.status='active' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public_site_account(text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_site_account(text,timestamptz,text) TO erp_app;

DROP FUNCTION claim_job_batch(integer,integer,text,timestamptz);
CREATE FUNCTION claim_job_batch(p_batch integer,p_per_tenant integer,p_worker text,p_now timestamptz,p_platform text DEFAULT '')
RETURNS TABLE(id uuid,tenant_id uuid,kind text,payload jsonb,attempts integer,max_attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH scopes AS (
  SELECT t.id AS tenant_id FROM tenants t WHERE EXISTS(
   SELECT 1 FROM job_queue q WHERE q.tenant_id=t.id AND q.status='pending' AND q.run_at<=p_now
   AND (q.kind IN ('account_notice','account_export') OR account_lifecycle_state(t.id,p_now,p_platform)->>'phase' IN ('active','payment_due'))
  )
  UNION ALL SELECT NULL::uuid WHERE EXISTS(
   SELECT 1 FROM job_queue q WHERE q.tenant_id IS NULL AND q.status='pending' AND q.run_at<=p_now
  )
 ), due AS (SELECT tenant_id FROM scopes ORDER BY random() LIMIT p_batch), candidates AS (
  SELECT c.id,c.run_at FROM due d CROSS JOIN LATERAL(
   SELECT q.id,q.run_at FROM job_queue q WHERE q.tenant_id=d.tenant_id AND q.status='pending' AND q.run_at<=p_now
   AND (q.kind IN ('account_notice','account_export') OR account_lifecycle_state(d.tenant_id,p_now,p_platform)->>'phase' IN ('active','payment_due'))
   ORDER BY q.run_at LIMIT p_per_tenant FOR UPDATE OF q SKIP LOCKED
  ) c
  UNION ALL
  SELECT c.id,c.run_at FROM due d CROSS JOIN LATERAL(
   SELECT q.id,q.run_at FROM job_queue q WHERE d.tenant_id IS NULL AND q.tenant_id IS NULL AND q.status='pending' AND q.run_at<=p_now
   ORDER BY q.run_at LIMIT p_per_tenant FOR UPDATE OF q SKIP LOCKED
  ) c
 ), picked AS(SELECT candidates.id FROM candidates ORDER BY candidates.run_at LIMIT p_batch)
 UPDATE job_queue j SET status='processing',locked_at=p_now,locked_by=p_worker,attempts=j.attempts+1,updated_at=p_now
 FROM picked WHERE j.id=picked.id RETURNING j.id,j.tenant_id,j.kind,j.payload,j.attempts,j.max_attempts
$$;
REVOKE ALL ON FUNCTION claim_job_batch(integer,integer,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job_batch(integer,integer,text,timestamptz,text) TO erp_app;
REVOKE ALL ON FUNCTION account_lifecycle_state(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_lifecycle_state(uuid,timestamptz,text) TO erp_app;

CREATE OR REPLACE FUNCTION capture_account_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('past_due','unpaid','incomplete','incomplete_expired','paused') THEN
  UPDATE tenants SET account_lifecycle=jsonb_set(account_lifecycle,'{paymentDueAt}',
   coalesce(account_lifecycle->'paymentDueAt',to_jsonb(now())),true) WHERE id=NEW.tenant_id;
 ELSIF NEW.status IN ('active','trialing') THEN
  UPDATE tenants SET account_lifecycle=account_lifecycle-'paymentDueAt'-'suspendedAt'-'deletionScheduledAt'-'reason'-'manualSuspendedAt'-'deletionHoldReason'-'deletionRetryAt'
  WHERE id=NEW.tenant_id AND NOT coalesce((account_lifecycle->>'deletionStarted')::boolean,false);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION capture_account_subscription() FROM PUBLIC;
CREATE TRIGGER account_subscription_changed AFTER INSERT OR UPDATE OF status ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION capture_account_subscription();

CREATE TABLE account_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 cycle text NOT NULL, kind text NOT NULL, recipient_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
 job_id uuid, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,cycle,kind,recipient_id)
);
ALTER TABLE account_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY account_notices_tenant ON account_notices USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON account_notices TO erp_app;

CREATE TABLE account_lifecycle_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_hash text NOT NULL CHECK(length(tenant_hash)=64),
 phase text NOT NULL, reason text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON account_lifecycle_events FROM PUBLIC;
GRANT SELECT,INSERT ON account_lifecycle_events TO erp_app;

DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT conrelid::regclass AS relation,conname FROM pg_constraint
  WHERE contype='f' AND confrelid='tenants'::regclass AND conrelid IN
  ('agenda_public_bookings'::regclass,'agenda_schedules'::regclass,'agenda_settings'::regclass,'agenda_site_settings'::regclass,'agenda_time_off'::regclass,'agent_usage'::regclass) AND confdeltype<>'c'
 LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.relation,item.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',item.relation,item.conname);
 END LOOP;
END $$;

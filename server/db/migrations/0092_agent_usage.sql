-- ERD-138: solo conteos, nunca mensajes ni respuestas.
INSERT INTO plan_limits (plan_id, concept, value)
SELECT p.id, v.concept, CASE p.key WHEN 'agenda' THEN v.agenda WHEN 'starter' THEN v.starter WHEN 'crecimiento' THEN v.crecimiento WHEN 'escala' THEN v.escala END
FROM plans p CROSS JOIN (VALUES ('agentQueries',30,100,300,1000),('agentUserDaily',10,20,30,50)) v(concept,agenda,starter,crecimiento,escala)
WHERE p.key IN ('agenda','starter','crecimiento','escala') ON CONFLICT (plan_id,concept) DO NOTHING;
CREATE TABLE agent_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), day date NOT NULL,
 ai_calls integer NOT NULL DEFAULT 0 CHECK(ai_calls >= 0), tokens_in bigint NOT NULL DEFAULT 0, tokens_out bigint NOT NULL DEFAULT 0,
 catalog_calls integer NOT NULL DEFAULT 0, offtopic_calls integer NOT NULL DEFAULT 0,
 limited_calls integer NOT NULL DEFAULT 0, unavailable_calls integer NOT NULL DEFAULT 0,
 messages_total integer NOT NULL DEFAULT 0, actions jsonb NOT NULL DEFAULT '{"navigate":0,"point":0,"start-tour":0}',
 last_used_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,day)
);
CREATE INDEX agent_usage_month_idx ON agent_usage(tenant_id,day);
ALTER TABLE agent_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_usage_read ON agent_usage FOR SELECT USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY agent_usage_insert ON agent_usage FOR INSERT WITH CHECK (
 tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id = nullif(current_setting('app.user_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM users u WHERE u.id = agent_usage.user_id AND u.tenant_id = agent_usage.tenant_id));
CREATE POLICY agent_usage_update ON agent_usage FOR UPDATE USING (
 tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id = nullif(current_setting('app.user_id',true),'')::uuid
) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id = nullif(current_setting('app.user_id',true),'')::uuid);

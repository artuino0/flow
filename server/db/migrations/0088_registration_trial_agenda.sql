ALTER TABLE people ADD COLUMN email_verified_at timestamptz DEFAULT now();
UPDATE people SET email_verified_at = now() WHERE email_verified_at IS NULL;

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_person_created_idx ON email_verification_tokens(person_id, created_at DESC);

ALTER TABLE tenants ADD COLUMN onboarding_status text NOT NULL DEFAULT 'complete'
  CONSTRAINT tenants_onboarding_status_check CHECK (onboarding_status IN ('email_pending', 'plan_pending', 'checkout_pending', 'complete'));
ALTER TABLE tenants ADD COLUMN trial_consumed_at timestamptz;
UPDATE tenants SET trial_consumed_at = coalesce(s.created_at, now())
FROM tenant_subscriptions s WHERE s.tenant_id = tenants.id AND s.provider = 'stripe';

ALTER TABLE entities ADD COLUMN template_key text;
CREATE INDEX entities_tenant_template_idx ON entities(tenant_id, template_key) WHERE template_key IS NOT NULL;

UPDATE plan_limits SET value = 2 WHERE plan_id = (SELECT id FROM plans WHERE key = 'agenda') AND concept = 'modules';
INSERT INTO plan_limits (plan_id, concept, value)
SELECT id, 'aiCredits', 5 FROM plans WHERE key = 'agenda'
ON CONFLICT (plan_id, concept) DO UPDATE SET value = EXCLUDED.value;
UPDATE plans SET description = 'Agenda con plantilla incluida, 2 módulos propios y 5 créditos de IA al mes.', updated_at = now()
WHERE key = 'agenda';

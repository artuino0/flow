-- Correo saliente con Amazon SES por organización (SES Tenant Management):
-- cada organización tiene su tenant, su configuration set y su dominio
-- verificado, de modo que la reputación y una posible pausa quedan aisladas.
ALTER TABLE "tenant_email_settings"
  ADD COLUMN IF NOT EXISTS "ses_tenant_name" text,
  ADD COLUMN IF NOT EXISTS "ses_config_set" text,
  ADD COLUMN IF NOT EXISTS "sending_domain" text,
  ADD COLUMN IF NOT EXISTS "domain_status" text,
  ADD COLUMN IF NOT EXISTS "dkim_tokens" jsonb,
  ADD COLUMN IF NOT EXISTS "sending_status" text,
  ADD COLUMN IF NOT EXISTS "status_checked_at" timestamp with time zone;

-- Un dominio pertenece a una sola organización: la identidad de SES es única en
-- la cuenta, y sin esto otra organización podría "adoptar" un dominio ajeno.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_email_settings_sending_domain_unique"
  ON "tenant_email_settings" (lower("sending_domain"))
  WHERE "sending_domain" IS NOT NULL;

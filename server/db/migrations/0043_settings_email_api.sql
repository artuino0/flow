-- Ajustes: perfil, correo saliente y API keys personales.
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "job_title" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text;

CREATE TABLE IF NOT EXISTS "tenant_email_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "provider" text DEFAULT 'smtp' NOT NULL,
  "host" text,
  "port" integer,
  "security" text DEFAULT 'tls' NOT NULL,
  "username" text,
  "password_encrypted" text,
  "api_key_encrypted" text,
  "from_email" text NOT NULL,
  "from_name" text,
  "reply_to" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_email_settings_tenant_unique" ON "tenant_email_settings" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_email_settings_tenant_idx" ON "tenant_email_settings" ("tenant_id");

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "token_hash" text NOT NULL,
  "scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_token_hash_unique" ON "api_keys" ("token_hash");
CREATE INDEX IF NOT EXISTS "api_keys_tenant_idx" ON "api_keys" ("tenant_id");
CREATE INDEX IF NOT EXISTS "api_keys_owner_idx" ON "api_keys" ("owner_user_id");

ALTER TABLE "tenant_email_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_email_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_email_settings ON "tenant_email_settings";
CREATE POLICY tenant_isolation_tenant_email_settings ON "tenant_email_settings"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_api_keys ON "api_keys";
CREATE POLICY tenant_isolation_api_keys ON "api_keys"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

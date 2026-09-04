ALTER TABLE "tenants" ADD COLUMN "slug" text DEFAULT ('org-' || substr(gen_random_uuid()::text, 1, 8)) NOT NULL;--> statement-breakpoint
UPDATE tenants SET slug = COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'org') || '-' || substr(id::text, 1, 8);--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" ("slug");--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_unique" ON "people" ("email");--> statement-breakpoint
INSERT INTO people (email, password_hash, full_name, totp_secret, totp_enabled, created_at, updated_at)
SELECT DISTINCT ON (email) email, password_hash, full_name, totp_secret, totp_enabled, created_at, updated_at
FROM users
ORDER BY email, updated_at DESC;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "person_id" uuid;--> statement-breakpoint
UPDATE users SET person_id = people.id FROM people WHERE people.email = users.email;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "users_tenant_email_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "full_name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_secret";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_person_unique" ON "users" ("tenant_id","person_id");

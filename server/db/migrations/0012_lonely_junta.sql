CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"default_currency" text DEFAULT 'MXN' NOT NULL,
	"timezone" text DEFAULT 'America/Mexico_City' NOT NULL,
	"country" text DEFAULT 'MX' NOT NULL,
	"fiscal_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

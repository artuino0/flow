ALTER TABLE "tenants" ADD COLUMN "logo_storage_key" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_mime_type" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_file_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_size_bytes" integer;
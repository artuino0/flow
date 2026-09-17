CREATE TABLE IF NOT EXISTS "record_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"user_id" uuid,
	"action_type" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_activities_record_id_records_id_fk') THEN
    ALTER TABLE "record_activities" ADD CONSTRAINT "record_activities_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_activities_user_id_users_id_fk') THEN
    ALTER TABLE "record_activities" ADD CONSTRAINT "record_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_activities_tenant_idx" ON "record_activities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_activities_record_idx" ON "record_activities" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_activities_user_idx" ON "record_activities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_activities_created_idx" ON "record_activities" USING btree ("created_at");

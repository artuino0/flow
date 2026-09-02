CREATE TABLE "trigger_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"execution_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"record_id" uuid,
	"status" text DEFAULT 'success' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"request_payload" jsonb,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trigger_actions_tenant_idx" ON "trigger_actions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trigger_actions_trigger_idx" ON "trigger_actions" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "trigger_logs_tenant_idx" ON "trigger_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trigger_logs_trigger_idx" ON "trigger_logs" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "trigger_logs_status_created_idx" ON "trigger_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "triggers_tenant_idx" ON "triggers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "triggers_entity_idx" ON "triggers" USING btree ("entity_id");
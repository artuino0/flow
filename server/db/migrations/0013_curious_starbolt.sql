CREATE TABLE "dim_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid,
	"nombre" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_date" (
	"id" integer PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"is_weekend" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_sucursal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid,
	"nombre" text NOT NULL,
	"ciudad" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date_id" integer NOT NULL,
	"cliente_id" uuid,
	"sucursal_id" uuid,
	"record_id" uuid,
	"tipo_evento" text NOT NULL,
	"monto" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cantidad" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_eventos" ADD CONSTRAINT "fact_eventos_date_id_dim_date_id_fk" FOREIGN KEY ("date_id") REFERENCES "public"."dim_date"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_eventos" ADD CONSTRAINT "fact_eventos_cliente_id_dim_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."dim_cliente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_eventos" ADD CONSTRAINT "fact_eventos_sucursal_id_dim_sucursal_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."dim_sucursal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dim_cliente_tenant_idx" ON "dim_cliente" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dim_date_date_unique" ON "dim_date" USING btree ("date");--> statement-breakpoint
CREATE INDEX "dim_sucursal_tenant_idx" ON "dim_sucursal" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "fact_eventos_tenant_idx" ON "fact_eventos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "fact_eventos_date_idx" ON "fact_eventos" USING btree ("date_id");--> statement-breakpoint
CREATE INDEX "fact_eventos_cliente_idx" ON "fact_eventos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "fact_eventos_sucursal_idx" ON "fact_eventos" USING btree ("sucursal_id");
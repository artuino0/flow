ALTER TABLE "entity_fields" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
	SELECT id, ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY created_at) - 1 AS rn
	FROM entity_fields
)
UPDATE entity_fields SET sort_order = ranked.rn FROM ranked WHERE entity_fields.id = ranked.id;

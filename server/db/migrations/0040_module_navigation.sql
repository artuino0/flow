ALTER TABLE tenants ADD COLUMN navigation_layout jsonb NOT NULL DEFAULT '{"groups":[]}'::jsonb;
--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN navigation_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE role_entity_permissions ADD COLUMN show_in_menu boolean NOT NULL DEFAULT true;

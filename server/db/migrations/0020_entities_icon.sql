ALTER TABLE "entities" ADD COLUMN "icon" text;--> statement-breakpoint
UPDATE entities SET icon = 'Users' WHERE slug = 'clientes' AND icon IS NULL;--> statement-breakpoint
UPDATE entities SET icon = 'Building2' WHERE slug = 'empresas' AND icon IS NULL;--> statement-breakpoint
UPDATE entities SET icon = 'UserRound' WHERE slug = 'empleados' AND icon IS NULL;

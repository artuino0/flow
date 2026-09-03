ALTER TABLE "entities" ADD COLUMN "module_kind" text DEFAULT 'hecho' NOT NULL;--> statement-breakpoint
-- ERD-86: backfill de los modulos ya existentes (scripts/seed.mjs y
-- scripts/seedEmpaque.mjs) - los de catalogo/referencia pasan a 'dimension';
-- recepciones/empaques/embarques quedan en 'hecho' (el default, sin tocar).
UPDATE entities SET module_kind = 'dimension' WHERE slug = 'clientes';--> statement-breakpoint
UPDATE entities SET module_kind = 'dimension' WHERE slug = 'empresas';--> statement-breakpoint
UPDATE entities SET module_kind = 'dimension' WHERE slug = 'empleados';--> statement-breakpoint
UPDATE entities SET module_kind = 'dimension' WHERE slug = 'productores';--> statement-breakpoint
UPDATE entities SET module_kind = 'dimension' WHERE slug = 'cultivos';
// Esquema dinamico del Motor ERP (dominio OLTP).
// Ver DOCS/Motor_ERP_Dinamico_v1.1.docx seccion 3.1 para el detalle de arquitectura.
import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// entities: define los objetos/modulos del sistema (ej. Clientes, Facturas, Productores).
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantSlugUnique: uniqueIndex('entities_tenant_slug_unique').on(table.tenantId, table.slug)
}))

// entity_fields: diccionario de datos - define las propiedades de cada entidad,
// su tipo de dato y reglas de validacion (usadas para generar el schema Zod dinamico).
export const entityFields = pgTable('entity_fields', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  label: text('label').notNull(),
  dataType: text('data_type').notNull(), // text | number | boolean | date | json | relation ...
  validationRules: jsonb('validation_rules').notNull().default({}),
  isRequired: boolean('is_required').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  entityNameUnique: uniqueIndex('entity_fields_entity_name_unique').on(table.entityId, table.name)
}))

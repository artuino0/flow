// Esquema dinamico del Motor ERP (dominio OLTP).
// Ver DOCS/Motor_ERP_Dinamico_v1.1.docx seccion 3.1 para el detalle de arquitectura.
import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
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

// entity_field_history: snapshot en cada cambio de tipo/regla de un entity_field,
// para auditoria de metadatos.
export const entityFieldHistory = pgTable('entity_field_history', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entityFieldId: uuid('entity_field_id').notNull().references(() => entityFields.id, { onDelete: 'cascade' }),
  dataType: text('data_type').notNull(),
  validationRules: jsonb('validation_rules').notNull(),
  isRequired: boolean('is_required').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  changedBy: uuid('changed_by')
})

// records: almacenamiento generico de cualquier registro de cualquier entidad.
// custom_data (JSONB) guarda los valores segun entity_fields; is_dirty marca
// revalidacion perezosa cuando cambian los metadatos de la entidad.
export const records = pgTable('records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').notNull(),
  customData: jsonb('custom_data').notNull().default({}),
  isDirty: boolean('is_dirty').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('records_tenant_idx').on(table.tenantId),
  entityIdx: index('records_entity_idx').on(table.entityId),
  customDataGinIdx: index('records_custom_data_gin_idx').using('gin', table.customData)
}))

// relation_definitions: define tipos de vinculo permitidos entre dos entidades (grafo).
export const relationDefinitions = pgTable('relation_definitions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  sourceEntityId: uuid('source_entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  targetEntityId: uuid('target_entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantNameUnique: uniqueIndex('relation_definitions_tenant_name_unique').on(table.tenantId, table.name)
}))

// record_relations: instancias del grafo - vincula dos records segun una relation_definition.
// La integridad referencial (que el record exista y sea del tipo esperado) se valida
// via trigger PL/pgSQL (ver migracion 0005); la validacion de campos vive solo en Zod (Nitro).
export const recordRelations = pgTable('record_relations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  relationDefinitionId: uuid('relation_definition_id').notNull().references(() => relationDefinitions.id, { onDelete: 'cascade' }),
  sourceRecordId: uuid('source_record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  targetRecordId: uuid('target_record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  sourceIdx: index('record_relations_source_idx').on(table.sourceRecordId),
  targetIdx: index('record_relations_target_idx').on(table.targetRecordId)
}))

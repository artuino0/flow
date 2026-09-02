// Esquema dinamico del Motor ERP (dominio OLTP).
// Ver DOCS/Motor_ERP_Dinamico_v1.1.docx seccion 3.1 para el detalle de arquitectura.
import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex, index, integer, numeric, date } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// entities: define los objetos/modulos del sistema (ej. Clientes, Facturas, Productores).
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  // Rediseno "Editar Módulo" (Screen/Editar Módulo del .pen, 2026-09-01):
  // switch "Módulo activo" - true por defecto (todo modulo existente antes de
  // esta columna sigue activo, sin migracion de datos aparte). Cuando esta en
  // false, requirePermission() (server/utils/rbac.ts) bloquea con 403 el
  // acceso a records/campos de esta entidad para cualquier rol NO
  // administrador (roles.isSystem) - un administrador siempre puede seguir
  // viendo/editando el modulo (para poder reactivarlo). No borra ni oculta
  // datos, solo bloquea el acceso mientras esta apagado.
  isActive: boolean('is_active').notNull().default(true),
  // HU-ERD-74: configuracion del "Diseño del detalle" (que propiedades y
  // relaciones inversas se muestran en la ficha de un registro, en que orden,
  // y si se muestra la linea de tiempo de actividad). Null = sin configurar
  // todavia -> la ficha usa el orden por defecto (ver server/utils/detailLayout.ts,
  // resolveDetailLayout()), nunca rompe ni queda vacia (criterio de aceptacion
  // explicito de la HU). Misma decision de "sin tabla nueva" ya usada para
  // Tabla/Select (ERD-68): vive en una columna jsonb de entities, no en una
  // tabla de layout aparte.
  detailLayout: jsonb('detail_layout'),
  // HU-ERD-75: configuracion del "Diseño del listado" (Table Builder) - que
  // columnas se muestran y en que orden, que campos Select/Multiselect se
  // ofrecen como filtro, y el orden por defecto. Null = sin configurar todavia
  // -> el listado se comporta exactamente como antes de esta HU (todas las
  // columnas, todos los campos Select/Multiselect como filtro, sin orden por
  // defecto propio) - criterio de aceptacion explicito: no rompe compatibilidad
  // para Clientes/Empresas/Empleados. Ver server/utils/listLayout.ts. Misma
  // decision de "sin tabla nueva" que detailLayout (ERD-74) y Tabla/Select (ERD-68).
  listLayout: jsonb('list_layout'),
  // Pedido directo del usuario (2026-09-01): "un selector de iconos, para
  // poder elegir el icono que usara el modulo, se puede editar" - primero se
  // implemento con un set curado de 24 iconos, pero el mismo dia el usuario
  // pidio el catalogo completo con buscador ("me imaginaba... todos los
  // iconos y un buscador"). Guarda el nombre canonico PascalCase de
  // @lucide/vue (ej. "Building2", "UserRound" - MODULE_ICON_KEYS en
  // server/utils/moduleIcons.ts, validado contra el catalogo completo del
  // paquete, no cualquier string libre). Null = sin elegir todavia -> el
  // frontend cae al icono generico "Blocks" (moduleIconComponent(),
  // utils/moduleIcons.ts), igual que hoy antes de esta columna. La migracion
  // de esta columna hace backfill de 'Users'/'Building2'/'UserRound' para
  // clientes/empresas/empleados (los 3 modulos base de scripts/seed.mjs) para
  // no perder el icono que ya tenian hardcodeado en components/AppNav.vue.
  icon: text('icon'),
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
  // Pedido por el usuario (2026-09-01): "el organizador" - orden en que se
  // muestran los campos, tanto en la tarjeta "Campos del módulo"
  // (ModuleFieldsCard.vue) como en el formulario real de crear/editar
  // (DynamicForm.vue, que itera fields en el mismo orden que devuelve
  // GET /api/entities/:entity/fields) y en la vista previa. Antes de esta
  // columna el orden era implicito (createdAt, sin forma de reordenar).
  // 0-based, unico por entidad (no hay constraint de unicidad en la base a
  // proposito - simplifica reordenar sin transacciones de "hueco" - el orden
  // real siempre se recalcula secuencial en reorderEntityFields()
  // (server/utils/moduleEntityFields.ts) y en createEntityField() al agregar
  // un campo nuevo al final). La migracion (0019) hace el backfill de los
  // campos ya existentes con ROW_NUMBER() sobre su createdAt actual, para no
  // alterar el orden que ya tenian.
  sortOrder: integer('sort_order').notNull().default(0),
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
  tenantId: uuid('tenant_id').notNull(),
  relationDefinitionId: uuid('relation_definition_id').notNull().references(() => relationDefinitions.id, { onDelete: 'cascade' }),
  sourceRecordId: uuid('source_record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  targetRecordId: uuid('target_record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('record_relations_tenant_idx').on(table.tenantId),
  sourceIdx: index('record_relations_source_idx').on(table.sourceRecordId),
  targetIdx: index('record_relations_target_idx').on(table.targetRecordId)
}))

// roles: RBAC por tenant. Sin permisos a nivel de campo en el MVP.
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantNameUnique: uniqueIndex('roles_tenant_name_unique').on(table.tenantId, table.name)
}))

// role_entity_permissions: permisos can_read/can_create/can_update/can_delete
// por rol y por entidad.
export const roleEntityPermissions = pgTable('role_entity_permissions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  canRead: boolean('can_read').notNull().default(false),
  canCreate: boolean('can_create').notNull().default(false),
  canUpdate: boolean('can_update').notNull().default(false),
  canDelete: boolean('can_delete').notNull().default(false)
}, (table) => ({
  roleEntityUnique: uniqueIndex('role_entity_permissions_role_entity_unique').on(table.roleId, table.entityId)
}))

// tenants: registro de organizaciones (HU-ERD-61). Antes tenant_id era solo un
// UUID suelto sin fila propia. Esta tabla NO lleva RLS por tenant_id (ella ES
// el tenant) - el acceso se protege en el endpoint (server/api/tenant/*),
// exigiendo que coincida con auth.tenantId del JWT.
// fiscal_data (jsonb) guarda datos que varian por pais (RFC/regimen fiscal en
// Mexico) sin forzar una migracion por cada mercado nuevo - mismo patron que
// entity_fields.validation_rules.
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  defaultCurrency: text('default_currency').notNull().default('MXN'),
  timezone: text('timezone').notNull().default('America/Mexico_City'),
  country: text('country').notNull().default('MX'),
  fiscalData: jsonb('fiscal_data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

// users: autenticacion propia (JWT + bcrypt), sin proveedor externo.
// El email es unico por tenant (no global) - un mismo email puede existir en
// distintos tenants, como espacios de trabajo independientes.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantEmailUnique: uniqueIndex('users_tenant_email_unique').on(table.tenantId, table.email)
}))

// files: metadatos de archivos subidos para el dataType 'file' (HU-ERD-78).
// El archivo en si vive en disco local (server/utils/fileStorage.ts,
// STORAGE_KEY = ruta relativa dentro del directorio de uploads), NO en esta
// tabla ni en Postgres - decision explicita (2026-09-01, AskUserQuestion al
// usuario): almacenamiento en disco del propio servidor para esta primera
// entrega, no S3/blob storage, para no sumar credenciales/infraestructura
// nueva. entityId (no recordId): un archivo se sube ANTES de que el record
// exista (flujo "nuevo registro" - el id del record recien se genera al
// guardar), asi que la unica referencia posible en el momento de subir es la
// entidad destino, no un record puntual - el vinculo real al record queda en
// customData[fieldName] = files.id (mismo patron que dataType 'relation'
// referencia un uuid de otro record). Limitacion conocida: un archivo subido
// y nunca guardado en ningun record queda "huerfano" en disco - sin job de
// limpieza en esta entrega (documentado, no un descuido).
export const files = pgTable('files', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('files_tenant_idx').on(table.tenantId),
  entityIdx: index('files_entity_idx').on(table.entityId)
}))

// ---- Dominio OLAP (HU-ERD-27): esquema en estrella para analitica ----
// El ETL que puebla estas tablas a partir del dominio transaccional
// (records/entities) es HU-ERD-28, todavia no implementado - aca solo se
// define el esquema (fact + dimensiones) con sus FKs.

// dim_date: dimension de fecha clasica de un DWH. Es GLOBAL (sin tenant_id):
// una fecha es la misma fila para todos los tenants, se puebla una sola vez
// (ej. con un generate_series) y no lleva RLS.
export const dimDate = pgTable('dim_date', {
  id: integer('id').primaryKey(), // clave surrogate yyyymmdd, ej 20260829
  date: date('date').notNull(),
  year: integer('year').notNull(),
  quarter: integer('quarter').notNull(),
  month: integer('month').notNull(),
  day: integer('day').notNull(),
  dayOfWeek: integer('day_of_week').notNull(), // 0 (domingo) - 6 (sabado)
  isWeekend: boolean('is_weekend').notNull().default(false)
}, (table) => ({
  dateUnique: uniqueIndex('dim_date_date_unique').on(table.date)
}))

// dim_cliente / dim_sucursal: dimensiones tenant-scoped, pobladas como
// snapshot/copia denormalizada desde records (entidad Clientes u otra que
// haga de "sucursal"). record_id queda como referencia informativa al record
// de origen SIN foreign key: una dimension de un DWH no debe acoplarse al
// ciclo de vida del dato transaccional (si el record de origen se borra, los
// hechos historicos ya facturados/registrados deben seguir siendo validos).
export const dimCliente = pgTable('dim_cliente', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  recordId: uuid('record_id'),
  nombre: text('nombre').notNull(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('dim_cliente_tenant_idx').on(table.tenantId),
  // Unico parcial (solo cuando hay record_id) - clave de upsert idempotente
  // del ETL (HU-ERD-28): una fila de dim_cliente por record de origen.
  recordUnique: uniqueIndex('dim_cliente_tenant_record_unique').on(table.tenantId, table.recordId).where(sql`${table.recordId} is not null`)
}))

export const dimSucursal = pgTable('dim_sucursal', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  recordId: uuid('record_id'),
  nombre: text('nombre').notNull(),
  ciudad: text('ciudad'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('dim_sucursal_tenant_idx').on(table.tenantId),
  recordUnique: uniqueIndex('dim_sucursal_tenant_record_unique').on(table.tenantId, table.recordId).where(sql`${table.recordId} is not null`)
}))

// fact_eventos: tabla de hechos generica (metricas/eventos de negocio -
// ventas, visitas, etc.). tipo_evento distingue el tipo de metrica sin
// necesitar una fact table por caso de uso; HU-ERD-28 decide que eventos
// transaccionales alimentan esto. monto/cantidad son las medidas aditivas
// tipicas de un esquema en estrella.
export const factEventos = pgTable('fact_eventos', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  dateId: integer('date_id').notNull().references(() => dimDate.id),
  clienteId: uuid('cliente_id').references(() => dimCliente.id, { onDelete: 'set null' }),
  sucursalId: uuid('sucursal_id').references(() => dimSucursal.id, { onDelete: 'set null' }),
  recordId: uuid('record_id'), // record de origen en el dominio transaccional, sin FK (ver nota en dim_cliente)
  tipoEvento: text('tipo_evento').notNull(),
  monto: numeric('monto', { precision: 14, scale: 2 }).notNull().default('0'),
  cantidad: integer('cantidad').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('fact_eventos_tenant_idx').on(table.tenantId),
  dateIdx: index('fact_eventos_date_idx').on(table.dateId),
  clienteIdx: index('fact_eventos_cliente_idx').on(table.clienteId),
  sucursalIdx: index('fact_eventos_sucursal_idx').on(table.sucursalId),
  // Unico parcial - clave de upsert idempotente del ETL (HU-ERD-28): un hecho
  // por record de origen (se re-sube/actualiza, nunca se duplica).
  recordUnique: uniqueIndex('fact_eventos_tenant_record_unique').on(table.tenantId, table.recordId).where(sql`${table.recordId} is not null`)
}))

// Esquema dinamico del Motor ERP (dominio OLTP).
// Ver DOCS/Motor_ERP_Dinamico_v1.1.docx seccion 3.1 para el detalle de arquitectura.
import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex, index, integer, numeric, date, bigint } from 'drizzle-orm/pg-core'
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
  // ERD-86: distingue modulos "hecho" (transaccionales - Recepcion, Empaque,
  // Embarque - se usan a diario, van en el menu principal) de "dimension"
  // (catalogos de referencia - Clientes, Cultivo, Productor - se crean poco,
  // solo se consultan; viven en Administracion > Catalogos para no saturar
  // el menu con muchos catalogos, pedido directo del usuario: "imagina tener
  // 20 catalogos en el menu"). Texto plano validado por Zod en los endpoints
  // (ADMIN_MODULE_KINDS en moduleEntities.ts), mismo criterio que
  // triggers.trigger_event/action_type - sin CHECK constraint propio. Default
  // 'hecho' para que ningun modulo existente cambie de comportamiento hasta
  // que la migracion de esta HU los reclasifique explicitamente.
  //
  // Deliberadamente NO editable desde "Editar Módulo" (ni PUT /api/entities/:id
  // lo acepta): se fija una sola vez, segun si el modulo se crea desde
  // /modulos o desde /catalogos (mismo asistente, dos puntos de entrada) - si
  // un modulo queda mal clasificado hay que recrearlo, decision explicita del
  // usuario para mantener esto simple.
  moduleKind: text('module_kind').notNull().default('hecho'),
  // Reportado por el usuario (2026-09-03, viendo Screen/Listado Recepción con
  // las columnas "productor"/"cultivo" mostrando el UUID crudo del registro
  // relacionado en vez de un nombre legible): "necesitamos poder decidir que
  // se muestra de la relacion". Vive en la entidad DESTINO de la relacion
  // (Productor/Cultivo), no en cada campo "relation" que apunta a ella - una
  // misma entidad puede ser destino de varios campos relation en distintos
  // modulos (ej. Productor podria referenciarse desde mas de un lugar en el
  // futuro) y todos deberian mostrar la misma etiqueta, sin repetir la
  // eleccion en cada uno. null (default) = heuristica automatica ya existente
  // (utils/recordLabel.ts: primer campo propio de tipo texto, sin contar el
  // "id" sintetico) - mismo criterio de "no romper nada existente" que
  // detailLayout/listLayout (ERD-74/75). Si no-null, DEBE ser el name de un
  // entity_field propio de tipo texto (validado en PUT /api/entities/:id,
  // server/utils/moduleEntities.ts) - nunca "id" (validado ahi mismo).
  labelField: text('label_field'),
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

// entity_field_counters: ultimo valor emitido por (entity_field_id, prefix) para
// campos dataType='incremental' (pedido directo del usuario, 2026-09-04: "quisiera
// un campo nuevo que sea como un incremental... por ejemplo 10 digitos donde vaya
// incrementando en 1... o un campo incremental que use un campo de una relacion
// para completarse, por ejemplo... mercado, nacional o extranjero, y 6 0 con el
// incremental en los numeros E003902 o N002356" - ver validationRules del campo
// en server/utils/dynamicSchema.ts: { digits, prefixSource? }).
//
// `prefix` es '' para un incremental "simple" (sin relacion) - un solo contador
// para todo el campo. Con relacion (prefixSource), CADA valor distinto del campo
// de texto elegido en la entidad relacionada lleva su PROPIO contador
// independiente (confirmado con el usuario: "un contador por cada valor de
// prefijo", no uno global compartido) - por eso la fila real es
// (entity_field_id, prefix real, ej. 'N'/'E'), nunca (entity_field_id) solo.
//
// bigint (no integer): 10 digitos pedidos por el usuario en el caso simple ya
// excede el rango de integer de Postgres (~2.147 millones); mode:'number' porque
// el rango real (hasta 10^15) sigue muy por debajo del limite seguro de un
// number de JS (2^53).
//
// Igual que entity_fields (ver comentario largo en moduleEntityFields.ts), SIN
// tenant_id/RLS propio - toda funcion que la toca resuelve primero, por join,
// que el entity_field (y su entity dueña) sean del tenant autenticado (ver
// server/utils/incrementalField.ts).
export const entityFieldCounters = pgTable('entity_field_counters', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entityFieldId: uuid('entity_field_id').notNull().references(() => entityFields.id, { onDelete: 'cascade' }),
  prefix: text('prefix').notNull().default(''),
  lastValue: bigint('last_value', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  fieldPrefixUnique: uniqueIndex('entity_field_counters_field_prefix_unique').on(table.entityFieldId, table.prefix)
}))

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
  // HU-ERD-83 (parte 2): 2FA por TOTP (RFC 6238). totpSecret queda guardado
  // apenas se inicia la configuracion (POST /api/auth/totp/setup) pero
  // totpEnabled sigue en false hasta que el usuario confirma un codigo real
  // generado por su app autenticadora (POST /api/auth/totp/verify) - evita
  // que un setup a medias (usuario nunca escaneo el QR) deje la cuenta con
  // 2FA "activado" pero sin forma de generar codigos validos.
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  // HU-ERD-84: invitacion por correo. Un usuario invitado se inserta con
  // isActive=false, passwordHash = hash de un valor aleatorio que nunca se
  // entrega a nadie (passwordHash es NOT NULL, no hay forma de dejarlo vacio)
  // e invitationTokenHash/invitationExpiresAt con el estado real de la
  // invitacion. Se guarda el HASH del token (sha256), nunca el token crudo -
  // mismo criterio que passwordHash: si la base se filtra, no alcanza para
  // aceptar la invitacion. El token crudo solo existe en el correo enviado.
  // "Invitación pendiente" (Screen/Usuarios del .pen) = invitationTokenHash
  // no nulo y invitationExpiresAt en el futuro; isActive=false es el gate
  // real que impide login (server/api/auth/login.post.ts) mientras tanto -
  // invitationTokenHash/invitationExpiresAt son solo para resolver el token
  // de aceptacion, no una segunda fuente de verdad sobre si puede loguear.
  invitationTokenHash: text('invitation_token_hash'),
  invitationExpiresAt: timestamp('invitation_expires_at', { withTimezone: true }),
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

// ---- HU-ERD-47: motor de triggers configurable por el usuario (Épica ERD-46,
// Automatización y Reportería con IA). Regla (triggers) + acciones
// (trigger_actions) + auditoría de ejecución (trigger_logs). `condition` y
// `config` son JSONB: un DSL declarativo evaluado por server/utils (ERD-48),
// nunca código ejecutable (eval/similares) - riesgo de inyección descartado
// por diseño, no por sanitización.

export const triggers = pgTable('triggers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // on_create | on_update | on_delete | on_transition (ERD-53) - texto simple,
  // no un pgEnum de Postgres: mismo criterio que entity_fields.data_type
  // (KNOWN_DATA_TYPES en dynamicSchema.ts) - agregar un evento nuevo no debe
  // requerir una migración de esquema, solo extender la validación Zod.
  triggerEvent: text('trigger_event').notNull(),
  // DSL declarativo: {field, operator, value} combinables con AND/OR (ERD-48
  // define la forma exacta y la valida). Default {} = "sin condición todavía"
  // (trigger recién creado, aún no configurado) - NO se confunde con "siempre
  // dispara": ERD-48 trata un condition vacío/sin campo como inválido, no
  // como verdadero.
  condition: jsonb('condition').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('triggers_tenant_idx').on(table.tenantId),
  entityIdx: index('triggers_entity_idx').on(table.entityId)
}))

// trigger_actions: tenantId denormalizado a propósito (no solo resoluble via
// trigger_id -> triggers.tenant_id) para que la RLS de ESTA tabla filtre
// directo por tenant_id, tal como pide el criterio de aceptación de ERD-47
// ("RLS ... en las tres tablas") - mismo criterio que record_relations
// denormaliza tenant_id en vez de resolverlo siempre via relation_definitions.
export const triggerActions = pgTable('trigger_actions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  triggerId: uuid('trigger_id').notNull().references(() => triggers.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(), // webhook | email | update_field (ERD-49)
  config: jsonb('config').notNull().default({}),
  executionOrder: integer('execution_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('trigger_actions_tenant_idx').on(table.tenantId),
  triggerIdx: index('trigger_actions_trigger_idx').on(table.triggerId)
}))

// trigger_logs: auditoría de cada intento de ejecución de una acción
// (ERD-49). recordId con onDelete 'set null' (no 'cascade' como el resto de
// esta sección) a propósito: un log de ejecución es auditoría - debe
// sobrevivir aunque el record que lo originó se borre después, mismo
// criterio que un log de acceso no desaparece si el recurso auditado se
// borra. Índice compuesto (status, created_at) para el barrido de
// reintentos (ERD-49: recorre 'retrying' ordenado por antigüedad).
export const triggerLogs = pgTable('trigger_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  triggerId: uuid('trigger_id').notNull().references(() => triggers.id, { onDelete: 'cascade' }),
  recordId: uuid('record_id').references(() => records.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('success'), // success | failed | retrying | dead_letter
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  requestPayload: jsonb('request_payload'),
  responseStatus: integer('response_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('trigger_logs_tenant_idx').on(table.tenantId),
  triggerIdx: index('trigger_logs_trigger_idx').on(table.triggerId),
  statusCreatedIdx: index('trigger_logs_status_created_idx').on(table.status, table.createdAt)
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

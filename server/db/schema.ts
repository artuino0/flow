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
  // false, los registros siguen legibles con canRead, pero ninguna escritura
  // nueva se acepta, incluso para administradores. deletedAt distingue los
  // módulos borrados (restaurables) de los desactivados manualmente.
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
  // Vista Kanban opcional; sus columnas se derivan del campo Select elegido.
  boardConfig: jsonb('board_config'),
  // ERD-96: reglas opcionales del flujo para un campo Select existente.
  workflowConfig: jsonb('workflow_config'),
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
  // Pedido directo del usuario (2026-09-05): "hay manera de calcular el
  // plural? para que en el menu salga Manifiestos, Empaques..." - se
  // investigo la opcion de calcular el plural en español a partir de `name`,
  // pero los modulos YA existentes guardan ahi directamente el plural
  // ("Recepciones", "Empaques", mismo texto que hoy se ve en el menu) - hacer
  // de `name` el singular canonico hubiera roto el menu de TODOS los modulos
  // creados hasta hoy. Se elige en cambio la opcion sin riesgo, confirmada
  // con el usuario: `name` sigue siendo exactamente lo que es hoy (el texto
  // libre que se ve en listado/breadcrumb, tipicamente en plural), y se
  // agrega esta columna nueva y opcional.
  //
  // Uso doble, ambos condicionados a que este cargada (null = no cambia
  // nada, comportamiento identico al de antes de esta columna):
  // 1. "Nuevo X"/"Editar X" (pages/registros/:entity/nuevo.vue y
  //    .../:id/editar.vue) usan `singularName` tal cual en vez de `name`.
  // 2. Seguimiento el mismo dia ("queria que con js en el menu se pusiera en
  //    plural, no queria un campo nuevo"): el menu (components/AppNav.vue,
  //    via listVisibleEntities()) muestra pluralize(singularName)
  //    (server/utils/pluralize.ts) en vez de `name` crudo - asi el usuario
  //    solo escribe el singular UNA vez y el plural del menu se calcula solo,
  //    sin pedirle un segundo texto libre.
  //
  // Mismo criterio de "automatico/heuristica + override opcional, nunca
  // rompe lo existente" que detailLayout/listLayout/labelField de arriba.
  singularName: text('singular_name'),
  // Integración fiscal opcional: define qué campos de este módulo alimentan
  // al receptor/emisor de un CFDI. La configuración es explícita; nunca se
  // infiere por nombres y no duplica el catálogo del módulo.
  fiscalConfig: jsonb('fiscal_config'),
  // Configuración opcional de etiquetas imprimibles. Vive en el módulo para
  // que cada catálogo (por ejemplo Productos) pueda activar y diseñar su
  // propia etiqueta sin crear una tabla paralela por cada tamaño.
  labelConfig: jsonb('label_config'),
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
  // ERD-87 (borrado logico): null = registro activo (comportamiento de
  // siempre); no-null = "eliminado" en la fecha indicada, sin quitar la fila
  // de la base. Antes de esta columna, DELETE /api/records/:entity/:id hacia
  // un `delete` real - necesario ahora porque el Diseñador de reportes
  // imprimibles (ERD-88) tiene que poder listar registros eliminados como
  // filas atenuadas junto a los activos (visto en un reporte real de un ERP
  // similar: UNION ALL contra una tabla "_eliminado"), algo imposible de
  // reconstruir despues de un borrado fisico. El resto de la plataforma seguia
  // exactamente igual: todo endpoint que lee registros para uso normal
  // (listado, detalle, edicion, import, ETL de OLAP) filtra deletedAt IS NULL
  // por defecto - ver el comentario largo en server/utils/records.ts.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('records_tenant_idx').on(table.tenantId),
  entityIdx: index('records_entity_idx').on(table.entityId),
  customDataGinIdx: index('records_custom_data_gin_idx').using('gin', table.customData),
  deletedAtIdx: index('records_deleted_at_idx').on(table.deletedAt),
  // Listados por organizacion y modulo (migracion 0074).
  tenantEntityCreatedIdx: index('records_tenant_entity_created_idx').on(table.tenantId, table.entityId, table.createdAt.desc()).where(sql`deleted_at is null`)
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
  targetIdx: index('record_relations_target_idx').on(table.targetRecordId),
  // Un mismo vinculo dirigido no puede repetirse (migracion 0069). Las relaciones
  // de un modulo consigo mismo ademas se serializan en server/utils/recordAssociations.ts
  // para rechazar tambien el vinculo inverso (A->B y B->A).
  uniqueLink: uniqueIndex('record_relations_unique_link').on(table.relationDefinitionId, table.sourceRecordId, table.targetRecordId)
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
  canDelete: boolean('can_delete').notNull().default(false),
  showInMenu: boolean('show_in_menu').notNull().default(true)
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
// Pedido directo del usuario (2026-09-04), a partir de "no deberia pedir la
// organizacion en el login": tenants gana `slug` (Paso 2 del wizard de
// Registro del .pen, "Screen/Registro Paso 2 - Tu organización" - subdominio
// propuesto a partir del nombre, ej. "acme"). Unico globalmente, NOT NULL -
// backfill sintetico para tenants existentes (ver migracion). A proposito NO
// implementa resolucion real de tenant por subdominio/host (ese gap ya
// documentado en login.post.ts, "cuando exista resolucion por
// subdominio/dominio, este endpoint deberia..." sigue sin resolverse) - por
// ahora es solo un identificador unico mostrado en el wizard, sin logica de
// enrutamiento por host detras.
export const tenants = pgTable('tenants', {
  address: text('address'),
  idleTimeoutMinutes: integer('idle_timeout_minutes').notNull().default(30),
  idleWarningMinutes: integer('idle_warning_minutes').notNull().default(2),
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  // Default aleatorio (nunca usado por el wizard de Registro real, que
  // siempre manda un slug propio - ver server/utils/registration.ts) para
  // que un insert directo que no lo mencione (fixtures de test, scripts de
  // seed existentes) siga funcionando sin tocar decenas de archivos - mismo
  // criterio que defaultCurrency/timezone/country de abajo.
  slug: text('slug').notNull().default(sql`'org-' || substr(gen_random_uuid()::text, 1, 8)`),
  email: text('email'),
  phone: text('phone'),
  defaultCurrency: text('default_currency').notNull().default('MXN'),
  timezone: text('timezone').notNull().default('America/Mexico_City'),
  country: text('country').notNull().default('MX'),
  fiscalData: jsonb('fiscal_data').notNull().default({}),
  navigationLayout: jsonb('navigation_layout').$type<import('../../utils/moduleNavigation').NavigationLayout>().notNull().default({ groups: [] }),
  navigationRevision: integer('navigation_revision').notNull().default(0),
  // Logo del tenant (pedido directo del usuario, 2026-09-07: "los ajustes
  // para cargar el logo y los datos de la empresa emisora del reporte") -
  // mismo criterio de disco local que `files` (server/utils/fileStorage.ts),
  // pero SIN pasar por esa tabla: `files.entity_id` es NOT NULL y apunta a
  // un modulo dinamico (`entities`), y el logo no pertenece a ningun modulo
  // - es un dato del tenant mismo, un renglon por tenant, no una coleccion.
  // Server/utils/tenantLogo.ts reusa el mismo directorio de disco con sus
  // propias funciones. logoStorageKey nunca sale de la API (ver
  // GET /api/tenant) - es una ruta de disco interna, no un dato de negocio.
  logoStorageKey: text('logo_storage_key'),
  logoMimeType: text('logo_mime_type'),
  logoFileName: text('logo_file_name'),
  logoSizeBytes: integer('logo_size_bytes'),
  // Cuota de archivos del tenant. bigint permite planes que rebasen 2 GB.
  storageLimitBytes: bigint('storage_limit_bytes', { mode: 'number' }).notNull().default(2 * 1024 * 1024 * 1024),
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  slugUnique: uniqueIndex('tenants_slug_unique').on(table.slug)
}))

// Pedido directo del usuario (2026-09-04): "la organizacion en el login no
// debe pedirse a fuerza... siempre y cuando tuviera mas de una organizacion
// el correo" - reveló que el modelo anterior (un email = una fila de `users`
// por tenant, cada una con SU PROPIA contraseña) no alcanza para lo que el
// usuario pide: una misma persona con UNA sola contraseña, que puede
// pertenecer a (o crear) varias organizaciones. Se separa identidad de
// membresia:
//
// - `people` (esta tabla, GLOBAL, sin tenant_id/RLS - mismo criterio que
//   `tenants`): quien es la persona. Email unico GLOBALMENTE (antes era
//   unico por tenant), contraseña unica, y el 2FA (totpSecret/totpEnabled)
//   vive aca - es de la persona, no de la organizacion en la que este
//   entrando.
// - `users` (mas abajo, sigue existiendo con este nombre - "la cuenta de esa
//   persona EN este tenant"): ya no guarda email/password_hash/full_name/
//   totp* propios, sino `person_id` + tenant_id + role_id + is_active +
//   estado de invitacion, exactamente igual que antes salvo por eso. El JWT
//   de sesion (`AuthTokenPayload.sub`, server/utils/auth.ts) sigue siendo el
//   id de ESTA fila (la membresia), no el de `people` - todo el codigo que
//   ya resolvia "el usuario autenticado" via `eq(users.id, auth.sub)` sigue
//   funcionando igual, solo que ahora hace falta un join a `people` para
//   llegar a email/password/nombre/2FA (ver server/utils/changePassword.ts,
//   server/api/auth/totp/*, server/api/auth/me.get.ts).
//
// Migracion de datos (0030_erd_people_membresias.sql): el mismo email podia
// existir en varios tenants con contraseñas DISTINTAS bajo el modelo viejo
// (valido entonces, ya no). Se fusionan por email quedandose con los datos
// (password_hash/full_name/totp*) de la fila con `updated_at` mas reciente -
// decision explicita del usuario ("no me importa, es solo data de prueba...
// conservar la contraseña mas reciente"), no una regla de negocio nueva.
export const people = pgTable('people', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  phone: text('phone'),
  // HU-ERD-83 (parte 2): 2FA por TOTP (RFC 6238). totpSecret queda guardado
  // apenas se inicia la configuracion (POST /api/auth/totp/setup) pero
  // totpEnabled sigue en false hasta que el usuario confirma un codigo real
  // generado por su app autenticadora (POST /api/auth/totp/verify) - evita
  // que un setup a medias (usuario nunca escaneo el QR) deje la cuenta con
  // 2FA "activado" pero sin forma de generar codigos validos.
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  emailUnique: uniqueIndex('people_email_unique').on(table.email)
}))

// users: la MEMBRESIA de una persona (`people`, arriba) en un tenant puntual
// - rol, estado activo/invitacion, todo tenant-scoped con RLS como siempre.
// Ya no es "la cuenta" completa (eso es `people` desde HU multi-organizacion,
// 2026-09-04) - ver el comentario largo en `people` de arriba para el porque.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
  jobTitle: text('job_title'),
  timezone: text('timezone'),
  isActive: boolean('is_active').notNull().default(true),
  // HU-ERD-84: invitacion por correo. Una membresia invitada (persona nueva,
  // nunca existio antes en `people`) se inserta con isActive=false - el
  // placeholder de contraseña ahora vive en la fila de `people` recien creada
  // (people.passwordHash es NOT NULL, igual razon que antes) -
  // invitationTokenHash/invitationExpiresAt con el estado real de la
  // invitacion. Se guarda el HASH del token (sha256), nunca el token crudo -
  // mismo criterio que passwordHash: si la base se filtra, no alcanza para
  // aceptar la invitacion. El token crudo solo existe en el correo enviado.
  // Cuando la persona invitada YA existe en `people` (otro tenant), la
  // membresia nueva se crea directamente isActive=true, sin este flujo -
  // ver inviteUser() en server/utils/users.ts.
  // "Invitación pendiente" (Screen/Usuarios del .pen) = invitationTokenHash
  // no nulo y invitationExpiresAt en el futuro; isActive=false es el gate
  // real que impide login (server/api/auth/login.post.ts) mientras tanto -
  // invitationTokenHash/invitationExpiresAt son solo para resolver el token
  // de aceptacion, no una segunda fuente de verdad sobre si puede loguear.
  invitationTokenHash: text('invitation_token_hash'),
  invitationExpiresAt: timestamp('invitation_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  dashboardShortcuts: jsonb('dashboard_shortcuts').$type<string[]>().notNull().default(sql`'[]'::jsonb`)
}, (table) => ({
  tenantPersonUnique: uniqueIndex('users_tenant_person_unique').on(table.tenantId, table.personId)
}))

// Configuracion SMTP personalizada por organizacion. Los secretos nunca se
// guardan en claro: server/utils/settingsCrypto.ts los cifra antes de insertar.
// Catálogo comercial global de Flow. Los tenants no editan estos precios: Stripe
// cobra con el Price ID configurado aquí y Flow conserva los límites que aplica.
export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  monthlyPriceCents: integer('monthly_price_cents').notNull().default(0),
  annualPriceCents: integer('annual_price_cents').notNull().default(0),
  currency: text('currency').notNull().default('MXN'),
  limits: jsonb('limits').notNull().default({}),
  stripeMonthlyPriceId: text('stripe_monthly_price_id'),
  stripeAnnualPriceId: text('stripe_annual_price_id'),
  isPublic: boolean('is_public').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({ codeUnique: uniqueIndex('subscription_plans_code_unique').on(table.code) }))

// Fuente de verdad interna de la suscripción. Stripe provee el cobro, pero
// Flow mantiene el estado aplicable para cuotas, soporte y on-premise.
export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => subscriptionPlans.id),
  provider: text('provider').notNull().default('manual'),
  status: text('status').notNull().default('trialing'),
  billingInterval: text('billing_interval').notNull().default('month'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePriceId: text('stripe_price_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantUnique: uniqueIndex('tenant_subscriptions_tenant_unique').on(table.tenantId),
  stripeSubscriptionUnique: uniqueIndex('tenant_subscriptions_stripe_subscription_unique').on(table.stripeSubscriptionId),
  tenantIdx: index('tenant_subscriptions_tenant_idx').on(table.tenantId)
}))

// Historial inmutable de las facturas de la suscripción SaaS; es distinto de
// Facturación CFDI, que pertenece al negocio del tenant.
export const tenantBillingInvoices = pgTable('tenant_billing_invoices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => tenantSubscriptions.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('stripe'),
  providerInvoiceId: text('provider_invoice_id'),
  status: text('status').notNull(),
  currency: text('currency').notNull().default('MXN'),
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull().default(0),
  amountPaidCents: integer('amount_paid_cents').notNull().default(0),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  hostedInvoiceUrl: text('hosted_invoice_url'),
  invoicePdfUrl: text('invoice_pdf_url'),
  providerData: jsonb('provider_data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  providerInvoiceUnique: uniqueIndex('tenant_billing_invoices_provider_invoice_unique').on(table.provider, table.providerInvoiceId),
  tenantIssuedIdx: index('tenant_billing_invoices_tenant_issued_idx').on(table.tenantId, table.issuedAt)
}))

// Una muestra diaria por recurso permite comparar tendencia contra el límite,
// incluso si el tenant cambia de plan más adelante.
export const tenantUsageSnapshots = pgTable('tenant_usage_snapshots', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => tenantSubscriptions.id, { onDelete: 'set null' }),
  resourceKey: text('resource_key').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
  limitValue: bigint('limit_value', { mode: 'number' }),
  capturedOn: date('captured_on').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull().default('daily')
}, table => ({
  tenantResourceDayUnique: uniqueIndex('tenant_usage_snapshots_tenant_resource_day_unique').on(table.tenantId, table.resourceKey, table.capturedOn),
  tenantDayIdx: index('tenant_usage_snapshots_tenant_day_idx').on(table.tenantId, table.capturedOn)
}))
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
}, table => ({ ownerIdx: index('auth_sessions_owner_idx').on(table.tenantId, table.userId) }))

export const tenantEmailSettings = pgTable('tenant_email_settings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('smtp'),
  host: text('host'),
  port: integer('port'),
  security: text('security').notNull().default('tls'),
  username: text('username'),
  passwordEncrypted: text('password_encrypted'),
  apiKeyEncrypted: text('api_key_encrypted'),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name'),
  replyTo: text('reply_to'),
  // Amazon SES Tenant Management (migracion 0070): tenant, configuration set y
  // dominio verificado propios de la organizacion (provider = 'ses').
  sesTenantName: text('ses_tenant_name'),
  sesConfigSet: text('ses_config_set'),
  sendingDomain: text('sending_domain'),
  domainStatus: text('domain_status'),
  dkimTokens: jsonb('dkim_tokens'),
  sendingStatus: text('sending_status'),
  statusCheckedAt: timestamp('status_checked_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantUnique: uniqueIndex('tenant_email_settings_tenant_unique').on(table.tenantId),
  tenantIdx: index('tenant_email_settings_tenant_idx').on(table.tenantId)
}))

// Cola de trabajos (migracion 0071): correos y otras tareas diferidas. Un proceso
// las toma con FOR UPDATE SKIP LOCKED (server/utils/jobQueue.ts). RLS: cada
// organizacion ve solo los suyos; el proceso de la cola usa withJobWorker().
export const jobQueue = pgTable('job_queue', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(6),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lastError: text('last_error'),
  idempotencyKey: text('idempotency_key'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('job_queue_tenant_idx').on(table.tenantId, table.kind, table.createdAt),
  idempotencyUnique: uniqueIndex('job_queue_idempotency_unique').on(table.tenantId, table.kind, table.idempotencyKey)
}))

// API keys personales, aisladas por tenant. Solo se persiste el hash; el
// secreto crudo se entrega una vez al crearla y después no puede recuperarse.
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  tokenHash: text('token_hash').notNull(),
  scopes: jsonb('scopes').notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tokenHashUnique: uniqueIndex('api_keys_token_hash_unique').on(table.tokenHash),
  tenantIdx: index('api_keys_tenant_idx').on(table.tenantId),
  ownerIdx: index('api_keys_owner_idx').on(table.ownerUserId)
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
  // DSL opcional para una decisión interna con ramas sí/no. Vacío conserva el flujo lineal.
  decisionCondition: jsonb('decision_condition').notNull().default({}),
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
  actionType: text('action_type').notNull(), // webhook | email | notification | update_field (ERD-49)
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
// Resultado durable de acciones que crean/actualizan otro registro. La clave
// (acción, origen) evita duplicados durante reintentos del workflow.
export const triggerActionOutputs = pgTable('trigger_action_outputs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  triggerActionId: uuid('trigger_action_id').notNull().references(() => triggerActions.id, { onDelete: 'cascade' }),
  sourceRecordId: uuid('source_record_id').references(() => records.id, { onDelete: 'set null' }),
  targetRecordId: uuid('target_record_id').references(() => records.id, { onDelete: 'set null' }),
  result: jsonb('result').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantIdx: index('trigger_action_outputs_tenant_idx').on(table.tenantId),
  sourceUnique: uniqueIndex('trigger_action_outputs_action_source_unique').on(table.triggerActionId, table.sourceRecordId)
}))

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

// ---- Reportería con IA (Épica ERD-46, hermana de triggers/ERD-47 - ver
// comentario arriba de `triggers`). Pedido del usuario (2026-09-05, "y los
// reportes?" viendo el .pen): existía el diseño completo (Screen/Reportes -
// Nuevo reporte, Generando, Previsualización, Error) sin ningún backend.
//
// El usuario describe el reporte en lenguaje natural; un proveedor de IA
// (server/utils/aiProvider.ts) lo traduce a `queryDsl`, un JSON declarativo
// validado con Zod (server/utils/reportQuery.ts) sobre el esquema en estrella
// de abajo (dim_date/dim_cliente/dim_sucursal/fact_eventos) - MISMO principio
// que `triggers.condition`: nunca se genera ni ejecuta SQL de texto libre ni
// código arbitrario (eval/new Function), la IA solo elige entre un vocabulario
// cerrado de dimensiones/medidas que después se mapea a columnas reales por
// un switch controlado en el server.
//
// Fiel al mock: "Generar previsualización" NO persiste nada todavía (solo
// devuelve queryDsl + resultSnapshot al frontend) - una fila en esta tabla
// recien se crea al tocar "Guardar reporte". `resultSnapshot` es la
// vista previa YA calculada al momento de guardar (no se vuelve a ejecutar
// la consulta después) - mismo espíritu que un reporte "congelado" en el
// momento en que se guardó.
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  queryDsl: jsonb('query_dsl').notNull(),
  resultSnapshot: jsonb('result_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('reports_tenant_idx').on(table.tenantId)
}))

// print_reports (HU-ERD-88, Diseñador de reportes imprimibles): plantillas
// guardadas de reporte imprimible - "REPORTES GUARDADOS" en Screen/Generar
// reporte. A diferencia de `reports` (Reportería con IA, arriba), acá NO se
// guarda un resultSnapshot congelado: `dsl` es la ÚNICA fuente de verdad, y
// server/utils/printReport.ts se re-ejecuta contra los datos VIGENTES cada
// vez que se abre "Vista previa impresión" - un reporte imprimible (folios
// del día, bultos recién empacados) pierde el sentido si muestra datos
// viejos, a diferencia de un análisis puntual de Reportería IA que sí tiene
// sentido "congelar" (evita re-consultar a la IA cada vez que se reabre).
// `baseEntitySlug` está desnormalizado desde `dsl.baseEntity` únicamente para
// poder filtrar/mostrar la lista de guardados sin tener que parsear el jsonb
// (mismo motivo que `queryDsl.title` en listReports() de server/utils/reports.ts).
export const printReports = pgTable('print_reports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  baseEntitySlug: text('base_entity_slug').notNull(),
  dsl: jsonb('dsl').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('print_reports_tenant_idx').on(table.tenantId)
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

// record_activities: Bitácora unificada de auditoría y notas (Timeline).
export const recordActivities = pgTable('record_activities', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  // Tipos automáticos: 'CREATED', 'UPDATED', 'DELETED', 'LINKED', 'UNLINKED'
  // Tipos manuales: 'NOTE', 'EMAIL', 'CALL', 'TASK'
  actionType: text('action_type').notNull(),
  // Guardará los cambios automáticos {"changes": [{"field":"monto", "old":0, "new":1}]}
  // o los detalles manuales {"text": "Se recibió bien..."}
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdx: index('record_activities_tenant_idx').on(table.tenantId),
  recordIdx: index('record_activities_record_idx').on(table.recordId),
  userIdx: index('record_activities_user_idx').on(table.userId),
  createdIdx: index('record_activities_created_idx').on(table.createdAt) // Útil para ordenar la línea de tiempo cronológicamente
}))

// notification_groups: grupos de usuarios para destinatarios de avisos.
// Son tenant-scoped y no sustituyen a los roles: un grupo representa una
// audiencia operativa que puede cambiar sin modificar permisos.
export const notificationGroups = pgTable('notification_groups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantNameUnique: uniqueIndex('notification_groups_tenant_name_unique').on(table.tenantId, table.name),
  tenantIdx: index('notification_groups_tenant_idx').on(table.tenantId)
}))

export const notificationGroupMembers = pgTable('notification_group_members', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  groupId: uuid('group_id').notNull().references(() => notificationGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  groupUserUnique: uniqueIndex('notification_group_members_group_user_unique').on(table.groupId, table.userId),
  groupIdx: index('notification_group_members_group_idx').on(table.groupId),
  userIdx: index('notification_group_members_user_idx').on(table.userId)
}))

// notifications: aviso dirigido a un usuario. El evento origen se conserva
// en record_activities; esta tabla representa únicamente la bandeja personal,
// con su estado de lectura y destino navegable.
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('MENTION'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  entitySlug: text('entity_slug'),
  recordId: uuid('record_id').references(() => records.id, { onDelete: 'cascade' }),
  activityId: uuid('activity_id').references(() => recordActivities.id, { onDelete: 'cascade' }),
  actionUrl: text('action_url'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  inboxIdx: index('notifications_inbox_idx').on(table.tenantId, table.userId, table.createdAt),
  unreadIdx: index('notifications_unread_idx').on(table.tenantId, table.userId, table.readAt)
}))

// Permisos funcionales del chat. Los valores del rol son la base; las
// columnas nullable de la excepcion individual significan "heredar" cuando
// vienen en null. Se mantienen fuera de role_entity_permissions porque Chat
// es una capacidad transversal, no una entidad dinamica del motor.
export const roleChatPermissions = pgTable('role_chat_permissions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  canAccess: boolean('can_access').notNull().default(true),
  canStartDirect: boolean('can_start_direct').notNull().default(true),
  canSendAttachments: boolean('can_send_attachments').notNull().default(true),
  canCreateGroups: boolean('can_create_groups').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  roleUnique: uniqueIndex('role_chat_permissions_role_unique').on(table.roleId),
  tenantIdx: index('role_chat_permissions_tenant_idx').on(table.tenantId)
}))

export const userChatPermissionOverrides = pgTable('user_chat_permission_overrides', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  canAccess: boolean('can_access'),
  canStartDirect: boolean('can_start_direct'),
  canSendAttachments: boolean('can_send_attachments'),
  canCreateGroups: boolean('can_create_groups'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  userUnique: uniqueIndex('user_chat_permission_overrides_user_unique').on(table.userId),
  tenantIdx: index('user_chat_permission_overrides_tenant_idx').on(table.tenantId)
}))

// Aplicaciones fijas de Flow. Core y Ajustes permanecen disponibles por
// defecto; las demás pueden habilitarse por organización sin convertirlas en
// módulos dinámicos ni mezclar su seguridad con role_entity_permissions.
export const tenantApps = pgTable('tenant_apps', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  appKey: text('app_key').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantAppUnique: uniqueIndex('tenant_apps_tenant_app_unique').on(table.tenantId, table.appKey),
  tenantIdx: index('tenant_apps_tenant_idx').on(table.tenantId)
}))

// Permisos funcionales de aplicaciones fijas. Las claves se validan en
// utils/flowCapabilities.ts; una fila ausente conserva el valor compatible
// con el comportamiento anterior.
export const roleCapabilities = pgTable('role_capabilities', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  capabilityKey: text('capability_key').notNull(),
  allowed: boolean('allowed').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  roleKeyUnique: uniqueIndex('role_capabilities_role_key_unique').on(table.roleId, table.capabilityKey),
  tenantIdx: index('role_capabilities_tenant_idx').on(table.tenantId)
}))

export const userCapabilityOverrides = pgTable('user_capability_overrides', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  capabilityKey: text('capability_key').notNull(),
  allowed: boolean('allowed'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  userKeyUnique: uniqueIndex('user_capability_overrides_user_key_unique').on(table.userId, table.capabilityKey),
  tenantIdx: index('user_capability_overrides_tenant_idx').on(table.tenantId)
}))

// Sites es una aplicacion fija: sus paginas no son entities dinamicas de
// Flow Core. Todo el contenido pertenece al tenant y conserva versiones para
// que publicar nunca exponga un borrador en curso.
export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('draft'),
  locale: text('locale').notNull().default('es-MX'),
  settings: jsonb('settings').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantSlugUnique: uniqueIndex('sites_tenant_slug_unique').on(table.tenantId, table.slug),
  tenantIdx: index('sites_tenant_idx').on(table.tenantId)
}))

export const sitePages = pgTable('site_pages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('website'), // website | landing
  status: text('status').notNull().default('draft'),
  seo: jsonb('seo').notNull().default({}),
  draftVersionId: uuid('draft_version_id'),
  publishedVersionId: uuid('published_version_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  sitePathUnique: uniqueIndex('site_pages_site_path_unique').on(table.siteId, table.path),
  tenantIdx: index('site_pages_tenant_idx').on(table.tenantId),
  siteIdx: index('site_pages_site_idx').on(table.siteId)
}))

// HTML/CSS de Sites sigue versionado en site_page_versions. Esta tabla solo
// referencia binarios publicados: imágenes, fuentes y otros assets del sitio.
export const siteAssets = pgTable('site_assets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantIdx: index('site_assets_tenant_idx').on(table.tenantId),
  siteIdx: index('site_assets_site_idx').on(table.siteId)
}))

export const siteDomains = pgTable('site_domains', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull(),
  status: text('status').notNull().default('pending'),
  isPrimary: boolean('is_primary').notNull().default(false),
  rootPageId: uuid('root_page_id').references(() => sitePages.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('vercel'),
  providerData: jsonb('provider_data').notNull().default({}),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  hostnameUnique: uniqueIndex('site_domains_hostname_unique').on(table.hostname),
  tenantIdx: index('site_domains_tenant_idx').on(table.tenantId),
  siteIdx: index('site_domains_site_idx').on(table.siteId)
}))
export const sitePageVersions = pgTable('site_page_versions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => sitePages.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  status: text('status').notNull().default('draft'),
  html: text('html').notNull().default(''),
  css: text('css').notNull().default(''),
  formManifest: jsonb('form_manifest').notNull().default([]),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  pageVersionUnique: uniqueIndex('site_page_versions_page_version_unique').on(table.pageId, table.version),
  tenantIdx: index('site_page_versions_tenant_idx').on(table.tenantId),
  pageIdx: index('site_page_versions_page_idx').on(table.pageId)
}))
export const siteFormConnections = pgTable('site_form_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => sitePages.id, { onDelete: 'cascade' }),
  formKey: text('form_key').notNull(),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  fieldMapping: jsonb('field_mapping').notNull().default({}),
  defaultValues: jsonb('default_values').notNull().default({}),
  valueMappings: jsonb('value_mappings').notNull().default({}),
  status: text('status').notNull().default('active'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  formUnique: uniqueIndex('site_form_connections_form_unique').on(table.tenantId, table.siteId, table.pageId, table.formKey),
  tenantIdx: index('site_form_connections_tenant_idx').on(table.tenantId),
  entityIdx: index('site_form_connections_entity_idx').on(table.entityId)
}))
export const siteFormSubmissions = pgTable('site_form_submissions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => sitePages.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => siteFormConnections.id, { onDelete: 'set null' }),
  formKey: text('form_key').notNull(),
  payload: jsonb('payload').notNull().default({}),
  originMetadata: jsonb('origin_metadata').notNull().default({}),
  status: text('status').notNull().default('received'),
  errorMessage: text('error_message'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantIdx: index('site_form_submissions_tenant_idx').on(table.tenantId),
  formIdx: index('site_form_submissions_form_idx').on(table.siteId, table.pageId, table.formKey, table.createdAt),
  originGinIdx: index('site_form_submissions_origin_gin_idx').using('gin', table.originMetadata)
}))
export const siteFormSubmissionTargets = pgTable('site_form_submission_targets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  submissionId: uuid('submission_id').notNull().references(() => siteFormSubmissions.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'restrict' }),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  action: text('action').notNull().default('created'),
  mappingSnapshot: jsonb('mapping_snapshot').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantIdx: index('site_form_submission_targets_tenant_idx').on(table.tenantId),
  submissionIdx: index('site_form_submission_targets_submission_idx').on(table.submissionId),
  recordIdx: index('site_form_submission_targets_record_idx').on(table.recordId)
}))
export const chatConversations = pgTable('chat_conversations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // direct | group
  title: text('title'),
  directKey: text('direct_key'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantIdx: index('chat_conversations_tenant_idx').on(table.tenantId),
  recentIdx: index('chat_conversations_recent_idx').on(table.tenantId, table.lastMessageAt),
  directUnique: uniqueIndex('chat_conversations_direct_unique').on(table.tenantId, table.directKey).where(sql`${table.directKey} is not null`)
}))

export const chatParticipants = pgTable('chat_participants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  participantRole: text('participant_role').notNull().default('member'), // owner | member
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  conversationUserUnique: uniqueIndex('chat_participants_conversation_user_unique').on(table.conversationId, table.userId),
  inboxIdx: index('chat_participants_inbox_idx').on(table.tenantId, table.userId, table.archivedAt),
  conversationIdx: index('chat_participants_conversation_idx').on(table.conversationId)
}))

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
  clientMessageId: uuid('client_message_id').notNull(),
  body: text('body').notNull().default(''),
  gifUrl: text('gif_url'),
  // Enlace opcional a un registro. Se conserva como referencia estable y se
  // filtra al serializar según el permiso del lector.
  sharedRecord: jsonb('shared_record').$type<{ entitySlug: string; recordId: string; label: string; url: string } | null>(),
  replyToMessageId: uuid('reply_to_message_id'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  clientMessageUnique: uniqueIndex('chat_messages_client_message_unique').on(table.conversationId, table.senderUserId, table.clientMessageId),
  conversationCreatedIdx: index('chat_messages_conversation_created_idx').on(table.conversationId, table.createdAt),
  tenantIdx: index('chat_messages_tenant_idx').on(table.tenantId)
}))

// Un adjunto puede existir brevemente sin messageId mientras el usuario
// redacta. Al enviar se valida propietario/tenant y se liga en la misma
// transaccion que crea el mensaje.
export const chatAttachments = pgTable('chat_attachments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantIdx: index('chat_attachments_tenant_idx').on(table.tenantId),
  messageIdx: index('chat_attachments_message_idx').on(table.messageId),
  ownerIdx: index('chat_attachments_owner_idx').on(table.uploadedBy)
}))

// ---------------------------------------------------------------------------
// DOMINIO FISCAL FIJO: emision de CFDI 4.0 con PAC.
// Pedido directo del usuario (2026-09-14): "la facturacion no debe ser un
// modulo dinamico, la facturacion es fija". Un documento fiscal es un documento
// legal: no puede depender de metadatos editables (cambiar un entity_field
// marca records is_dirty y revalida perezosamente, ERD-18), necesita folio
// atomico por serie, transaccionalidad real y auditoria append-only. Por eso
// vive en tablas fijas (mismo criterio que users/tenants/roles/files/
// print_reports/chat), NO en entities/records. HU completa con fases A-H:
// DOCS/HU_Timbrado_CFDI_PAC.md.
//
// Relacion con el dominio dinamico: los modulos dinamicos son ORIGEN y
// CATALOGO. cfdi_documents.source_entity_id/source_record_id apuntan al
// registro que origino el documento (embarque, CxC, cobro - mismo patron de
// files.entity_id), SIN FK a entities/records a proposito: un documento
// timbrado debe sobrevivir a que el tenant borre o renombre el modulo de
// origen (inmutabilidad fiscal). Todo lo fiscal se SNAPSHOTEA al capturar/
// timbrar (emisor desde tenants.fiscalData, receptor desde el modulo dinamico
// clientes, claves SAT y tasas desde productos/unidades/impuestos).
// ---------------------------------------------------------------------------

// Secuencias de folio fiscal por (serie, tipo de comprobante). El folio se
// consume en la transaccion del intento de timbrado (UPDATE ... RETURNING,
// server/utils/cfdiFolio.ts) - el row lock de Postgres serializa intentos
// concurrentes, mismo principio que entity_field_counters (incrementalField.ts).
export const cfdiSeries = pgTable('cfdi_series', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  serie: text('serie').notNull(),
  tipoComprobante: text('tipo_comprobante').notNull(), // I | E | P (CHECK en migracion 0049)
  lugarExpedicion: text('lugar_expedicion').notNull(), // CP del emisor (5 digitos)
  nextFolio: integer('next_folio').notNull().default(1),
  estado: text('estado').notNull().default('activa'), // activa | inactiva
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  serieTipoUnique: uniqueIndex('cfdi_series_serie_tipo_unique').on(table.tenantId, table.serie, table.tipoComprobante),
  tenantIdx: index('cfdi_series_tenant_idx').on(table.tenantId)
}))

// El documento fiscal (CFDI). Maquina de estados: borrador -> timbrando ->
// timbrada | error; timbrada -> cancelada. `folio` es NULL en borrador y se
// asigna al pasar a `timbrando` (los errores de validacion previos a llamar al
// PAC no consumen folio). uuid_fiscal UNIQUE global (parcial: los borradores
// no tienen) - garantia dura contra doble timbrado, ademas del 409 del
// endpoint. custom_data queda reservado para extras por tenant (UI en v2).
export const cfdiDocuments = pgTable('cfdi_documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  serieId: uuid('serie_id').notNull().references(() => cfdiSeries.id, { onDelete: 'restrict' }),
  folio: integer('folio'),
  tipo: text('tipo').notNull(), // I | E | P (debe coincidir con la serie; CHECK en migracion)
  estado: text('estado').notNull().default('borrador'), // borrador | timbrando | timbrada | error | cancelada
  fechaEmision: timestamp('fecha_emision', { withTimezone: true }),
  // Emisor (snapshot de tenants.fiscalData + serie al timbrar)
  emisorRfc: text('emisor_rfc'),
  emisorNombre: text('emisor_nombre'),
  emisorRegimenFiscal: text('emisor_regimen_fiscal'),
  emisorCodigoPostal: text('emisor_codigo_postal'),
  // Receptor: referencia floja al registro dinamico del modulo clientes
  // (sin FK - ver comentario del dominio) + snapshot fiscal validado al capturar.
  customerEntityId: uuid('customer_entity_id'),
  customerRecordId: uuid('customer_record_id'),
  receptorRfc: text('receptor_rfc'),
  receptorNombre: text('receptor_nombre'),
  receptorCodigoPostal: text('receptor_codigo_postal'),
  receptorRegimenFiscal: text('receptor_regimen_fiscal'),
  receptorCorreo: text('receptor_correo'),
  usoCfdi: text('uso_cfdi'),
  // Datos fiscales del comprobante
  formaPago: text('forma_pago'), // clave SAT c_FormaPago (01/03/04/28/99...)
  metodoPago: text('metodo_pago').notNull().default('PUE'), // PUE | PPD
  moneda: text('moneda').notNull().default('MXN'),
  tipoCambio: numeric('tipo_cambio', { precision: 18, scale: 6 }),
  subtotal: numeric('subtotal', { precision: 18, scale: 2 }).notNull().default('0'),
  descuento: numeric('descuento', { precision: 18, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 18, scale: 2 }).notNull().default('0'),
  // Resumen de traslados/retenciones: { traslados: [{base, impuesto, tipoFactor, tasaOCuota, importe}], retenciones: [...] }
  impuestos: jsonb('impuestos').notNull().default({}),
  exportacion: text('exportacion').notNull().default('01'), // 01 no aplica | 02 definitiva | 03 temporal
  // CFDI relacionado (tipo E: nota de credito). Sin FK en Drizzle por
  // autorreferencia; la FK real (ON DELETE RESTRICT) esta en la migracion 0049.
  cfdiRelacionadoId: uuid('cfdi_relacionado_id'),
  tipoRelacion: text('tipo_relacion'), // clave SAT c_TipoRelacion (01/02/03/...)
  // Origen dinamico (embarque, CxC, cobro...): uuids de entities/records sin FK
  sourceEntityId: uuid('source_entity_id'),
  sourceRecordId: uuid('source_record_id'),
  fechaPago: timestamp('fecha_pago', { withTimezone: true }), // solo tipo P (complemento de pagos)
  // Resultado PAC
  uuidFiscal: text('uuid_fiscal'),
  fechaTimbrado: timestamp('fecha_timbrado', { withTimezone: true }),
  xmlStorageKey: text('xml_storage_key'), // binarios en disco, patron fileStorage.ts
  pdfStorageKey: text('pdf_storage_key'),
  mensajePac: text('mensaje_pac'),
  pacProvider: text('pac_provider'),
  pacDocumentId: text('pac_document_id'), // id del comprobante en el PAC (ej. _id de Facturapi) - cancel/getStatus operan sobre el
  intentos: integer('intentos').notNull().default(0),
  observaciones: text('observaciones'),
  customData: jsonb('custom_data').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  folioUnique: uniqueIndex('cfdi_documents_folio_unique').on(table.tenantId, table.serieId, table.folio).where(sql`${table.folio} is not null`),
  uuidFiscalUnique: uniqueIndex('cfdi_documents_uuid_fiscal_unique').on(table.uuidFiscal).where(sql`${table.uuidFiscal} is not null`),
  tenantEstadoIdx: index('cfdi_documents_tenant_estado_idx').on(table.tenantId, table.estado),
  serieIdx: index('cfdi_documents_serie_idx').on(table.serieId),
  sourceIdx: index('cfdi_documents_source_idx').on(table.sourceEntityId, table.sourceRecordId),
  relacionadoIdx: index('cfdi_documents_relacionado_idx').on(table.cfdiRelacionadoId)
}))

// Relaciones fiscales universales. Un CFDI puede originarse en varios
// registros (pedido, venta, servicio, embarque, CxC, etc.); por eso el
// vínculo no vive como una sola columna en cfdi_documents. Se conserva
// source_* por compatibilidad con la primera versión y esta tabla es la
// fuente nueva para consultar el grafo fiscal completo.
export const cfdiDocumentLinks = pgTable('cfdi_document_links', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => cfdiDocuments.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull(),
  recordId: uuid('record_id').notNull(),
  relationType: text('relation_type').notNull().default('source'),
  amount: numeric('amount', { precision: 18, scale: 2 }),
  currency: text('currency'),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  uniqueLink: uniqueIndex('cfdi_document_links_unique').on(table.tenantId, table.documentId, table.entityId, table.recordId, table.relationType),
  documentIdx: index('cfdi_document_links_document_idx').on(table.documentId),
  recordIdx: index('cfdi_document_links_record_idx').on(table.tenantId, table.entityId, table.recordId),
  tenantIdx: index('cfdi_document_links_tenant_idx').on(table.tenantId)
}))

// Conceptos (lineas) del CFDI. clave_prod_serv/clave_unidad e impuestos son
// SNAPSHOT de los modulos dinamicos productos/unidades_medida/impuestos al
// capturar - el PAC y el SAT exigen que la linea no cambie jamas.
export const cfdiConceptos = pgTable('cfdi_conceptos', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => cfdiDocuments.id, { onDelete: 'cascade' }),
  orden: integer('orden').notNull().default(1),
  claveProdServ: text('clave_prod_serv').notNull(),
  claveUnidad: text('clave_unidad').notNull(),
  cantidad: numeric('cantidad', { precision: 18, scale: 6 }).notNull(),
  descripcion: text('descripcion').notNull(),
  valorUnitario: numeric('valor_unitario', { precision: 18, scale: 6 }).notNull(),
  descuento: numeric('descuento', { precision: 18, scale: 6 }).notNull().default('0'),
  importe: numeric('importe', { precision: 18, scale: 6 }).notNull(),
  // { traslados: [{base, impuesto, tipoFactor, tasaOCuota, importe}], retenciones: [...] } por concepto
  impuestos: jsonb('impuestos').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  documentIdx: index('cfdi_conceptos_document_idx').on(table.documentId),
  tenantIdx: index('cfdi_conceptos_tenant_idx').on(table.tenantId)
}))

// DoctoRelacionado del complemento de pagos 2.0: una fila por factura (tipo I
// ya timbrada, de ahi la FK RESTRICT) que el documento P aplica. Nace de los
// registros dinamicos cobros_cliente/aplicaciones_cobro (fase E de la HU).
export const cfdiPaymentDocs = pgTable('cfdi_payment_docs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => cfdiDocuments.id, { onDelete: 'cascade' }),
  relatedCfdiId: uuid('related_cfdi_id').notNull().references(() => cfdiDocuments.id, { onDelete: 'restrict' }),
  numParcialidad: integer('num_parcialidad'),
  impSaldoAnt: numeric('imp_saldo_ant', { precision: 18, scale: 2 }).notNull(),
  impPagado: numeric('imp_pagado', { precision: 18, scale: 2 }).notNull(),
  impSaldoIns: numeric('imp_saldo_ins', { precision: 18, scale: 2 }).notNull(),
  monedaDr: text('moneda_dr').notNull().default('MXN'),
  tipoCambioDr: numeric('tipo_cambio_dr', { precision: 18, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  documentIdx: index('cfdi_payment_docs_document_idx').on(table.documentId),
  relatedIdx: index('cfdi_payment_docs_related_idx').on(table.relatedCfdiId),
  tenantIdx: index('cfdi_payment_docs_tenant_idx').on(table.tenantId)
}))

// Pista de auditoria fiscal APPEND-ONLY: cada intento de timbrado, error PAC,
// verificacion getStatus, cancelacion y acuse queda aqui. La inmutabilidad la
// garantiza un trigger (migracion 0049) que rechaza UPDATE/DELETE - mismo
// espiritu que los triggers de integridad de record_relations (ERD-10).
export const cfdiEvents = pgTable('cfdi_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => cfdiDocuments.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(), // folio_asignado | intento_timbrado | timbrado_ok | error_pac | verificacion_getstatus | cancelacion_solicitada | cancelacion_confirmada | email_enviado
  detalle: jsonb('detalle').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  documentIdx: index('cfdi_events_document_idx').on(table.documentId),
  tenantIdx: index('cfdi_events_tenant_idx').on(table.tenantId)
}))

// Credenciales PAC por tenant (fase B de la HU). Secretos SIEMPRE cifrados con
// settingsCrypto.ts (mismo patron que tenant_email_settings, migracion 0043):
// api_key y contraseña del CSD nunca en claro, nunca en logs/Sentry, y la API
// solo expone flags hasApiKey/hasCsd (patron hasLogo de ERD-62). Los binarios
// .cer/.key van a disco con el patron de tenantLogo.ts (storage keys), NO por
// la tabla files (que exige entity_id de un modulo dinamico).
export const tenantPacSettings = pgTable('tenant_pac_settings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('facturapi'),
  apiKeyEncrypted: text('api_key_encrypted'),
  sandbox: boolean('sandbox').notNull().default(true),
  csdCerStorageKey: text('csd_cer_storage_key'),
  csdKeyStorageKey: text('csd_key_storage_key'),
  csdCerFileName: text('csd_cer_file_name'),
  csdKeyFileName: text('csd_key_file_name'),
  csdPasswordEncrypted: text('csd_password_encrypted'),
  csdValidUntil: timestamp('csd_valid_until', { withTimezone: true }),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestOk: boolean('last_test_ok'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => ({
  tenantUnique: uniqueIndex('tenant_pac_settings_tenant_unique').on(table.tenantId),
  tenantIdx: index('tenant_pac_settings_tenant_idx').on(table.tenantId)
}))

// ERD-87: cursor global de infraestructura para el ETL OLAP (sin tenant/RLS).
export const olapEtlState = pgTable('olap_etl_state', {
  job: text('job').primaryKey(),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull(),
  lastRecordId: uuid('last_record_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

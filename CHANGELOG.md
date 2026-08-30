# Changelog

### [0.25.0] - 2026-08-30
#### [add]
- [ERD-30](https://dydasoftware.atlassian.net/browse/ERD-30) - test/e2e/crudEntities.test.ts: e2e real sobre las 3 entidades de ejemplo de scripts/seed.mjs (Clientes, Empresas, Empleados) - un flujo completo (crear, leer, actualizar, listar, eliminar) por entidad, mas 401 sin token y 422 con customData invalido. A diferencia de los tests de HU-ERD-29 (que llaman funciones de servidor directamente), este corre `nuxt build` y levanta `.output/server/index.mjs` como proceso real contra el Postgres embebido de test (aislado, sin Docker), y pega por HTTP real: login -> cookie -> CRUD. De paso corrigio un bug latente en scripts/seed.mjs (HU-ERD-25): la verificacion final de "hay rol admin" volvia a consultar la DB fuera de la transaccion sobre la misma conexion pooleada, lo cual dispara el quirk de Postgres documentado en HU-ERD-29 (`app.tenant_id` queda en `''` en vez de `NULL` tras la transaccion) y hacia fallar el script con un error de Postgres en vez de solo mostrar el aviso - ahora reusa el valor ya resuelto dentro de la transaccion.

### [0.24.0] - 2026-08-29
#### [add]
- [ERD-29](https://dydasoftware.atlassian.net/browse/ERD-29) - Suite de tests con Vitest (npm run test), corre en CI (.gitlab-ci.yml, stage test): (1) test/unit/dynamicSchema.test.ts, 17 casos cubriendo la generacion de schema Zod desde metadatos (buildFieldType, ahora exportada) para los 6 data types y sus reglas, sin DB; (2) test/integration/rlsTenantIsolation.test.ts, 7 casos contra un Postgres REAL embebido (embedded-postgres, sin Docker) con el rol erp_app real (no superusuario) - confirma que RLS aisla por tenant_id aun sin el WHERE que pondria Drizzle, y que un INSERT con tenant_id ajeno es rechazado. Hallazgo documentado (no corregido, fuera de alcance de esta HU): en una conexion que ya uso set_config alguna vez, dejar app.tenant_id sin setear hace fallar la query con un error de Postgres en vez de devolver 0 filas (sigue siendo seguro - no hay fuga de datos - pero es un modo de fallo distinto al esperado; ver comentarios en el test).

### [0.23.0] - 2026-08-29
#### [add]
- [ERD-28](https://dydasoftware.atlassian.net/browse/ERD-28) - Job node-cron (`*/15 * * * *`) dentro del proceso Nitro (server/plugins/olap-etl.ts) que sincroniza records al esquema OLAP (server/utils/olapEtl.ts): ventana de 30 min (2x el intervalo, da solapamiento) sobre records.updated_at, upsert idempotente via los unicos parciales (tenant_id, record_id) de dim_cliente/dim_sucursal/fact_eventos (migracion 0015). Deshabilitable con OLAP_ETL_ENABLED=false. Alcance documentado: fact_eventos trata cualquier record creado/editado como "evento" (tipo_evento = slug de su entidad) hasta que exista una entidad real de ventas/eventos; solo la entidad "clientes" alimenta ademas dim_cliente.

### [0.22.0] - 2026-08-29
#### [add]
- [ERD-27](https://dydasoftware.atlassian.net/browse/ERD-27) - Esquema OLAP en estrella: dim_date (global), dim_cliente y dim_sucursal (tenant-scoped, snapshot de records sin FK hacia el dominio transaccional a proposito) y fact_eventos (metricas/eventos genericos, FK obligatoria a dim_date y opcionales ON DELETE SET NULL a dim_cliente/dim_sucursal). Migraciones 0013 (tablas) y 0014 (RLS sobre las 3 tablas tenant-scoped). Documentado en DOCS/Esquema_OLAP.md. El ETL que lo puebla es ERD-28 (pendiente).

### [0.21.0] - 2026-08-29
#### [add]
- [ERD-25](https://dydasoftware.atlassian.net/browse/ERD-25) - scripts/seed.mjs: seed idempotente (ON CONFLICT DO NOTHING sobre los unique existentes) de entities/entity_fields para Clientes, Empresas y Empleados, parametrizado por perfil (generico | agro, este ultimo agrega tipo_cliente/hectareas/tipo_produccion/trabaja_en_campo). Otorga tambien permiso CRUD completo al rol admin (isSystem) del tenant si existe, para que el modulo sea usable de inmediato via el RBAC existente (fuera del alcance estricto del ticket, agregado por usabilidad).

### [0.20.0] - 2026-08-29
#### [add]
- [ERD-24](https://dydasoftware.atlassian.net/browse/ERD-24) - Table Builder dinamico: componente DynamicTable.vue con columnas derivadas de entity_fields, orden por encabezado y paginacion, acciones Editar/Eliminar por fila segun RBAC; pagina generica de listado (pages/registros/:entity). Se agrego orden server-side (sortBy/sortDir) a GET /api/records/:entity (createdAt/updatedAt o campo dinamico via custom_data->>, parametrizado) y los 4 flags de permiso (canRead/Create/Update/Delete) a GET /api/entities/:entity/fields (ERD-43 solo cubrira esto a nivel de menu, no por entidad puntual).

### [0.19.0] - 2026-08-29
#### [add]
- [ERD-23](https://dydasoftware.atlassian.net/browse/ERD-23) - Form Builder dinamico: componente DynamicForm.vue que renderiza inputs segun entity_fields (text/enum, number, boolean, date, json, relation) con validacion en cliente espejo de dynamicSchema.ts, paginas genericas de alta/edicion de registro (pages/registros/:entity/nuevo y /:id/editar). Se agrego tambien GET /api/entities/:entity/fields (prerequisito no cubierto por ningun ticket existente: ERD-43 solo expone el listado de entidades, no sus campos).

### [0.18.0] - 2026-08-29
#### [add]
- [ERD-61](https://dydasoftware.atlassian.net/browse/ERD-61) - Tabla tenants (nombre, moneda, zona horaria, fiscal_data jsonb con validacion Mexico: RFC/regimen fiscal/CP), endpoints GET/PUT /api/tenant (solo rol administrador, via roles.isSystem), login.post.ts ahora valida que el tenantId exista en tenants, seed-dev-user.mjs actualizado

### [0.17.0] - 2026-08-28
#### [add]
- Pantalla de login rediseñada segun Screen/Login de ERPDinamico.pen: paleta de marca (brand.*) y tipografia Inter en tailwind.config.ts/nuxt.config.ts, iconos @lucide/vue. Campo "Organizacion" mantiene el contrato tenantId (UUID) del backend - no existe aun resolucion de slug a tenant. Agregado tambien vue-tsc como devDependency (faltaba en package.json desde ERD-21, necesario para `nuxt typecheck`).

### [0.16.0] - 2026-08-27
#### [add]
- [ERD-22](https://dydasoftware.atlassian.net/browse/ERD-22) - Pantalla de login conectada a /api/auth/login, JWT en cookie httpOnly (no localStorage), manejo de credenciales invalidas, logout, middleware global de rutas protegidas con redireccion post-login

### [0.15.0] - 2026-08-27
#### [add]
- [ERD-21](https://dydasoftware.atlassian.net/browse/ERD-21) - Tailwind CSS (@nuxtjs/tailwindcss) + tema por defecto, layout base header/sidebar/contenido, placeholder de menu dinamico (AppNav) para ERD-44

### [0.14.0] - 2026-08-27
#### [add]
- [ERD-20](https://dydasoftware.atlassian.net/browse/ERD-20) - SDK de Sentry (no-op sin SENTRY_DSN) + logging estructurado JSON, hook global de errores en Nitro, log de acceso por request, endpoint de prueba controlado

### [0.13.1] - 2026-08-27
#### [fix]
- [ERD-45](https://dydasoftware.atlassian.net/browse/ERD-45) - Seguridad: bump drizzle-orm 0.36 -> 0.45.2 (fix de GHSA-gpj5-g38j-94v9, inyeccion SQL via identificadores mal escapados, CVSS 7.5) y drizzle-kit -> 0.31.10

### [0.13.0] - 2026-08-27
#### [add]
- [ERD-19](https://dydasoftware.atlassian.net/browse/ERD-19) - Endpoints de relaciones entre records (list/create/delete sobre record_relations), integridad via trigger de ERD-10, RBAC via canRead/canUpdate sobre las entidades source/target

### [0.12.0] - 2026-08-27
#### [add]
- [ERD-18](https://dydasoftware.atlassian.net/browse/ERD-18) - Revalidacion perezosa: trigger marca records.is_dirty al cambiar entity_fields (insert/update/delete), revalidacion bajo demanda en GET y PUT de records (sin job masivo)

### [0.11.0] - 2026-08-27
#### [add]
- [ERD-17](https://dydasoftware.atlassian.net/browse/ERD-17) - Generador de schema Zod dinamico desde entity_fields (cacheado en memoria por huella de metadatos), integrado en create/update de records

### [0.10.0] - 2026-08-27
#### [add]
- [ERD-16](https://dydasoftware.atlassian.net/browse/ERD-16) - CRUD generico sobre records (list paginado, create, get, update, delete) protegido por requirePermission + withTenant

### [0.9.0] - 2026-08-27
#### [add]
- [ERD-15](https://dydasoftware.atlassian.net/browse/ERD-15) - Middleware de autorizacion RBAC por rol y entidad (guard reutilizable requirePermission)

### [0.8.0] - 2026-08-27
#### [add]
- [ERD-14](https://dydasoftware.atlassian.net/browse/ERD-14) - Autenticacion propia JWT + bcrypt sobre tabla users (login + endpoint protegido de ejemplo)

### [0.7.0] - 2026-08-27
#### [add]
- [ERD-12](https://dydasoftware.atlassian.net/browse/ERD-12) - Row-Level Security (RLS) sobre tenant_id en entities, records, relation_definitions, record_relations y roles

### [0.6.0] - 2026-08-27
#### [add]
- [ERD-11](https://dydasoftware.atlassian.net/browse/ERD-11) - Crear roles y role_entity_permissions (RBAC por tenant)

### [0.5.0] - 2026-08-27
#### [add]
- [ERD-10](https://dydasoftware.atlassian.net/browse/ERD-10) - Crear relation_definitions y record_relations (edge tables) con triggers de integridad

### [0.4.0] - 2026-08-27
#### [add]
- [ERD-9](https://dydasoftware.atlassian.net/browse/ERD-9) - Crear tabla records (almacenamiento generico)

### [0.3.0] - 2026-08-27
#### [add]
- [ERD-8](https://dydasoftware.atlassian.net/browse/ERD-8) - Crear tabla entity_field_history (auditoria de metadatos)

### [0.2.0] - 2026-08-27
#### [add]
- [ERD-6](https://dydasoftware.atlassian.net/browse/ERD-6) - Configurar Drizzle ORM y migraciones iniciales
- [ERD-7](https://dydasoftware.atlassian.net/browse/ERD-7) - Crear esquema de entities y entity_fields (diccionario de datos)

### [0.1.0] - 2026-08-27
#### [add]
- [ERD-13](https://dydasoftware.atlassian.net/browse/ERD-13) - Setup inicial del proyecto Nuxt 3 + Nitro

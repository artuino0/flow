# Changelog

### [0.31.0] - 2026-08-30
#### [fix]
- Aplicar el diseño real de ERPDinamico.pen (Pencil) a toda la app autenticada, no solo a pages/login.vue (HU-ERD-24 en adelante). Se habia aplicado el diseño una sola vez, al login (tarea previa "Aplicar diseño de Login"), y el resto de las pantallas se quedaron con Tailwind genérico. Extendida la paleta `brand` en tailwind.config.ts con los tokens que faltaban del .pen (success/warning/info/neutral/purple/pink/sidebar-active-bg), leídos directamente de las variables del archivo de diseño. Rediseñados: layouts/default.vue (AppHeader real: logo, nombre de la app, notificación, avatar con iniciales, botón salir), components/AppNav.vue (Sidebar con secciones GENERAL/DIRECTORIO/ADMINISTRACIÓN, item activo con borde izquierdo azul), components/DynamicTable.vue y components/DynamicForm.vue (Table Header Row/Table Row/Pagination Item y Field/Text del .pen), pages/registros/[entity]/index.vue (toolbar con badge de conteo y botón "Crear nuevo"), pages/registros/[entity]/nuevo.vue y [id]/editar.vue (Card + botones Primary/Outline), pages/dashboard/index.vue (métricas como Card con icon box) y pages/roles/* (misma tabla, badges de tipo de rol). El texto y la lógica de cada pantalla no cambiaron - se preservaron literalmente los strings que valida test/e2e/crudEntities.test.ts (ej. "Roles y permisos", "Usuarios activos", los mensajes de error). El buscador y los chips de filtro del diseño de Screen/List Clientes se omitieron a propósito: el backend todavía no soporta busqueda ni filtros por campo, agregar controles decorativos sin funcionalidad real hubiera sido engañoso. El mock de Screen/Dashboard (Facturas/Pedidos/Proveedores) tampoco se copió literal - se siguió el look (Card + icon box) aplicado a las métricas reales de HU-ERD-31 (eventos/clientes/sucursales/usuarios). Quedan sin disenar las pantallas del "Module Builder" del .pen (crear entidades/campos visualmente) porque esa funcionalidad no existe en el codigo - el proyecto la resolvio distinto, via scripts/seed.mjs. Validado con la suite completa: 65/65 tests (incluye los 22 casos e2e reales sobre el server compilado), `npx nuxt typecheck` limpio, `nuxt build` OK.

### [0.30.0] - 2026-08-30
#### [add]
- [ERD-35](https://dydasoftware.atlassian.net/browse/ERD-35) - Configuracion por entorno ("Core + Config"): mismo build sirve distintos deployments segun variables de entorno, sin rebuild. `APP_MODE` (`saas`, default, multi-tenant - login pide "Organizacion"; `dedicated` - instancia de un solo cliente, el login resuelve el unico tenant solo y oculta el campo, falla con 500 si la base no tiene exactamente un tenant) y feature flags por convencion `FEATURE_<NOMBRE>` (habilitados por default; `false`/`0` los apaga) - `FEATURE_DASHBOARD` apaga GET /api/dashboard/metrics (HU-ERD-31, 404 real) y oculta el link/pantalla (HU-ERD-34) de punta a punta, no solo cosmetico. Logica pura en server/utils/appConfig.ts (getAppMode/isFeatureEnabled, testeable con vitest normal sin contexto de Nitro). `.env.example` documenta APP_MODE, FEATURE_DASHBOARD y variables de branding reservadas (APP_BRAND_PRIMARY_COLOR/LOGO_URL, sin aplicar a la UI todavia). Validado con `test/unit/appConfig.test.ts` (7 casos) y un describe e2e nuevo en `test/e2e/crudEntities.test.ts` que levanta un segundo server compilado con `APP_MODE=dedicated`/`FEATURE_DASHBOARD=false` reales (login sin tenantId, 404 del endpoint, SSR sin "Dashboard" ni campo "Organizacion", 500 si hay mas de un tenant). Suite completa: 65 tests.
#### [fix]
- Hallazgo de arquitectura validando esta misma HU con el e2e de arriba: `runtimeConfig.public` de Nuxt (donde vivian originalmente `appMode`/`featureFlags`) se resuelve UNA sola vez cuando corre `nuxt build` y queda horneado en el output - levantar el server compilado con otro valor de APP_MODE/FEATURE_DASHBOARD despues NO lo actualizaba (Nuxt solo permite sobreescribir esas claves en runtime con su propia convencion `NUXT_PUBLIC_<CLAVE>`, no con los nombres de variable que usa el resto del proyecto). Sin este fix, el criterio de aceptacion central de la HU ("APP_MODE leido en runtime, sin rebuild") habria fallado silenciosamente en cualquier deployment real. Corregido con GET /api/config (server/api/config.get.ts, ruta publica) que recalcula la config fresca en cada request llamando a las mismas funciones puras, consumido desde el frontend via composables/useDeploymentConfig.ts (`useFetch`) en vez de `useRuntimeConfig()`. De paso, `nuxt typecheck` detecto que el nombre original del composable (`useAppConfig`) colisiona con el `useAppConfig()` propio de Nuxt (atado a `app.config.ts`) - renombrado a `useDeploymentConfig` antes de cualquier uso real.

### [0.29.0] - 2026-08-30
#### [add]
- [ERD-34](https://dydasoftware.atlassian.net/browse/ERD-34) - Dashboard interno OLAP (UI): pages/dashboard/index.vue consume GET /api/dashboard/metrics (HU-ERD-31) con filtros de rango de fechas y tipo de evento. Dos visualizaciones sobre "eventos por tipo": un grafico de barras horizontal (CSS, sin agregar una libreria de charts nueva al proyecto) y una tabla, mas 4 tarjetas resumen (eventos, clientes, sucursales, usuarios activos/total). "Filtrable por tenant si aplica" (criterio de aceptacion) - no aplica: el tenant sale siempre del JWT, misma decision de alcance documentada en HU-ERD-31. AppNav.vue suma el link "Dashboard" a la seccion "Administracion" (mismo guard que "Roles y permisos", HU-ERD-33 - los dos endpoints comparten requireAdminRole, alcanza con probar uno solo). Validado con 3 casos e2e nuevos (HU-ERD-30) - incluye el caso de fact_eventos vacio (agregacion sin datos no explota) y el render SSR con cookie (sin JS de cliente, mismo chequeo que el fix de HU-ERD-32). Suite completa: 53 tests.
#### [add]
- [ERD-33](https://dydasoftware.atlassian.net/browse/ERD-33) - UI de gestion de roles y permisos. Backend nuevo (no existia): GET /api/roles (listado), GET/PUT /api/roles/:id/permissions (matriz de can_read/can_create/can_update/can_delete por entidad, upsert sobre role_entity_permissions) - logica en server/utils/rolePermissions.ts, testeable sin HTTP. Cada entityId del body de PUT se revalida server-side contra las entidades del tenant autenticado antes de guardar nada (todo o nada, nunca un guardado parcial con un entityId ajeno). Guard: requireAdminRole (HU-ERD-61), mismo criterio que el resto de pantallas de administracion. Frontend: pages/roles/index.vue (listado) y pages/roles/[id].vue (matriz de checkboxes por entidad, guardado con feedback de exito/error). AppNav.vue suma una seccion "Administracion" con el link, visible solo si GET /api/roles no da 403 (mismo patron de HU-ERD-32 para los links del Directorio).

- Validado con `test/integration/rolePermissions.test.ts` (Postgres real embebido, HU-ERD-29): valores default en false, aislamiento estricto entre tenants (ni por id de rol ni por id de entidad), upsert correcto, y que un guardado con un entityId de otro tenant no persiste NADA (ni siquiera las entidades validas del mismo request). Ademas 8 casos e2e nuevos (HU-ERD-30) contra el server compilado real: el auto-grant de scripts/seed.mjs se ve reflejado, un PUT real persiste entre requests, las pantallas /roles y /roles/:id renderizan bien en SSR (con cookie, sin JS de cliente), y los casos negativos (401 sin cookie, 404 con entityId ajeno).
#### [add]
- [ERD-32](https://dydasoftware.atlassian.net/browse/ERD-32) - UI del modulo CRM (Clientes/Empresas/Empleados): reusa integramente el Form Builder y Table Builder dinamicos de HU-ERD-23/24 (`pages/registros/:entity/*`) - no se crearon pantallas nuevas, ya funcionaban para cualquier slug de entidad. Lo que agrega esta HU es la navegacion: components/AppNav.vue ahora muestra los 3 links del "Directorio" resolviendo cada uno contra GET /api/entities/:slug/fields (HU-ERD-23/24) y filtrando por el resultado (403/404 => el link no se muestra), asi que el menu respeta el RBAC del usuario logueado sin adelantarse a HU-ERD-43/44 (menu dinamico generico para cualquier entidad).

#### [fix]
- Bug de forwarding de cookie en SSR encontrado al validar esta HU: useEntityFields.ts (HU-ERD-23) y el useFetch de registros en pages/registros/:entity/index.vue y [id]/editar.vue (HU-ERD-24) no reenviaban la cookie httpOnly de la request original al pegarle a la API interna durante el render en servidor (mismo problema que useAuth.ts SI resolvia desde HU-ERD-22, con `useRequestHeaders(['cookie'])`, pero que no se habia replicado en estos otros composables/paginas). Efecto real: un refresh completo (F5, no una navegacion por link) de cualquier pantalla de /registros/:entity mostraba "no se pudo cargar" con la sesion activa. Corregido replicando el mismo fix en los 4 lugares afectados (incluido el AppNav nuevo). Validado con un e2e real (HTTP con cookie, sin JS de cliente - exactamente lo que hace un F5) que antes del fix habria fallado.
#### [add]
- [ERD-31](https://dydasoftware.atlassian.net/browse/ERD-31) - GET /api/dashboard/metrics: metricas de uso del dashboard interno, agregadas desde el esquema OLAP (dim_cliente/dim_sucursal/fact_eventos, HU-ERD-27/28) del tenant autenticado - total y monto de eventos (con desglose por tipo_evento), total de clientes/sucursales, y usuarios totales/activos (esto ultimo desde la tabla transaccional `users`, ya que el esquema OLAP no tiene una dimension de usuario - ver DOCS/Esquema_OLAP.md). Filtrable por rango de fechas (from/to, contra dim_date) y por tipo_evento. Protegido con el mismo guard que la configuracion general del tenant (requireAdminRole, HU-ERD-61: rol roles.isSystem) - el tenant sale siempre del JWT, no hay un query param para elegir tenant porque el sistema no define (todavia) un concepto de admin global/staff; documentado como decision de alcance. Logica extraida a server/utils/dashboardMetrics.ts (testeable sin HTTP, mismo patron que HU-ERD-17/28) y validada con Postgres real embebido (HU-ERD-29): agregacion correcta, filtro de fechas, filtro de tipo, y aislamiento real entre tenants.

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

# Changelog

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

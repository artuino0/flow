# Changelog

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

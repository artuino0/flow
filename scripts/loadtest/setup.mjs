/**
 * Prepara una base de datos SEPARADA (erp_load) con datos sintéticos para medir
 * concurrencia: 1,000 organizaciones, cada una con 1 administrador con sesión, 6
 * módulos con 6 campos y permisos; 10 organizaciones "grandes" (100 mil registros
 * cada una) y 990 chicas (~500). Total ~1.5 millones de registros.
 *
 * NO toca tu base de desarrollo: crea (o recrea) `erp_load` en el mismo servidor
 * Postgres local. Requiere DATABASE_URL (rol erp_admin, servidor local).
 *
 * Uso: node --env-file=.env scripts/loadtest/setup.mjs
 * Luego: ver scripts/loadtest/run.mjs
 */
import postgres from 'postgres'
import fs from 'node:fs'
import path from 'node:path'

const TENANTS = Number(process.env.LOAD_TENANTS || 1000)
const BIG = Number(process.env.LOAD_BIG_TENANTS || 10)
const BIG_RECORDS_PER_ENTITY = Number(process.env.LOAD_BIG_PER_ENTITY || 16666)
const SMALL_RECORDS_PER_ENTITY = Number(process.env.LOAD_SMALL_PER_ENTITY || 83)

const base = new URL(process.env.DATABASE_URL)
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Solo contra un Postgres local')
const step = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`)

const host = postgres(base.toString(), { max: 1, onnotice: () => {} })
await host.unsafe('DROP DATABASE IF EXISTS erp_load WITH (FORCE)')
await host.unsafe('CREATE DATABASE erp_load')
await host.end()

const url = new URL(base.toString()); url.pathname = '/erp_load'
const sql = postgres(url.toString(), { max: 1, onnotice: () => {}, idle_timeout: 0 })

step('extensiones, permisos y migraciones')
await sql.unsafe('CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "pg_trgm"')
await sql.unsafe('GRANT USAGE ON SCHEMA public TO erp_app')
await sql.unsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app')
await sql.unsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app')
const migrations = path.resolve(import.meta.dirname, '../../server/db/migrations')
for (const file of fs.readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) await sql.unsafe(fs.readFileSync(path.join(migrations, file), 'utf8'))

step(`${TENANTS} organizaciones, usuarios, sesiones, módulos y permisos`)
await sql.unsafe(`
  CREATE TEMP TABLE lt AS SELECT g AS n, gen_random_uuid() AS tenant_id FROM generate_series(1, ${TENANTS}) g;
  INSERT INTO tenants (id, name, slug) SELECT tenant_id, 'Load ' || n, 'load-' || n FROM lt;
  INSERT INTO roles (tenant_id, name, is_system) SELECT tenant_id, 'Administrador', true FROM lt;
  INSERT INTO people (email, password_hash, full_name) SELECT 'u' || n || '@load.test', 'x', 'Usuario ' || n FROM lt;
  INSERT INTO users (tenant_id, person_id, role_id, is_active)
    SELECT lt.tenant_id, p.id, r.id, true FROM lt
    JOIN people p ON p.email = 'u' || lt.n || '@load.test'
    JOIN roles r ON r.tenant_id = lt.tenant_id;
  INSERT INTO auth_sessions (tenant_id, user_id, expires_at) SELECT tenant_id, id, now() + interval '30 days' FROM users;
  INSERT INTO entities (tenant_id, name, slug)
    SELECT lt.tenant_id, m.name, m.slug FROM lt CROSS JOIN (VALUES
      ('Clientes','clientes'),('Productos','productos'),('Pedidos','pedidos'),('Facturas','facturas'),('Tareas','tareas'),('Contactos','contactos')
    ) AS m(name, slug);
  INSERT INTO entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
    SELECT e.id, f.name, f.label, f.data_type, f.rules::jsonb, f.required, f.ord FROM entities e CROSS JOIN (VALUES
      ('nombre','Nombre','text','{}',true,0), ('correo','Correo','text','{}',false,1),
      ('estado','Estado','select','{"options":[{"value":"activo","label":"Activo"},{"value":"inactivo","label":"Inactivo"}]}',false,2),
      ('monto','Monto','currency','{}',false,3), ('fecha','Fecha','date','{}',false,4), ('notas','Notas','text','{}',false,5)
    ) AS f(name, label, data_type, rules, required, ord);
  INSERT INTO role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
    SELECT r.id, e.id, true, true, true, true FROM roles r JOIN entities e ON e.tenant_id = r.tenant_id;
`)

step('quitando el índice GIN para cargar rápido')
await sql.unsafe('DROP INDEX IF EXISTS records_custom_data_gin_idx')
step(`registros: ${BIG} organizaciones grandes x 6 x ${BIG_RECORDS_PER_ENTITY} + ${TENANTS - BIG} chicas x 6 x ${SMALL_RECORDS_PER_ENTITY}`)
await sql.unsafe(`
  INSERT INTO records (tenant_id, entity_id, custom_data, created_at, updated_at)
  SELECT e.tenant_id, e.id,
    jsonb_build_object(
      'nombre', 'Empresa ' || substr(md5(random()::text), 1, 10),
      'correo', 'c' || g || '@ejemplo.com',
      'estado', CASE WHEN random() < 0.8 THEN 'activo' ELSE 'inactivo' END,
      'monto', to_char(random() * 10000, 'FM9999990.00'),
      'fecha', to_char(date '2026-01-01' + (random() * 260)::int, 'YYYY-MM-DD'),
      'notas', 'Nota ' || md5(random()::text) || md5(random()::text)),
    now() - random() * interval '200 days', now() - random() * interval '30 days'
  FROM entities e JOIN lt ON lt.tenant_id = e.tenant_id
  CROSS JOIN LATERAL generate_series(1, CASE WHEN lt.n <= ${BIG} THEN ${BIG_RECORDS_PER_ENTITY} ELSE ${SMALL_RECORDS_PER_ENTITY} END) g
`)
step('recreando el índice GIN y analizando')
// En Docker /dev/shm es de 64 MB: los procesos paralelos de mantenimiento fallan con "No space left on device".
await sql.unsafe('SET max_parallel_maintenance_workers = 0')
await sql.unsafe('ALTER DATABASE erp_load SET max_parallel_maintenance_workers = 0')
await sql.unsafe("SET maintenance_work_mem = '256MB'")
await sql.unsafe('CREATE INDEX records_custom_data_gin_idx ON records USING gin (custom_data)')
await sql.unsafe('VACUUM ANALYZE')
const [{ tenants, records, size }] = await sql`select (select count(*)::int from tenants) as tenants, (select count(*)::int from records) as records, pg_size_pretty(pg_database_size('erp_load')) as size`
step(`listo: ${tenants} organizaciones, ${records} registros, base de ${size}`)
await sql.end()

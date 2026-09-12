import postgres from 'postgres'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// HU-ERD-29: fixture de Postgres real para tests de integracion (RLS, etc.).
// Usa embedded-postgres (Postgres real embebido, sin Docker) en vez de pglite:
// pglite corre siempre como superusuario, y Postgres SIEMPRE bypassea RLS
// para superusuarios (con o sin FORCE ROW LEVEL SECURITY) - no sirve para
// probar que el aislamiento por tenant_id funciona de verdad. Esto crea un
// Postgres real, con un rol erp_app real (no superusuario), igual que
// producción - unico modo de que "confirma aislamiento... incluso si el
// filtro de Drizzle se omite" sea una prueba real y no un acto de fe.
//
// El bootstrap (extensiones + rol erp_app) replica erp-dinamico-database/
// init/001_extensions.sql y init/002_app_role.sql - son repos separados, asi
// que esto se mantiene sincronizado a mano; si esos scripts cambian, replicar
// el cambio aca tambien.

const MIGRATIONS_DIR = path.resolve(__dirname, '../../server/db/migrations')

export interface TestDb {
  /** Conexion como erp_admin (superusuario) - migraciones, setup. */
  adminUrl: string
  /** Conexion como erp_app (sin superusuario) - la app real usa este rol, RLS aplica. */
  appUrl: string
  stop(): Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  if (process.env.TEST_POSTGRES_ADMIN_URL) return createExternalTestDb(process.env.TEST_POSTGRES_ADMIN_URL)
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const port = 40000 + Math.floor(Math.random() * 10000)
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-pg-'))

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'erp_admin',
    password: 'changeme',
    port,
    persistent: false
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase('erp_dinamico_test')

  const adminUrl = `postgresql://erp_admin:changeme@localhost:${port}/erp_dinamico_test`
  const appUrl = `postgresql://erp_app:changeme_app@localhost:${port}/erp_dinamico_test`

  const admin = postgres(adminUrl, { onnotice: () => {} })
  try {
    // ---- mirror de init/001_extensions.sql ----
    await admin.unsafe('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    await admin.unsafe('CREATE EXTENSION IF NOT EXISTS "pg_trgm"')

    // ---- mirror de init/002_app_role.sql ----
    await admin.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
          CREATE ROLE erp_app LOGIN PASSWORD 'changeme_app' NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END
      $$;
    `)
    await admin.unsafe('GRANT USAGE ON SCHEMA public TO erp_app')
    await admin.unsafe('ALTER DEFAULT PRIVILEGES FOR ROLE erp_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app')
    await admin.unsafe('ALTER DEFAULT PRIVILEGES FOR ROLE erp_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app')

    // ---- migraciones reales del proyecto, en orden ----
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      await admin.unsafe(sqlText)
    }
  } finally {
    await admin.end()
  }

  return {
    adminUrl,
    appUrl,
    async stop() {
      await pg.stop()
      fs.rmSync(databaseDir, { recursive: true, force: true })
    }
  }
}

// Optional local Docker PostgreSQL fallback when embedded binaries are absent.
// Every suite gets a fresh database; the application database is never used.
async function createExternalTestDb(connection: string): Promise<TestDb> {
  const url = new URL(connection)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('La base de pruebas debe ser local')
  const databaseName = 'flowerp_test_' + randomUUID().replaceAll('-', '')
  const host = postgres(connection)
  await host.unsafe(`CREATE DATABASE "${databaseName}"`)
  url.pathname = '/' + databaseName
  const adminUrl = url.toString()
  const admin = postgres(adminUrl, { onnotice: () => {} })
  async function stop() {
    await host.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await host.end()
  }
  try {
    await admin.unsafe('CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "pg_trgm"')
    await admin.unsafe('GRANT USAGE ON SCHEMA public TO erp_app')
    await admin.unsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app')
    await admin.unsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app')
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql')).sort()) {
      await admin.unsafe(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    }
  } catch (error) {
    await admin.end()
    await stop()
    throw error
  }
  await admin.end()
  url.username = 'erp_app'
  url.password = process.env.TEST_POSTGRES_APP_PASSWORD || 'changeme_app'
  return { adminUrl, appUrl: url.toString(), stop }
}

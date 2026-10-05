import postgres from 'postgres'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomInt, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'

// HU-ERD-29: fixture de Postgres real para tests de integracion (RLS, etc.).
// Usa embedded-postgres (Postgres real embebido, sin Docker) en vez de pglite:
// pglite corre siempre como superusuario, y Postgres SIEMPRE bypassea RLS
// para superusuarios (con o sin FORCE ROW LEVEL SECURITY) - no sirve para
// probar que el aislamiento por tenant_id funciona de verdad. Esto crea un
// Postgres real, con un rol erp_app real (no superusuario), igual que
// producción - unico modo de que "confirma aislamiento... incluso si el
// filtro de Drizzle se omite" sea una prueba real y no un acto de fe.
//
// El bootstrap (extensiones + roles) replica erp-dinamico-database/
// init/001_extensions.sql y init/002_app_role.sql - son repos separados, asi
// que esto se mantiene sincronizado a mano; si esos scripts cambian, replicar
// el cambio aca tambien.
// BUG-ERD-188: el migrador es erp_owner NOSUPERUSER BYPASSRLS; erp_admin
// se usa exclusivamente para bootstrap/fixtures, nunca para migrar.

const MIGRATIONS_DIR = path.resolve(__dirname, '../../server/db/migrations')

async function reserveTestPort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const server = createServer()
    const port = randomInt(20000, 40000)
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
      })
      return { port, server }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error
    }
  }
  throw new Error('No se encontró un puerto disponible para PostgreSQL de pruebas')
}

export interface TestDb {
  /** Conexion de bootstrap (superusuario) - solo fixtures y administración local. */
  adminUrl: string
  /** Propietario no superusuario con BYPASSRLS - todas las migraciones reales. */
  ownerUrl: string
  /** Conexion como erp_app (sin superusuario) - la app real usa este rol, RLS aplica. */
  appUrl: string
  stop(): Promise<void>
}

export async function createTestDb(options: { preserveFiles?: boolean; throughMigration?: string } = {}): Promise<TestDb> {
  if (options.preserveFiles && process.env.TEST_POSTGRES_ADMIN_URL) throw new Error('Esta prueba requiere PostgreSQL embebido')
  if (process.env.TEST_POSTGRES_ADMIN_URL) return createExternalTestDb(process.env.TEST_POSTGRES_ADMIN_URL, options)
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  // Evita rangos reservados y el rango efímero de clientes de Windows; reserva durante initdb.
  const { port, server } = await reserveTestPort()
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-pg-'))

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'erp_admin',
    password: 'changeme',
    port,
    persistent: options.preserveFiles === true
  })

  try { await pg.initialise() }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  await pg.start()
  await pg.createDatabase('erp_dinamico_test')

  const adminUrl = `postgresql://erp_admin:changeme@localhost:${port}/erp_dinamico_test`
  const appUrl = `postgresql://erp_app:changeme_app@localhost:${port}/erp_dinamico_test`
  const ownerUrl = `postgresql://erp_owner:changeme_owner@localhost:${port}/erp_dinamico_test`

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
    await migrateAsOwner(admin, ownerUrl, options.throughMigration)
  } catch (error) {
    await pg.stop()
    throw error
  } finally {
    await admin.end()
  }

  return {
    adminUrl,
    ownerUrl,
    appUrl,
    async stop() {
      await pg.stop()
      if (!options.preserveFiles) {
        const target = path.resolve(databaseDir)
        if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('erp-test-pg-')) throw new Error('Directorio de pruebas fuera del temporal autorizado')
        // Los procesos hijos de PostgreSQL pueden liberar archivos después de salir el padre en Windows.
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
      }
    }
  }
}

// Optional local Docker PostgreSQL fallback when embedded binaries are absent.
// Every suite gets a fresh database; the application database is never used.
async function createExternalTestDb(connection: string, options: { throughMigration?: string }): Promise<TestDb> {
  const url = new URL(connection)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('La base de pruebas debe ser local')
  const databaseName = 'flowerp_test_' + randomUUID().replaceAll('-', '')
  const host = postgres(connection)
  await host.unsafe(`CREATE DATABASE "${databaseName}"`)
  url.pathname = '/' + databaseName
  const adminUrl = url.toString()
  const admin = postgres(adminUrl, { onnotice: () => {} })
  const ownerConnection = new URL(adminUrl)
  ownerConnection.username = 'erp_owner'
  ownerConnection.password = 'changeme_owner'
  const ownerUrl = ownerConnection.toString()
  async function stop() {
    await host.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await host.end()
  }
  try {
    await admin.unsafe('CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "pg_trgm"')
    await migrateAsOwner(admin, ownerUrl, options.throughMigration)
  } catch (error) {
    await admin.end()
    await stop()
    throw error
  }
  await admin.end()
  url.username = 'erp_app'
  url.password = process.env.TEST_POSTGRES_APP_PASSWORD || 'changeme_app'
  return { adminUrl, ownerUrl, appUrl: url.toString(), stop }
}

async function migrateAsOwner(admin: postgres.Sql, ownerUrl: string, throughMigration?: string) {
  // El superusuario solo prepara extensiones/roles; no ejecuta SQL de migraciones.
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_owner') THEN
      CREATE ROLE erp_owner LOGIN PASSWORD 'changeme_owner' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
    END IF;
  END $$`)
  const [database] = await admin`select current_database() as name`
  await admin.unsafe(`ALTER DATABASE "${String(database!.name).replaceAll('"', '""')}" OWNER TO erp_owner`)
  await admin.unsafe('ALTER SCHEMA public OWNER TO erp_owner')
  await admin.unsafe('GRANT USAGE ON SCHEMA public TO erp_app')
  await admin.unsafe('ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app')
  await admin.unsafe('ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app')
  const owner = postgres(ownerUrl, { onnotice: () => {} })
  try {
    const [role] = await owner`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`
    if (!role || role.rolsuper || !role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) throw new Error('El migrador debe ser propietario no superusuario con BYPASSRLS')
    const [app] = await owner`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'erp_app'`
    if (!app || app.rolsuper || app.rolbypassrls || app.rolcreatedb || app.rolcreaterole) throw new Error('erp_app debe carecer de privilegios especiales')
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql') && (!throughMigration || file <= throughMigration)).sort()) {
      await owner.begin(async tx => { await tx.unsafe(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')) })
    }
  } finally {
    await owner.end()
  }
}

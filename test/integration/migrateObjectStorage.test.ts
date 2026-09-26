import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

let testDb: TestDb
let admin: postgres.Sql
let root: string
const tenantId = randomUUID()
const entityId = randomUUID()
const fileId = randomUUID()
const oldKey = `${tenantId}/${fileId}-factura.pdf`

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'erd98-migration-'))
  await admin`insert into tenants (id, name) values (${tenantId}, 'Migración de prueba')`
  await admin`insert into entities (id, tenant_id, name, slug) values (${entityId}, ${tenantId}, 'Prueba', 'prueba')`
  await admin`insert into files (id, tenant_id, entity_id, file_name, mime_type, size_bytes, storage_key) values (${fileId}, ${tenantId}, ${entityId}, 'factura.pdf', 'application/pdf', 9, ${oldKey})`
  await fs.mkdir(path.join(root, tenantId), { recursive: true })
  await fs.writeFile(path.join(root, ...oldKey.split('/')), 'contenido')
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
  await fs.rm(root, { recursive: true, force: true })
})

function runMigration(dryRun = false) {
  return spawnSync(process.execPath, [path.resolve('scripts/migrate-files-to-object-storage.mjs'), ...(dryRun ? ['--dry-run'] : [])], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, DATABASE_URL: testDb.adminUrl, STORAGE_DRIVER: 'local', FILES_STORAGE_DIR: root }
  })
}

describe('migrate-files-to-object-storage.mjs', () => {
  it('dry-run no modifica la base; ejecución copia y actualiza de forma idempotente', async () => {
    const dry = runMigration(true)
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toContain('copiaría')
    const [before] = await admin`select storage_key from files where id = ${fileId}`
    expect(before.storage_key).toBe(oldKey)

    const migrated = runMigration()
    expect(migrated.status, migrated.stderr).toBe(0)
    const [after] = await admin`select storage_key from files where id = ${fileId}`
    expect(after.storage_key).toBe(`tenants/${tenantId}/files/${fileId}-factura.pdf`)
    expect(await fs.readFile(path.join(root, ...after.storage_key.split('/')), 'utf8')).toBe('contenido')

    const second = runMigration()
    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).not.toContain('migrado')
  }, 60_000)
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createTestDb, type TestDb } from '../setup/testDb'

let testDb: TestDb
let admin: postgres.Sql
beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
}, 60_000)
afterAll(async () => { await admin.end(); await testDb.stop() })

function seed(script: string, args: string[]) {
  // Solo la base embebida: el proceso usa erp_app y todas las políticas reales.
  execFileSync(process.execPath, [fileURLToPath(new URL(`../../scripts/${script}`, import.meta.url)), ...args], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, DATABASE_URL: testDb.adminUrl, APP_DATABASE_URL: testDb.appUrl },
    stdio: 'pipe', timeout: 60_000
  })
}

describe('seeds internos con actor de sistema y RLS 0091', () => {
  for (const script of ['seedAgendaSuite.mjs', 'seedBusinessSuite.mjs']) {
    it(`${script} crea registros con erp_app y conserva la idempotencia`, async () => {
      const id = randomUUID()
      await admin`insert into tenants (id, name, slug) values (${id}, 'Seed aislado', ${`seed-${id}`})`
      await admin`insert into roles (tenant_id, name, is_system) values (${id}, 'Administrador', true)`
      seed(script, [id, '1'])
      const [before] = await admin`select count(*)::int as count from records where tenant_id = ${id}`
      expect(before.count).toBeGreaterThan(0)
      seed(script, [id, '1'])
      const [after] = await admin`select count(*)::int as count from records where tenant_id = ${id}`
      expect(after.count).toBe(before.count)
    }, 120_000)
  }
  it('seedSalmantino.mjs crea datos de demostración con erp_app', async () => {
    seed('seedSalmantino.mjs', [])
    const [row] = await admin`select count(*)::int as count from records r join tenants t on t.id = r.tenant_id where t.slug = 'grupo-agricola-salmantino'`
    expect(row.count).toBeGreaterThan(0)
  }, 60_000)
})

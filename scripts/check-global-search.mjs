// Read-only smoke checks against the local development server and database.
import 'dotenv/config'
import postgres from 'postgres'
import jwt from 'jsonwebtoken'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.APP_BASE_URL || 'http://localhost:3001'
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Solo se permite ejecutar esta prueba en desarrollo local')
const db = postgres(process.env.DATABASE_URL, { max: 1 })
try {
  const tenants = await db`select id from tenants`
  let fixture
  for (const tenant of tenants) {
    fixture = await db.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${tenant.id}, true), set_config('app.person_id', ${randomUUID()}, true)`
      const [row] = await tx`select u.id, u.role_id, u.tenant_id, r.id as record_id from users u
        join role_entity_permissions p on p.role_id=u.role_id and p.can_read=true
        join records r on r.entity_id=p.entity_id and r.tenant_id=u.tenant_id and r.deleted_at is null
        join entities e on e.id=r.entity_id and e.is_active=true
        where u.tenant_id=${tenant.id} and u.is_active=true limit 1`
      return row
    })
    if (fixture) break
  }
  assert.ok(fixture, 'Se necesita un registro de demostración legible')
  const payload = { sub: fixture.id, roleId: fixture.role_id, tenantId: fixture.tenant_id }
  async function search(query, overrides = {}) {
    const token = jwt.sign({ ...payload, ...overrides }, process.env.JWT_SECRET, { expiresIn: '1m' })
    const response = await fetch(`${base}/api/search?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /no-store/)
    return response.json()
  }
  assert.equal((await fetch(`${base}/api/search?q=test`)).status, 401)
  const found = await search({ q: fixture.record_id })
  assert.ok(found.results.some(r => r.id === fixture.record_id), 'Búsqueda exacta UUID')
  const recent = await search({ recent: fixture.record_id })
  assert.ok(recent.results.some(r => r.id === fixture.record_id), 'Recientes revalidados')
  const denied = await search({ recent: fixture.record_id }, { roleId: randomUUID() })
  assert.deepEqual(denied.results, [])
  assert.deepEqual(denied.commands, [])
  const foreign = await search({ recent: fixture.record_id }, { tenantId: randomUUID() })
  assert.deepEqual(foreign.results, [])
  assert.deepEqual(foreign.commands, [])
  const wildcard = await search({ q: "%' OR true --" })
  assert.deepEqual(wildcard.results, [])
  await db.begin(async tx => {
    await tx`set local enable_seqscan=off`
    const [index] = await tx`select indisvalid from pg_index where indexrelid='records_global_search_trgm_idx'::regclass`
    assert.equal(index.indisvalid, true, 'Índice válido; el planificador elige según el volumen de datos')
  })
  console.log('OK: autenticación, UUID, recientes, aislamiento entre empresas, permisos, caracteres especiales e índice.')
} finally { await db.end() }

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

// HU-ERD-30: e2e real - HTTP -> Nitro compilado -> Drizzle -> Postgres real
// (embedded-postgres, la misma infraestructura de HU-ERD-29), no unit tests
// que invocan la logica del handler a mano. Se compila la app una vez
// (`nuxt build`, igual que produccion) y se levanta el server resultante
// (.output/server/index.mjs) como proceso hijo apuntando a la base de test
// aislada via APP_DATABASE_URL - "sin filtro de Drizzle omitido" no aplica
// aca (eso ya lo prueba HU-ERD-29): esto prueba el flujo completo tal como lo
// ve un cliente real (login -> cookie -> CRUD).
//
// Costo conocido y aceptado: esto agrega un `nuxt build` completo (~30s) a la
// corrida de `npm run test`, ademas del que ya hace el stage "build" de CI -
// se prefirio antes que fingir un "e2e" que en realidad solo pega contra
// funciones de servidor invocadas directamente.

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const SEED_SCRIPT = path.resolve(PROJECT_ROOT, 'scripts/seed.mjs')

const TENANT_ID = randomUUID()
const ADMIN_EMAIL = 'admin@e2e.test'
const ADMIN_PASSWORD = 'e2e-password-1234'

let testDb: TestDb
let server: ChildProcess
let baseUrl: string
let authCookie: string

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const address = srv.address()
      if (address && typeof address === 'object') {
        const { port } = address
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('No se pudo obtener un puerto libre')))
      }
    })
  })
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`El server no respondio en ${url} dentro de ${timeoutMs}ms: ${String(lastError)}`)
}

function extractCookie(res: Response): string {
  // getSetCookie() (Node >= 18.14 / undici reciente) devuelve el header
  // completo sin partir por comas (a diferencia de get('set-cookie')).
  const cookies = res.headers.getSetCookie?.() ?? []
  const raw = cookies[0] ?? res.headers.get('set-cookie')
  if (!raw) throw new Error('La respuesta de login no trajo Set-Cookie')
  return raw.split(';')[0]
}

async function api(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathAndQuery}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: authCookie,
      ...(init.headers ?? {})
    }
  })
}

/**
 * Flujo e2e completo (crear, leer, actualizar, eliminar) para una entidad de
 * ejemplo - un flujo por entidad, por criterio de aceptacion de HU-ERD-30.
 */
async function crudFlow(slug: string, createPayload: Record<string, unknown>, updatePayload: Record<string, unknown>) {
  const createRes = await api(`/api/records/${slug}`, {
    method: 'POST',
    body: JSON.stringify({ customData: createPayload })
  })
  expect(createRes.status).toBe(201)
  const created = await createRes.json()
  expect(created.id).toBeTruthy()
  expect(created.customData).toMatchObject(createPayload)

  const getRes = await api(`/api/records/${slug}/${created.id}`)
  expect(getRes.status).toBe(200)
  const fetched = await getRes.json()
  expect(fetched.customData).toMatchObject(createPayload)

  const putRes = await api(`/api/records/${slug}/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ customData: updatePayload })
  })
  expect(putRes.status).toBe(200)
  const updated = await putRes.json()
  expect(updated.customData).toMatchObject(updatePayload)

  const getAfterUpdateRes = await api(`/api/records/${slug}/${created.id}`)
  const fetchedAfterUpdate = await getAfterUpdateRes.json()
  expect(fetchedAfterUpdate.customData).toMatchObject(updatePayload)

  const listRes = await api(`/api/records/${slug}?pageSize=100`)
  expect(listRes.status).toBe(200)
  const list = await listRes.json()
  expect(list.data.some((r: { id: string }) => r.id === created.id)).toBe(true)

  const deleteRes = await api(`/api/records/${slug}/${created.id}`, { method: 'DELETE' })
  expect(deleteRes.status).toBe(200)
  expect((await deleteRes.json()).deleted).toBe(true)

  const getAfterDeleteRes = await api(`/api/records/${slug}/${created.id}`)
  expect(getAfterDeleteRes.status).toBe(404)

  const deleteAgainRes = await api(`/api/records/${slug}/${created.id}`, { method: 'DELETE' })
  expect(deleteAgainRes.status).toBe(404)
}

beforeAll(async () => {
  testDb = await createTestDb()

  // tenants no tiene RLS (HU-ERD-61); roles/users si, pero erp_admin es
  // superusuario (bypassea RLS) - no hace falta set_config para este seed.
  const admin = postgres(testDb.adminUrl)
  try {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
    await admin`insert into tenants (id, name) values (${TENANT_ID}, 'Tenant E2E')`
    const [role] = await admin`
      insert into roles (tenant_id, name, is_system) values (${TENANT_ID}, 'Administrador', true) returning id
    `
    await admin`
      insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
      values (${TENANT_ID}, ${role.id}, ${ADMIN_EMAIL}, ${passwordHash}, 'Admin E2E', true)
    `
  } finally {
    await admin.end()
  }

  // Entidades de ejemplo reales del modulo CRM/Directorio (HU-ERD-25), via el
  // script real de seed - no una copia a mano de su definicion. Corre con
  // APP_DATABASE_URL=appUrl (rol erp_app, RLS real), igual que en produccion.
  execFileSync('node', [SEED_SCRIPT, TENANT_ID, 'generico'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, APP_DATABASE_URL: testDb.appUrl },
    stdio: 'pipe'
  })

  // Build real (igual que produccion) - un "e2e" que solo llamara handlers a
  // mano no probaria el server compilado, el middleware de auth global, ni
  // el boot de Nitro.
  execFileSync('npx', ['nuxt', 'build'], { cwd: PROJECT_ROOT, stdio: 'pipe' })

  const port = await getFreePort()
  baseUrl = `http://localhost:${port}`

  server = spawn('node', ['.output/server/index.mjs'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NITRO_PORT: String(port),
      APP_DATABASE_URL: testDb.appUrl,
      JWT_SECRET: 'e2e-test-secret',
      OLAP_ETL_ENABLED: 'false',
      NODE_ENV: 'test'
    },
    stdio: 'pipe'
  })

  await waitForServer(`${baseUrl}/api/health`, 20_000)

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: TENANT_ID, email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  })
  expect(loginRes.status).toBe(200)
  authCookie = extractCookie(loginRes)
}, 180_000)

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      server.once('exit', () => resolve())
      server.kill('SIGTERM')
      setTimeout(() => {
        server.kill('SIGKILL')
        resolve()
      }, 5000)
    })
  }
  if (testDb) await testDb.stop()
}, 30_000)

describe('e2e: CRUD generico sobre entidades de ejemplo (server real + Postgres real)', () => {
  it('una request sin cookie/token es rechazada (401) - el middleware global de auth corre de verdad', async () => {
    const res = await fetch(`${baseUrl}/api/records/clientes`)
    expect(res.status).toBe(401)
  })

  it('Clientes: flujo completo crear/leer/actualizar/eliminar', async () => {
    await crudFlow(
      'clientes',
      { nombre: 'Cliente E2E', email: 'cliente@e2e.test' },
      { nombre: 'Cliente E2E Actualizado', email: 'cliente@e2e.test' }
    )
  })

  it('Empresas: flujo completo crear/leer/actualizar/eliminar', async () => {
    await crudFlow(
      'empresas',
      { razon_social: 'Empresa E2E S.A.' },
      { razon_social: 'Empresa E2E S.A. de C.V.' }
    )
  })

  it('Empleados: flujo completo crear/leer/actualizar/eliminar', async () => {
    await crudFlow(
      'empleados',
      { nombre_completo: 'Empleado E2E', puesto: 'QA' },
      { nombre_completo: 'Empleado E2E', puesto: 'QA Senior' }
    )
  })

  it('customData invalido para la entidad es rechazado (422) - el schema Zod dinamico corre de verdad', async () => {
    // "nombre" es requerido en Clientes (scripts/seed.mjs) - se omite a proposito.
    const res = await api('/api/records/clientes', {
      method: 'POST',
      body: JSON.stringify({ customData: { email: 'sin-nombre@e2e.test' } })
    })
    expect(res.status).toBe(422)
  })
})

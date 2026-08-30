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
let adminRoleId: string

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
    adminRoleId = role.id
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

  // HU-ERD-32: UI del modulo CRM (AppNav + paginas genericas de HU-ERD-23/24
  // reusadas para Clientes/Empresas/Empleados). Reusa el server ya levantado
  // arriba en vez de compilar/levantar uno nuevo. Pega con fetch crudo (no un
  // browser) pasando la cookie a mano - exactamente lo que hace un refresh
  // completo (F5), el escenario donde el bug de forwarding de cookie en SSR
  // (fix de esta misma HU en useEntityFields.ts/AppNav.vue/index.vue/editar.vue)
  // se manifestaba.
  it('SSR: la home renderiza los links de Clientes/Empresas/Empleados en el nav (AppNav filtra por RBAC via SSR)', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Clientes')
    expect(html).toContain('Empresas')
    expect(html).toContain('Empleados')
  })

  it('SSR: /registros/clientes (F5 completo, con cookie pero sin JS de cliente) renderiza el listado, no el estado de error', async () => {
    const res = await fetch(`${baseUrl}/registros/clientes`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('No se pudo cargar la definicion de esta entidad')
    expect(html).not.toContain('No se pudieron cargar los registros')
  })

  it('SSR: /registros/clientes/nuevo (F5 completo) renderiza el formulario, no el estado de error', async () => {
    const res = await fetch(`${baseUrl}/registros/clientes/nuevo`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('No se pudo cargar la definicion de esta entidad')
  })

  // HU-ERD-33: UI de gestion de roles y permisos. Reusa el server ya
  // levantado arriba (HU-ERD-30). El rol "Administrador" de este e2e ya tiene
  // CRUD completo sobre clientes/empresas/empleados porque scripts/seed.mjs
  // (HU-ERD-25) se lo otorga automaticamente al rol isSystem - por eso el
  // primer GET de permisos abajo espera todo en true, no el default false.
  it('SSR: la home ahora muestra "Roles y permisos" en el nav (admin real via GET /api/roles)', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Roles y permisos')
  })

  it('GET /api/roles lista el rol Administrador del tenant', async () => {
    const res = await api('/api/roles')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: adminRoleId, name: 'Administrador', isSystem: true })])
    )
  })

  it('GET /api/roles/:id/permissions refleja el auto-grant de scripts/seed.mjs (CRUD completo)', async () => {
    const res = await api(`/api/roles/${adminRoleId}/permissions`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const clientesRow = body.permissions.find((p: { entitySlug: string }) => p.entitySlug === 'clientes')
    expect(clientesRow).toMatchObject({ canRead: true, canCreate: true, canUpdate: true, canDelete: true })
  })

  it('PUT /api/roles/:id/permissions guarda cambios reales, persistidos entre requests', async () => {
    const before = await api(`/api/roles/${adminRoleId}/permissions`)
    const { permissions } = await before.json()
    const updated = permissions.map((p: Record<string, unknown>) =>
      p.entitySlug === 'empleados' ? { ...p, canDelete: false } : p
    )

    const putRes = await api(`/api/roles/${adminRoleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({
        permissions: updated.map((p: any) => ({
          entityId: p.entityId,
          canRead: p.canRead,
          canCreate: p.canCreate,
          canUpdate: p.canUpdate,
          canDelete: p.canDelete
        }))
      })
    })
    expect(putRes.status).toBe(200)

    const after = await api(`/api/roles/${adminRoleId}/permissions`)
    const afterBody = await after.json()
    expect(afterBody.permissions.find((p: { entitySlug: string }) => p.entitySlug === 'empleados')).toMatchObject({
      canDelete: false
    })

    // Deja el estado como estaba (canDelete: true) para no afectar los tests
    // de CRUD de "Empleados" de arriba si vitest los corriera en otro orden.
    await api(`/api/roles/${adminRoleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({
        permissions: permissions.map((p: any) => ({
          entityId: p.entityId,
          canRead: p.canRead,
          canCreate: p.canCreate,
          canUpdate: p.canUpdate,
          canDelete: p.canDelete
        }))
      })
    })
  })

  it('SSR: /roles y /roles/:id (F5 completo) renderizan contenido real, no el estado de error', async () => {
    const listRes = await fetch(`${baseUrl}/roles`, { headers: { cookie: authCookie } })
    expect(listRes.status).toBe(200)
    const listHtml = await listRes.text()
    expect(listHtml).toContain('Administrador')
    expect(listHtml).not.toContain('No se pudo cargar el listado de roles')

    const editRes = await fetch(`${baseUrl}/roles/${adminRoleId}`, { headers: { cookie: authCookie } })
    expect(editRes.status).toBe(200)
    const editHtml = await editRes.text()
    expect(editHtml).toContain('Clientes')
    expect(editHtml).not.toContain('No se pudo cargar este rol')
  })

  it('GET /api/roles sin cookie es 401, y PUT con un entityId de otro tenant es rechazado (404)', async () => {
    const noAuthRes = await fetch(`${baseUrl}/api/roles`)
    expect(noAuthRes.status).toBe(401)

    const putRes = await api(`/api/roles/${adminRoleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({
        permissions: [{ entityId: randomUUID(), canRead: true, canCreate: true, canUpdate: true, canDelete: true }]
      })
    })
    expect(putRes.status).toBe(404)
  })
})

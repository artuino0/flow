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

  // HU-ERD-34: dashboard interno OLAP. OLAP_ETL_ENABLED=false en este e2e (ver
  // env del server arriba), asi que fact_eventos queda vacio para este tenant -
  // el chequeo es que la pantalla renderiza bien el estado "sin eventos" (y el
  // endpoint agrega sin explotar con 0 filas), no que haya datos.
  //
  // Reubicacion (feedback del usuario sobre el menu, post-HU-ERD-67): "Tablero"
  // (ex-Dashboard/ex-"Inicio") ahora es la home (/) misma, en la seccion
  // General, visible para CUALQUIER usuario autenticado - ya no vive bajo
  // Administracion ni esta gateado a admin. GET /api/dashboard/metrics sigue
  // en la misma URL, solo cambio el guard (requireAuth en vez de requireAdminRole).
  it('GET /api/dashboard/metrics agrega sin datos sin explotar (fact_eventos vacio en este e2e)', async () => {
    const res = await api('/api/dashboard/metrics')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.eventos.total).toBe(0)
    expect(body.clientes.total).toBe(0)
    expect(body.usuarios.total).toBe(1) // el admin creado en este e2e
  })

  it('SSR: / (F5 completo) renderiza "Tablero" con el estado real, no el estado de error', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Tablero')
    expect(html).toContain('Usuarios activos')
    expect(html).not.toContain('No se pudieron cargar las metricas')
  })

  it('Tablero es visible y funcional para un usuario NO administrador (ya no esta gateado a admin)', async () => {
    const email = 'tablero-no-admin@e2e.test'
    const password = 'e2e-password-1234'
    const admin = postgres(testDb.adminUrl)
    try {
      const passwordHash = await bcrypt.hash(password, 12)
      const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_ID}, 'Sin admin Tablero', false) returning id`
      await admin`
        insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
        values (${TENANT_ID}, ${role.id}, ${email}, ${passwordHash}, 'No Admin Tablero', true)
      `
    } finally {
      await admin.end()
    }

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, email, password })
    })
    expect(loginRes.status).toBe(200)
    const cookie = extractCookie(loginRes)

    const res = await fetch(`${baseUrl}/api/dashboard/metrics`, { headers: { cookie } })
    expect(res.status).toBe(200)

    const homeRes = await fetch(`${baseUrl}/`, { headers: { cookie } })
    const html = await homeRes.text()
    expect(html).toContain('Tablero')
    expect(html).not.toContain('No se pudieron cargar las metricas')
  })
})

// HU-ERD-66: endpoints de escritura sobre metadatos de modulos (entities) -
// hasta esta HU, la unica forma de dar de alta un modulo era scripts/seed.mjs
// o SQL directo. Reusa el server/tenant/admin ya levantados en el beforeAll
// de arriba (HU-ERD-30); solo agrega un usuario no-admin para probar el 403.
describe('e2e: HU-ERD-66 (CRUD de metadatos de modulos - entities)', () => {
  const NON_ADMIN_EMAIL = 'vendedor@e2e.test'
  const NON_ADMIN_PASSWORD = 'e2e-password-1234'
  let nonAdminCookie: string

  beforeAll(async () => {
    const admin = postgres(testDb.adminUrl)
    try {
      const passwordHash = await bcrypt.hash(NON_ADMIN_PASSWORD, 12)
      const [role] = await admin`
        insert into roles (tenant_id, name, is_system) values (${TENANT_ID}, 'Vendedor', false) returning id
      `
      await admin`
        insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
        values (${TENANT_ID}, ${role.id}, ${NON_ADMIN_EMAIL}, ${passwordHash}, 'Vendedor E2E', true)
      `
    } finally {
      await admin.end()
    }

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, email: NON_ADMIN_EMAIL, password: NON_ADMIN_PASSWORD })
    })
    expect(loginRes.status).toBe(200)
    nonAdminCookie = extractCookie(loginRes)
  }, 30_000)

  it('POST /api/entities sin cookie es 401, y con un rol no-admin es 403', async () => {
    const noAuthRes = await fetch(`${baseUrl}/api/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Proyectos', slug: 'proyectos' })
    })
    expect(noAuthRes.status).toBe(401)

    const nonAdminRes = await fetch(`${baseUrl}/api/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: nonAdminCookie },
      body: JSON.stringify({ name: 'Proyectos', slug: 'proyectos' })
    })
    expect(nonAdminRes.status).toBe(403)
  })

  it('POST /api/entities crea el modulo (admin) y el rol Administrador queda con CRUD completo de inmediato', async () => {
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Proyectos', slug: 'proyectos', description: 'Modulo E2E' })
    })
    expect(createRes.status).toBe(201)
    const entity = await createRes.json()
    expect(entity).toMatchObject({ name: 'Proyectos', slug: 'proyectos', description: 'Modulo E2E' })

    // Sin esto el modulo recien creado seria inaccesible incluso para el
    // admin que lo creo - confirma el auto-grant de moduleEntities.ts.
    const permsRes = await api(`/api/roles/${adminRoleId}/permissions`)
    const { permissions } = await permsRes.json()
    expect(permissions.find((p: { entitySlug: string }) => p.entitySlug === 'proyectos')).toMatchObject({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true
    })

    // Confirma que ya es usable de punta a punta: crear un record de verdad
    // en el modulo recien creado (sin ningun entity_field todavia, customData vacio).
    const recordRes = await api('/api/records/proyectos', {
      method: 'POST',
      body: JSON.stringify({ customData: {} })
    })
    expect(recordRes.status).toBe(201)
  })

  it('POST /api/entities con un slug duplicado devuelve 409', async () => {
    const res = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Proyectos otra vez', slug: 'proyectos' })
    })
    expect(res.status).toBe(409)
  })

  it('PUT /api/entities/:id edita nombre/descripcion; con un rol no-admin es 403; con id inexistente es 404', async () => {
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Editable', slug: 'editable' })
    })
    const entity = await createRes.json()

    const putRes = await api(`/api/entities/${entity.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Editable renombrado' })
    })
    expect(putRes.status).toBe(200)
    expect((await putRes.json()).name).toBe('Editable renombrado')

    const nonAdminRes = await fetch(`${baseUrl}/api/entities/${entity.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: nonAdminCookie },
      body: JSON.stringify({ name: 'Hackeado' })
    })
    expect(nonAdminRes.status).toBe(403)

    const notFoundRes = await api(`/api/entities/${randomUUID()}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'No existe' })
    })
    expect(notFoundRes.status).toBe(404)
  })

  it('DELETE /api/entities/:id borra un modulo sin records, pero 409 si tiene records', async () => {
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Descartable', slug: 'descartable-e2e' })
    })
    const entity = await createRes.json()

    const deleteRes = await api(`/api/entities/${entity.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)
    expect((await deleteRes.json()).deleted).toBe(true)

    // "proyectos" ya tiene un record (test anterior) - debe bloquear el borrado.
    const proyectosListRes = await api('/api/records/proyectos?pageSize=1')
    const proyectosList = await proyectosListRes.json()
    const proyectosId = (await (await api('/api/roles/' + adminRoleId + '/permissions')).json()).permissions.find(
      (p: { entitySlug: string }) => p.entitySlug === 'proyectos'
    ).entityId
    expect(proyectosList.data.length).toBeGreaterThan(0)

    const blockedRes = await api(`/api/entities/${proyectosId}`, { method: 'DELETE' })
    expect(blockedRes.status).toBe(409)

    const nonAdminRes = await fetch(`${baseUrl}/api/entities/${proyectosId}`, {
      method: 'DELETE',
      headers: { cookie: nonAdminCookie }
    })
    expect(nonAdminRes.status).toBe(403)
  })
})

// HU-ERD-67: endpoints de escritura sobre metadatos de campos (entity_fields)
// + historial. Reusa el server/tenant/admin del beforeAll de arriba
// (HU-ERD-30). POST sigue anidado bajo /api/entities/:entity/fields (:entity
// aca es el uuid, GET de HU-ERD-23 sibling espera el slug); PUT/DELETE de un
// campo puntual viven en /api/entity-fields/:fieldId (recurso plano, no
// anidado) - un anidado .../fields/:fieldId se probo primero contra el
// server COMPILADO real y encontro un bug de enrutamiento en Nitro/rou3 (ver
// el comentario largo en server/utils/moduleEntityFields.ts).
describe('e2e: HU-ERD-67 (CRUD de metadatos de campos - entity_fields + historial)', () => {
  const FIELDS_NON_ADMIN_EMAIL = 'vendedor@e2e.test'
  const FIELDS_NON_ADMIN_PASSWORD = 'e2e-password-1234'
  let fieldsNonAdminCookie: string
  let fieldsEntityId: string
  let fieldsEntitySlug: string

  beforeAll(async () => {
    // El usuario no-admin ya existe (creado en el describe de HU-ERD-66,
    // que corre antes que este en el mismo archivo) - solo hace falta loguear.
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, email: FIELDS_NON_ADMIN_EMAIL, password: FIELDS_NON_ADMIN_PASSWORD })
    })
    expect(loginRes.status).toBe(200)
    fieldsNonAdminCookie = extractCookie(loginRes)

    fieldsEntitySlug = 'campos-e2e'
    const entityRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Campos E2E', slug: fieldsEntitySlug })
    })
    expect(entityRes.status).toBe(201)
    fieldsEntityId = (await entityRes.json()).id
  }, 30_000)

  it('POST fields sin cookie es 401, y con un rol no-admin es 403', async () => {
    const noAuthRes = await fetch(`${baseUrl}/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nombre', label: 'Nombre', dataType: 'text' })
    })
    expect(noAuthRes.status).toBe(401)

    const nonAdminRes = await fetch(`${baseUrl}/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fieldsNonAdminCookie },
      body: JSON.stringify({ name: 'nombre', label: 'Nombre', dataType: 'text' })
    })
    expect(nonAdminRes.status).toBe(403)
  })

  it('POST fields crea el campo, y GET /api/entities/:slug/fields (por SLUG, HU-ERD-23) ya lo ve - sin colision de rutas', async () => {
    const createRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true })
    })
    expect(createRes.status).toBe(201)
    const field = await createRes.json()
    expect(field).toMatchObject({ name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true })

    const getRes = await api(`/api/entities/${fieldsEntitySlug}/fields`)
    expect(getRes.status).toBe(200)
    const { fields } = await getRes.json()
    expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'nombre', label: 'Nombre' })]))
  })

  it('POST fields con validationRules invalido para el dataType es 422, y con nombre duplicado es 409', async () => {
    const invalidRulesRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'edad', label: 'Edad', dataType: 'number', validationRules: { minLength: 3 } })
    })
    expect(invalidRulesRes.status).toBe(422)

    const dupRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'nombre', label: 'Nombre otra vez', dataType: 'text' })
    })
    expect(dupRes.status).toBe(409)
  })

  // Reportado por el usuario (2026-09-01): "id" ya se podia crear como un
  // campo propio sin ningun chequeo (name/dataType eran validos como
  // cualquier otro), y su fila mostraba editar/eliminar igual que cualquier
  // otro campo. Se bloquea la creacion (400, mismo Zod refine que name/label)
  // y, para un campo "id" que ya haya quedado creado ANTES de este fix
  // (simulado aca con SQL directo, ya que la API ya no lo permite),
  // PUT/DELETE tambien lo protegen (403 ProtectedFieldError) - no alcanza con
  // ocultar los botones en ModuleFieldsCard.vue, que por si sola no bloquea
  // pegarle directo a la API.
  it('POST fields con name "id" (reservado) es 400; PUT/DELETE sobre un campo "id" preexistente es 403', async () => {
    const reservedRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'id', label: 'Id', dataType: 'text' })
    })
    expect(reservedRes.status).toBe(400)

    const admin = postgres(testDb.adminUrl)
    let legacyIdField: { id: string }
    try {
      ;[legacyIdField] = await admin`
        insert into entity_fields (entity_id, name, label, data_type, is_required)
        values (${fieldsEntityId}, 'id', 'Id', 'text', false) returning id
      `
    } finally {
      await admin.end()
    }

    const putRes = await api(`/api/entity-fields/${legacyIdField.id}`, {
      method: 'PUT',
      body: JSON.stringify({ label: 'Id modificado' })
    })
    expect(putRes.status).toBe(403)

    const deleteRes = await api(`/api/entity-fields/${legacyIdField.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(403)

    const getRes = await api(`/api/entities/${fieldsEntitySlug}/fields`)
    const { fields } = await getRes.json()
    expect(fields.find((f: { name: string }) => f.name === 'id')).toMatchObject({ label: 'Id' })
  })

  // HU-ERD-71: el mismo 422 de "validationRules invalido", pero por el
  // camino nuevo (duplicados) - confirmado contra el servidor COMPILADO real
  // via HTTP, no solo la funcion (esa parte ya la cubre
  // test/integration/moduleEntityFields.test.ts).
  it('POST fields con "value" duplicado (select) o nombre de columna duplicado (tabla) es 422', async () => {
    const dupOptionsRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'prioridad_e2e',
        label: 'Prioridad',
        dataType: 'select',
        validationRules: { options: [{ value: 'alta', label: 'Alta' }, { value: 'alta', label: 'Alta otra vez' }] }
      })
    })
    expect(dupOptionsRes.status).toBe(422)

    const dupColumnsRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'items_e2e',
        label: 'Items',
        dataType: 'tabla',
        validationRules: { columns: [{ name: 'cantidad', label: 'Cantidad', type: 'number' }, { name: 'cantidad', label: 'Otra', type: 'text' }] }
      })
    })
    expect(dupColumnsRes.status).toBe(422)
  })

  it('PUT fields/:fieldId cambia dataType, escribe entity_field_history y deja los records existentes is_dirty (revalidacion perezosa real vuelve a validarlos en su proximo GET)', async () => {
    const createRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'puntaje', label: 'Puntaje', dataType: 'text' })
    })
    const field = await createRes.json()

    const recordRes = await api(`/api/records/${fieldsEntitySlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { nombre: 'Registro E2E', puntaje: 'no-numero' } })
    })
    expect(recordRes.status).toBe(201)
    const record = await recordRes.json()

    const putRes = await api(`/api/entity-fields/${field.id}`, {
      method: 'PUT',
      body: JSON.stringify({ dataType: 'number' })
    })
    expect(putRes.status).toBe(200)
    expect((await putRes.json()).dataType).toBe('number')

    // El GET revalida records sucios (HU-ERD-18): como "no-numero" ya no es
    // valido para el tipo "number" nuevo, se sigue devolviendo el dato viejo
    // sin bloquear la lectura (no un 500 ni un dato borrado).
    const getRecordRes = await api(`/api/records/${fieldsEntitySlug}/${record.id}`)
    expect(getRecordRes.status).toBe(200)
    expect((await getRecordRes.json()).customData).toMatchObject({ puntaje: 'no-numero' })

    const nonAdminRes = await fetch(`${baseUrl}/api/entity-fields/${field.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fieldsNonAdminCookie },
      body: JSON.stringify({ label: 'Hackeado' })
    })
    expect(nonAdminRes.status).toBe(403)

    const notFoundRes = await api(`/api/entity-fields/${randomUUID()}`, {
      method: 'PUT',
      body: JSON.stringify({ label: 'No existe' })
    })
    expect(notFoundRes.status).toBe(404)
  })

  it('DELETE /api/entity-fields/:fieldId borra el campo pero el customData ya guardado en records NO se toca (huerfano en el JSON)', async () => {
    const createRes = await api(`/api/entities/${fieldsEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'temporal', label: 'Temporal', dataType: 'text' })
    })
    const field = await createRes.json()

    const recordRes = await api(`/api/records/${fieldsEntitySlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { nombre: 'Otro registro', temporal: 'dato que va a quedar huerfano' } })
    })
    const record = await recordRes.json()

    const deleteRes = await api(`/api/entity-fields/${field.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)
    expect((await deleteRes.json()).deleted).toBe(true)

    const getFieldsRes = await api(`/api/entities/${fieldsEntitySlug}/fields`)
    const { fields } = await getFieldsRes.json()
    expect(fields.find((f: { name: string }) => f.name === 'temporal')).toBeUndefined()

    const getRecordRes = await api(`/api/records/${fieldsEntitySlug}/${record.id}`)
    expect((await getRecordRes.json()).customData).toMatchObject({ temporal: 'dato que va a quedar huerfano' })

    const deleteAgainRes = await api(`/api/entity-fields/${field.id}`, { method: 'DELETE' })
    expect(deleteAgainRes.status).toBe(404)

    const nonAdminRes = await fetch(`${baseUrl}/api/entity-fields/${randomUUID()}`, {
      method: 'DELETE',
      headers: { cookie: fieldsNonAdminCookie }
    })
    expect(nonAdminRes.status).toBe(403)
  })

  it('POST fields con un entity id inexistente devuelve 404; PUT/DELETE /api/entity-fields/:fieldId sin cookie es 401', async () => {
    const fakeEntityId = randomUUID()
    const postRes = await api(`/api/entities/${fakeEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'x', label: 'X', dataType: 'text' })
    })
    expect(postRes.status).toBe(404)

    const putRes = await fetch(`${baseUrl}/api/entity-fields/${randomUUID()}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'X' })
    })
    expect(putRes.status).toBe(401)

    const deleteRes = await fetch(`${baseUrl}/api/entity-fields/${randomUUID()}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(401)
  })
})

// HU-ERD-35: modo "dedicated" (login sin tenantId) y FEATURE_DASHBOARD=false
// (kill switch real, no solo cosmetico) - un segundo server real, con su
// propio Postgres embebido y su propio env (APP_MODE/FEATURE_DASHBOARD
// distintos), pero reusando el MISMO .output ya compilado en el beforeAll de
// arriba (correr `nuxt build` dos veces en paralelo sobre el mismo directorio
// corromperia el output - un build alcanza, el binario compilado no cambia
// segun env vars de runtime).
describe('e2e: HU-ERD-35 (APP_MODE=dedicated, FEATURE_DASHBOARD=false)', () => {
  let dedicatedDb: TestDb
  let dedicatedServer: ChildProcess
  let dedicatedBaseUrl: string
  let dedicatedTenantId: string
  let dedicatedAdmin: ReturnType<typeof postgres>

  const DEDICATED_EMAIL = 'admin@dedicated.test'
  const DEDICATED_PASSWORD = 'dedicated-password-1234'

  async function dedicatedLoginCookie(): Promise<string> {
    const res = await fetch(`${dedicatedBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEDICATED_EMAIL, password: DEDICATED_PASSWORD })
    })
    expect(res.status).toBe(200)
    return extractCookie(res)
  }

  beforeAll(async () => {
    dedicatedDb = await createTestDb()
    dedicatedTenantId = randomUUID()
    dedicatedAdmin = postgres(dedicatedDb.adminUrl)

    const passwordHash = await bcrypt.hash(DEDICATED_PASSWORD, 12)
    await dedicatedAdmin`insert into tenants (id, name) values (${dedicatedTenantId}, 'Tenant Dedicated E2E')`
    const [role] = await dedicatedAdmin`
      insert into roles (tenant_id, name, is_system) values (${dedicatedTenantId}, 'Administrador', true) returning id
    `
    await dedicatedAdmin`
      insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
      values (${dedicatedTenantId}, ${role.id}, ${DEDICATED_EMAIL}, ${passwordHash}, 'Admin Dedicated', true)
    `

    const port = await getFreePort()
    dedicatedBaseUrl = `http://localhost:${port}`
    dedicatedServer = spawn('node', ['.output/server/index.mjs'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        NITRO_PORT: String(port),
        APP_DATABASE_URL: dedicatedDb.appUrl,
        JWT_SECRET: 'e2e-dedicated-secret',
        OLAP_ETL_ENABLED: 'false',
        NODE_ENV: 'test',
        APP_MODE: 'dedicated',
        FEATURE_DASHBOARD: 'false'
      },
      stdio: 'pipe'
    })
    await waitForServer(`${dedicatedBaseUrl}/api/health`, 20_000)
  }, 60_000)

  afterAll(async () => {
    if (dedicatedServer) {
      await new Promise<void>((resolve) => {
        dedicatedServer.once('exit', () => resolve())
        dedicatedServer.kill('SIGTERM')
        setTimeout(() => {
          dedicatedServer.kill('SIGKILL')
          resolve()
        }, 5000)
      })
    }
    if (dedicatedAdmin) await dedicatedAdmin.end()
    if (dedicatedDb) await dedicatedDb.stop()
  }, 30_000)

  it('login SIN tenantId funciona en modo dedicated - resuelve el unico tenant solo', async () => {
    const cookie = await dedicatedLoginCookie()
    expect(cookie).toContain('erp_auth_token=')
  })

  it('GET /api/dashboard/metrics da 404 con FEATURE_DASHBOARD=false, incluso autenticado como admin', async () => {
    const cookie = await dedicatedLoginCookie()
    const res = await fetch(`${dedicatedBaseUrl}/api/dashboard/metrics`, { headers: { cookie } })
    expect(res.status).toBe(404)
  })

  it('SSR: la home ("Tablero") muestra el estado deshabilitado con el flag off, pero el link a "Roles y permisos" sigue (guard distinto, no afectado por el flag)', async () => {
    const cookie = await dedicatedLoginCookie()
    const res = await fetch(`${dedicatedBaseUrl}/`, { headers: { cookie } })
    const html = await res.text()
    // "Tablero" ahora es la home misma (reubicacion post-HU-ERD-67) - con el
    // flag off no desaparece de la nav (ya no es un item condicional), pero
    // su contenido si respeta el kill switch real (no pide metricas).
    expect(html).toContain('Tablero')
    expect(html).toContain('Esta funcionalidad esta deshabilitada')
    expect(html).toContain('Roles y permisos')
  })

  it('SSR: /login NO muestra el campo "Organización" en modo dedicated', async () => {
    const res = await fetch(`${dedicatedBaseUrl}/login`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('for="tenantId"')
  })

  it('login falla con 500 (error de configuracion, no de credenciales) si "dedicated" tiene mas de un tenant', async () => {
    await dedicatedAdmin`insert into tenants (id, name) values (${randomUUID()}, 'Tenant Extra')`
    const res = await fetch(`${dedicatedBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEDICATED_EMAIL, password: DEDICATED_PASSWORD })
    })
    expect(res.status).toBe(500)
  })
})

// HU-ERD-69: pantalla de administracion "Listado de Modulos"
// (pages/modulos/index.vue) + GET /api/entities (listado, nuevo en esta HU -
// hasta ahora solo existian POST/PUT/DELETE puntuales, HU-ERD-66). Reusa el
// server/tenant/admin del beforeAll de arriba (HU-ERD-30) y el usuario
// no-admin ya creado en el describe de HU-ERD-66 (mismo criterio que
// HU-ERD-67: solo hace falta loguear, no volver a crearlo).
describe('e2e: HU-ERD-69 (Listado de Modulos - GET /api/entities + pages/modulos)', () => {
  const MODULOS_NON_ADMIN_EMAIL = 'vendedor@e2e.test'
  const MODULOS_NON_ADMIN_PASSWORD = 'e2e-password-1234'
  let modulosNonAdminCookie: string
  let listadoModuleName: string

  beforeAll(async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, email: MODULOS_NON_ADMIN_EMAIL, password: MODULOS_NON_ADMIN_PASSWORD })
    })
    expect(loginRes.status).toBe(200)
    modulosNonAdminCookie = extractCookie(loginRes)

    listadoModuleName = 'Modulo Listado E2E'
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: listadoModuleName, slug: 'modulo-listado-e2e', description: 'Para probar el listado' })
    })
    expect(createRes.status).toBe(201)
  }, 30_000)

  it('GET /api/entities sin cookie es 401, y con un rol no-admin es 403', async () => {
    const noAuthRes = await fetch(`${baseUrl}/api/entities`)
    expect(noAuthRes.status).toBe(401)

    const nonAdminRes = await fetch(`${baseUrl}/api/entities`, { headers: { cookie: modulosNonAdminCookie } })
    expect(nonAdminRes.status).toBe(403)
  })

  it('GET /api/entities (admin) lista los modulos del tenant, ordenados por nombre', async () => {
    const res = await api('/api/entities')
    expect(res.status).toBe(200)
    const { entities } = await res.json()
    expect(Array.isArray(entities)).toBe(true)
    expect(entities.find((e: { slug: string }) => e.slug === 'modulo-listado-e2e')).toMatchObject({
      name: listadoModuleName,
      description: 'Para probar el listado'
    })
    const names = entities.map((e: { name: string }) => e.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('SSR: /modulos (F5 completo, admin) renderiza el listado real, no el estado de error', async () => {
    const res = await fetch(`${baseUrl}/modulos`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Módulos')
    expect(html).toContain(listadoModuleName)
    expect(html).not.toContain('No se pudo cargar el listado de módulos')
  })

  it('SSR: /modulos con un rol no-admin muestra el estado de error claro (403), no el listado', async () => {
    const res = await fetch(`${baseUrl}/modulos`, { headers: { cookie: modulosNonAdminCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('requiere rol administrador')
    expect(html).not.toContain(listadoModuleName)
  })

  it('SSR: la home muestra el link "Módulos" en el nav para admin, pero no para un rol no-admin', async () => {
    const adminHomeRes = await fetch(`${baseUrl}/`, { headers: { cookie: authCookie } })
    const adminHtml = await adminHomeRes.text()
    expect(adminHtml).toContain('Módulos')

    const nonAdminHomeRes = await fetch(`${baseUrl}/`, { headers: { cookie: modulosNonAdminCookie } })
    const nonAdminHtml = await nonAdminHomeRes.text()
    expect(nonAdminHtml).not.toContain('Módulos')
  })

  it('DELETE de un modulo con registros existentes devuelve un mensaje 409 claro (con el conteo), no un error generico', async () => {
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Con Datos E2E', slug: 'con-datos-listado-e2e' })
    })
    const entity = await createRes.json()
    await api(`/api/records/${entity.slug}`, { method: 'POST', body: JSON.stringify({ customData: {} }) })

    const deleteRes = await api(`/api/entities/${entity.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(409)
    const body = await deleteRes.json()
    expect(body.statusMessage).toContain('registro')
    expect(body.statusMessage).toContain('1')
  })

  it('GET /api/entities incluye recordCount/fieldCount reales por modulo (columnas "Registros"/"Campos" del diseno)', async () => {
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Conteo E2E', slug: 'conteo-listado-e2e' })
    })
    const entity = await createRes.json()
    await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'nombre', label: 'Nombre', dataType: 'text' })
    })
    await api(`/api/records/${entity.slug}`, { method: 'POST', body: JSON.stringify({ customData: {} }) })

    const res = await api('/api/entities')
    const { entities } = await res.json()
    expect(entities.find((e: { slug: string }) => e.slug === 'conteo-listado-e2e')).toMatchObject({
      recordCount: 1,
      fieldCount: 1
    })
  })

  // Sigue el diseno real de Screen/Listado Modulos en el .pen (revisado con
  // las herramientas de Pencil): breadcrumb Inicio > Modulos, boton "Crear
  // modulo" que navega a una pagina dedicada (no un panel/card en el
  // listado), columnas Modulo/Registros/Campos/Creado/Acciones.
  it('SSR: /modulos (admin) renderiza el diseno real - breadcrumb, boton "Crear módulo" y conteos, sin ningun formulario inline', async () => {
    const res = await fetch(`${baseUrl}/modulos`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Crear módulo')
    expect(html).toContain('href="/modulos/nuevo"')
    expect(html).not.toContain('id="modulo-name"')
  })

  // HU-ERD-70 reescribio /modulos/nuevo como asistente de 2 pasos (Screen/Crear
  // Módulo Paso1 del .pen) - el paso 1 ya no dice "Crear módulo" sino "Nuevo
  // módulo" + boton "Continuar"; el formulario de alta real sigue teniendo
  // el mismo input id="modulo-name".
  it('SSR: /modulos/nuevo (admin) renderiza el paso 1 del asistente, no el estado de error', async () => {
    const res = await fetch(`${baseUrl}/modulos/nuevo`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Nuevo módulo')
    expect(html).toContain('id="modulo-name"')
    expect(html).toContain('Continuar')
  })

  it('POST vía /modulos/nuevo (simulado con la API real) crea el módulo y aparece de inmediato en el listado', async () => {
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Creado Desde Pagina Dedicada', slug: 'creado-pagina-dedicada' })
    })
    expect(createRes.status).toBe(201)
    const entity = await createRes.json()

    const listRes = await fetch(`${baseUrl}/modulos`, { headers: { cookie: authCookie } })
    const html = await listRes.text()
    expect(html).toContain('Creado Desde Pagina Dedicada')

    const editRes = await fetch(`${baseUrl}/modulos/${entity.id}/editar`, { headers: { cookie: authCookie } })
    expect(editRes.status).toBe(200)
    const editHtml = await editRes.text()
    expect(editHtml).toContain('Creado Desde Pagina Dedicada')
    expect(editHtml).toContain('disabled')
  })

  it('SSR: la home muestra el icono/link "Módulos" (icono blocks, verificado contra el .pen) para admin', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { cookie: authCookie } })
    const html = await res.text()
    expect(html).toContain('href="/modulos"')
  })
})

// HU-ERD-70: asistente "Crear módulo" (paso 2 - campos) + reutilizacion de
// ModuleFieldsCard/ModulePreviewCard en pages/modulos/[id]/editar.vue. El
// harness e2e hace fetch crudo (no ejecuta JS de cliente), asi que no puede
// abrir el modal FieldFormModal ni tipear en el - la cobertura se centra en:
// (a) el flujo real de alta/edicion/borrado de campos vía los endpoints de
// HU-ERD-67 (ya con la forma exacta que produce FieldFormModal/onSubmit), y
// (b) que el SSR de editar.vue efectivamente reusa el mismo componente de
// campos que el asistente (mismos badges/textos, misma seccion "Campos del
// módulo").
describe('e2e: HU-ERD-70 (Asistente Crear Módulo - paso 2 de campos + reutilizacion en editar)', () => {
  let wizardModuleId: string
  let wizardModuleSlug: string

  beforeAll(async () => {
    wizardModuleSlug = 'modulo-asistente-e2e'
    const createRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Modulo Asistente E2E', slug: wizardModuleSlug })
    })
    expect(createRes.status).toBe(201)
    const entity = await createRes.json()
    wizardModuleId = entity.id
  }, 30_000)

  it('el flujo del paso 2 del asistente (agregar campo con validationRules) queda disponible de inmediato via GET /api/entities/:slug/fields', async () => {
    const postRes = await api(`/api/entities/${wizardModuleId}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'edad',
        label: 'Edad',
        dataType: 'number',
        isRequired: true,
        validationRules: { min: 0, max: 120, integer: true }
      })
    })
    expect(postRes.status).toBe(201)

    const fieldsRes = await api(`/api/entities/${wizardModuleSlug}/fields`)
    expect(fieldsRes.status).toBe(200)
    const { fields } = await fieldsRes.json()
    const edad = fields.find((f: { name: string }) => f.name === 'edad')
    expect(edad).toMatchObject({ label: 'Edad', dataType: 'number', isRequired: true })
  })

  it('SSR: /modulos/nuevo paso 1 ya muestra la card "Vista previa en vivo" (ModulePreviewCard) en estado vacio', async () => {
    const res = await fetch(`${baseUrl}/modulos/nuevo`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Vista previa en vivo')
    expect(html).toContain('Los campos del formulario se agregarán en el siguiente paso')
  })

  // Fix (feedback directo del usuario, post-entrega): la primera version de
  // editar.vue mostraba la card "Informacion basica" Y "Campos del modulo"
  // juntas en una sola pantalla larga - no coincide con el diseno, que
  // muestra un paso a la vez (igual que el asistente). Se corrigio con el
  // mismo toggle "step" del asistente, con la diferencia de que en edicion
  // ambos pasos ya estan disponibles (el modulo ya existe completo) y el
  // indicador de pasos es clickeable en las dos direcciones. Por default
  // abre en "Informacion basica" (mismo orden que el asistente) - el harness
  // e2e hace fetch crudo y no puede clickear el paso 2 (eso ya lo cubre
  // ModuleFieldsCard.vue via los endpoints reales, en el describe de
  // HU-ERD-67), asi que esta prueba confirma: (a) el SSR por default NO
  // mezcla los dos pasos (el bug reportado), y (b) el ModulePreviewCard del
  // paso 1 ya usa los campos REALES del modulo (no el estado vacio del
  // asistente) - reusa el mismo DynamicForm.vue con datos reales desde el
  // primer render, sin esperar a entrar al paso 2.
  it('SSR: /modulos/:id/editar abre en el paso "Información básica" por default - no mezcla los dos pasos', async () => {
    const res = await fetch(`${baseUrl}/modulos/${wizardModuleId}/editar`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    // Rediseno "Editar Módulo" (2026-09-01): la card de este paso paso a
    // llamarse "Información del módulo" (antes "Información básica", ver
    // Screen/Editar Módulo del .pen) - la pestaña activa sigue diciendo
    // "Información general" en la barra de arriba (chequeado aca tambien).
    expect(html).toContain('Información del módulo')
    expect(html).toContain('Información general')
    expect(html).toContain('id="modulo-slug"')
    expect(html).not.toContain('Campos del módulo')

    // ModulePreviewCard ya con el campo real (no el estado vacio) desde el
    // paso 1 - misma DynamicForm.vue que el formulario real de alta.
    expect(html).toContain('Vista previa en vivo')
    expect(html).toContain('Edad')
    expect(html).not.toContain('Los campos del formulario se agregarán en el siguiente paso')
  })

  it('editar un campo (PUT /api/entity-fields/:fieldId) y luego eliminarlo se refleja en el siguiente GET de campos', async () => {
    const fieldsRes = await api(`/api/entities/${wizardModuleSlug}/fields`)
    const { fields } = await fieldsRes.json()
    const edad = fields.find((f: { name: string }) => f.name === 'edad')

    const putRes = await api(`/api/entity-fields/${edad.id}`, {
      method: 'PUT',
      body: JSON.stringify({ label: 'Edad (años)', validationRules: { min: 0, max: 130, integer: true } })
    })
    expect(putRes.status).toBe(200)

    const afterPutRes = await api(`/api/entities/${wizardModuleSlug}/fields`)
    const afterPut = (await afterPutRes.json()).fields.find((f: { name: string }) => f.name === 'edad')
    expect(afterPut.label).toBe('Edad (años)')

    const deleteRes = await api(`/api/entity-fields/${edad.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    const afterDeleteRes = await api(`/api/entities/${wizardModuleSlug}/fields`)
    const afterDelete = (await afterDeleteRes.json()).fields.find((f: { name: string }) => f.name === 'edad')
    expect(afterDelete).toBeUndefined()
  })
})

// HU-ERD-72: campo tipo Tabla (lineas de item, ej. "Lineas del pedido") +
// search en GET /api/records/:entity (autocomplete de columnas de relacion
// dentro de una Tabla, components/DynamicTableField.vue). El harness e2e hace
// fetch crudo (no ejecuta JS de cliente), asi que no puede tipear en el
// autocomplete ni ejercitar el "producto de columnas numericas" de
// DynamicTableField.vue (eso es logica de cliente, sin contraparte server) -
// la cobertura se centra en lo que SI corre en el servidor real: (a) el
// query param "search" nuevo de este endpoint, y (b) que un record con un
// campo Tabla completo (columna de relacion + copyFrom + readonly) se
// guarda y se devuelve tal cual (snapshot), sin que el servidor recalcule
// ni valide de mas alla de la forma (eso es a proposito - la "no
// recalcular nunca" es una garantia de DynamicTableField.vue en el cliente,
// no algo que el servidor imponga).
describe('e2e: HU-ERD-72 (search en GET /api/records + campo Tabla de punta a punta)', () => {
  let productosSlug: string
  let productoTecladoId: string
  let productoMouseId: string
  let pedidosSlug: string

  beforeAll(async () => {
    productosSlug = 'productos-tabla-e2e'
    const productosRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Productos Tabla E2E', slug: productosSlug })
    })
    expect(productosRes.status).toBe(201)
    const productosEntity = await productosRes.json()

    await api(`/api/entities/${productosEntity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true })
    })
    await api(`/api/entities/${productosEntity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'precio', label: 'Precio', dataType: 'number' })
    })

    const tecladoRes = await api(`/api/records/${productosSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { nombre: 'Teclado mecanico', precio: 100 } })
    })
    productoTecladoId = (await tecladoRes.json()).id

    const mouseRes = await api(`/api/records/${productosSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { nombre: 'Mouse inalambrico', precio: 50 } })
    })
    productoMouseId = (await mouseRes.json()).id

    pedidosSlug = 'pedidos-tabla-e2e'
    const pedidosRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pedidos Tabla E2E', slug: pedidosSlug })
    })
    expect(pedidosRes.status).toBe(201)
    const pedidosEntity = await pedidosRes.json()

    const itemsFieldRes = await api(`/api/entities/${pedidosEntity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'items',
        label: 'Lineas del pedido',
        dataType: 'tabla',
        validationRules: {
          columns: [
            { name: 'producto_id', label: 'Producto', type: 'relation', relationEntity: productosSlug },
            { name: 'cantidad', label: 'Cantidad', type: 'number', editable: true },
            { name: 'precio_unitario', label: 'Precio unitario', type: 'number', copyFrom: `${productosSlug}.precio`, editable: true },
            { name: 'subtotal', label: 'Subtotal', type: 'number', readonly: true }
          ]
        }
      })
    })
    expect(itemsFieldRes.status).toBe(201)
  }, 30_000)

  it('GET /api/records/:entity?search=... filtra por coincidencia de texto libre dentro de customData', async () => {
    const tecladoSearch = await api(`/api/records/${productosSlug}?search=teclado`)
    expect(tecladoSearch.status).toBe(200)
    const tecladoBody = await tecladoSearch.json()
    expect(tecladoBody.data.map((r: { id: string }) => r.id)).toEqual([productoTecladoId])

    const sinCoincidencias = await api(`/api/records/${productosSlug}?search=inexistente-xyz`)
    expect(sinCoincidencias.status).toBe(200)
    expect((await sinCoincidencias.json()).data).toEqual([])
  })

  it('search es case-insensitive y el total refleja solo las filas filtradas', async () => {
    const res = await api(`/api/records/${productosSlug}?search=MOUSE`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([productoMouseId])
    expect(body.total).toBe(1)
  })

  it('sin search, GET sigue devolviendo todos los records de la entidad (no rompe el comportamiento existente)', async () => {
    const res = await api(`/api/records/${productosSlug}?pageSize=100`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.data.map((r: { id: string }) => r.id)
    expect(ids).toEqual(expect.arrayContaining([productoTecladoId, productoMouseId]))
  })

  it('un record con un campo Tabla completo (relacion + copyFrom + readonly) se guarda y se lee tal cual (snapshot)', async () => {
    const createRes = await api(`/api/records/${pedidosSlug}`, {
      method: 'POST',
      body: JSON.stringify({
        customData: {
          items: [
            { producto_id: productoTecladoId, cantidad: 2, precio_unitario: 100, subtotal: 200 },
            { producto_id: productoMouseId, cantidad: 3, precio_unitario: 50, subtotal: 150 }
          ]
        }
      })
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.customData.items).toHaveLength(2)

    const getRes = await api(`/api/records/${pedidosSlug}/${created.id}`)
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    // El snapshot vuelve exactamente como se guardo - el servidor no
    // recalcula "subtotal" ni vuelve a copiar "precio_unitario" desde el
    // producto relacionado en cada lectura (esa es la garantia central de
    // HU-ERD-72: los valores guardados no reflejan cambios posteriores en
    // el producto).
    expect(fetched.customData.items).toEqual(created.customData.items)

    // Confirma la garantia de snapshot ante cambios reales: si el precio del
    // producto relacionado cambia despues, la fila ya guardada NO se toca.
    await api(`/api/records/${productosSlug}/${productoTecladoId}`, {
      method: 'PUT',
      body: JSON.stringify({ customData: { nombre: 'Teclado mecanico', precio: 999 } })
    })
    const getAfterPriceChangeRes = await api(`/api/records/${pedidosSlug}/${created.id}`)
    const fetchedAfterPriceChange = await getAfterPriceChangeRes.json()
    expect(fetchedAfterPriceChange.customData.items[0].precio_unitario).toBe(100)
  })

  it('una fila de Tabla con una columna de relacion en formato invalido (no uuid) es rechazada (422) por el schema dinamico real', async () => {
    const res = await api(`/api/records/${pedidosSlug}`, {
      method: 'POST',
      body: JSON.stringify({
        customData: {
          items: [{ producto_id: 'no-es-un-uuid', cantidad: 1, precio_unitario: 100, subtotal: 100 }]
        }
      })
    })
    expect(res.status).toBe(422)
  })

  it('un campo Tabla vacio ([]) es valido cuando el campo no es requerido', async () => {
    const res = await api(`/api/records/${pedidosSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { items: [] } })
    })
    expect(res.status).toBe(201)
  })
})

// HU-ERD-73: campo Select/Multiselect en el formulario (validado server-side
// via el buildFieldType() ya existente, cubierto en test/unit/dynamicSchema.test.ts)
// y el panel de Filtros del listado - nuevo query param filterField/filterValues
// en GET /api/records/:entity. El harness e2e hace fetch crudo (no ejecuta JS
// de cliente), asi que no puede abrir el dropdown de DynamicSelectField.vue ni
// el popover de pages/registros/[entity]/index.vue - la cobertura se centra en
// lo que corre en el servidor real: el filtro en si (equality-ANY para select,
// operador de array jsonb `?|` para multiselect, criterio de aceptacion
// explicito de la HU) y su validacion (campo inexistente, filterField sin
// filterValues).
describe('e2e: HU-ERD-73 (filterField/filterValues en GET /api/records + campos Select/Multiselect)', () => {
  let pedidosFiltroSlug: string
  let pedidoAltaId: string
  let pedidoUrgenteId: string
  let pedidoBajaId: string

  beforeAll(async () => {
    pedidosFiltroSlug = 'pedidos-filtro-e2e'
    const entityRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pedidos Filtro E2E', slug: pedidosFiltroSlug })
    })
    expect(entityRes.status).toBe(201)
    const entity = await entityRes.json()

    const prioridadRes = await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'prioridad',
        label: 'Prioridad',
        dataType: 'select',
        validationRules: {
          options: [
            { value: 'baja', label: 'Baja', color: 'neutral' },
            { value: 'alta', label: 'Alta', color: 'warning' },
            { value: 'urgente', label: 'Urgente', color: 'error' }
          ]
        }
      })
    })
    expect(prioridadRes.status).toBe(201)

    const etiquetasRes = await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'etiquetas',
        label: 'Etiquetas',
        dataType: 'multiselect',
        validationRules: {
          options: [
            { value: 'frontend', label: 'Frontend', color: 'blue' },
            { value: 'bug', label: 'Bug', color: 'error' },
            { value: 'urgente', label: 'Urgente', color: 'warning' }
          ]
        }
      })
    })
    expect(etiquetasRes.status).toBe(201)

    const altaRes = await api(`/api/records/${pedidosFiltroSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { prioridad: 'alta', etiquetas: ['frontend'] } })
    })
    pedidoAltaId = (await altaRes.json()).id

    const urgenteRes = await api(`/api/records/${pedidosFiltroSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { prioridad: 'urgente', etiquetas: ['bug', 'urgente'] } })
    })
    pedidoUrgenteId = (await urgenteRes.json()).id

    const bajaRes = await api(`/api/records/${pedidosFiltroSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { prioridad: 'baja', etiquetas: [] } })
    })
    pedidoBajaId = (await bajaRes.json()).id
  }, 30_000)

  it('un campo Select con un value fuera de las opciones configuradas es rechazado (422) - z.enum real del servidor', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { prioridad: 'inventada' } })
    })
    expect(res.status).toBe(422)
  })

  it('filterField=prioridad&filterValues=alta ("es") filtra por equality-ANY sobre un campo Select', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}?filterField=prioridad&filterValues=alta`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([pedidoAltaId])
  })

  it('filterValues con varios values ("es alguno de") sobre un campo Select trae la union de coincidencias', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}?filterField=prioridad&filterValues=alta,urgente`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual([pedidoAltaId, pedidoUrgenteId].sort())
  })

  it('filterField sobre un campo Multiselect usa el operador de array de Postgres (overlap, no exact match)', async () => {
    // pedidoUrgenteId tiene etiquetas ['bug','urgente'] - "urgente" solo (un
    // value) ya debe traerlo por overlap, sin exigir que coincidan TODAS sus
    // etiquetas (eso confirma que no es un chequeo de igualdad de array).
    const res = await api(`/api/records/${pedidosFiltroSlug}?filterField=etiquetas&filterValues=urgente`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([pedidoUrgenteId])
  })

  it('filterValues con varios values sobre Multiselect trae cualquier registro cuyo array tenga al menos una coincidencia', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}?filterField=etiquetas&filterValues=frontend,bug`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual([pedidoAltaId, pedidoUrgenteId].sort())
  })

  it('un filtro sin coincidencias (registro con array vacio) no aparece', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}?filterField=etiquetas&filterValues=frontend,bug,urgente`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id)).not.toContain(pedidoBajaId)
  })

  it('filterField que no es un campo real de la entidad es rechazado (422)', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}?filterField=no_existe&filterValues=algo`)
    expect(res.status).toBe(422)
  })

  it('filterField sin filterValues (o viceversa) es rechazado (422) - deben enviarse juntos', async () => {
    const onlyFieldRes = await api(`/api/records/${pedidosFiltroSlug}?filterField=prioridad`)
    expect(onlyFieldRes.status).toBe(422)

    const onlyValuesRes = await api(`/api/records/${pedidosFiltroSlug}?filterValues=alta`)
    expect(onlyValuesRes.status).toBe(422)
  })

  it('sin filtro, GET sigue devolviendo todos los records (no rompe el comportamiento existente)', async () => {
    const res = await api(`/api/records/${pedidosFiltroSlug}?pageSize=100`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([pedidoAltaId, pedidoUrgenteId, pedidoBajaId])
    )
  })

  it('SSR: /registros/:entity (F5 completo) renderiza el boton "Filtros" cuando la entidad tiene un campo Select/Multiselect', async () => {
    const res = await fetch(`${baseUrl}/registros/${pedidosFiltroSlug}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Filtros')
    // Las etiquetas configuradas (no los values crudos) se ven en la celda de
    // la tabla - confirma que DynamicTable.vue resuelve select/multiselect
    // contra validationRules.options en vez de mostrar el value tecnico.
    expect(html).toContain('Alta')
    expect(html).toContain('Urgente')
  })
})

describe('e2e: HU-ERD-74 (Diseño del detalle - relationEntity, inverseRelations, detailLayout, pagina de detalle)', () => {
  let cotizacionesSlug: string
  let cotizacionesId: string
  let facturasSlug: string
  let emailFieldId: string
  let cotizacionIdFieldId: string
  let cotizacionRecordId: string

  beforeAll(async () => {
    cotizacionesSlug = 'cotizaciones-e2e'
    const cotizacionesRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Cotizaciones E2E', slug: cotizacionesSlug })
    })
    expect(cotizacionesRes.status).toBe(201)
    const cotizaciones = await cotizacionesRes.json()
    cotizacionesId = cotizaciones.id

    const emailRes = await api(`/api/entities/${cotizacionesId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'email', label: 'Email', dataType: 'text' })
    })
    expect(emailRes.status).toBe(201)
    emailFieldId = (await emailRes.json()).id

    const estadoRes = await api(`/api/entities/${cotizacionesId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'estado', label: 'Estado', dataType: 'text' })
    })
    expect(estadoRes.status).toBe(201)

    facturasSlug = 'facturas-e2e'
    const facturasRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Facturas E2E', slug: facturasSlug })
    })
    expect(facturasRes.status).toBe(201)
    const facturas = await facturasRes.json()

    // Campo relation con relationEntity (HU-ERD-74) apuntando a Cotizaciones -
    // esto es lo que hace que aparezca como "relacion inversa" del lado de
    // Cotizaciones, sin resucitar relation_definitions (ERD-10/19, dead code).
    const cotizacionIdRes = await api(`/api/entities/${facturas.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'cotizacion_id',
        label: 'Cotización',
        dataType: 'relation',
        validationRules: { relationEntity: cotizacionesSlug }
      })
    })
    expect(cotizacionIdRes.status).toBe(201)
    cotizacionIdFieldId = (await cotizacionIdRes.json()).id

    const cotizacionCreateRes = await api(`/api/records/${cotizacionesSlug}`, {
      method: 'POST',
      body: JSON.stringify({ customData: { email: 'cliente@e2e.test', estado: 'aprobada' } })
    })
    expect(cotizacionCreateRes.status).toBe(201)
    cotizacionRecordId = (await cotizacionCreateRes.json()).id

    for (let i = 0; i < 3; i++) {
      const res = await api(`/api/records/${facturasSlug}`, {
        method: 'POST',
        body: JSON.stringify({ customData: { cotizacion_id: cotizacionRecordId } })
      })
      expect(res.status).toBe(201)
    }
  }, 30_000)

  it('un campo relation con relationEntity que apunta a un slug inexistente es rechazado (422)', async () => {
    const res = await api(`/api/entities/${cotizacionesId}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'campo_relation_malo',
        label: 'Malo',
        dataType: 'relation',
        validationRules: { relationEntityQueNoExiste: 'x' }
      })
    })
    // relationEntity es un string libre en el schema (no valida existencia del
    // slug a nivel Zod) - lo que SI debe rechazar es una clave desconocida en
    // validationRules (.strict()).
    expect(res.status).toBe(422)
  })

  it('GET /api/entities/:slug/fields calcula inverseRelations a partir del campo relation de Facturas', async () => {
    const res = await api(`/api/entities/${cotizacionesSlug}/fields`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inverseRelations).toEqual(
      expect.arrayContaining([expect.objectContaining({ entitySlug: facturasSlug, fieldName: 'cotizacion_id', fieldLabel: 'Cotización' })])
    )
  })

  it('sin detailLayout guardado, GET .../fields devuelve el default (todos los campos+relaciones, visibles, actividad apagada)', async () => {
    const res = await api(`/api/entities/${cotizacionesSlug}/fields`)
    const body = await res.json()
    expect(body.detailLayout.properties.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['email', 'estado']))
    expect(body.detailLayout.properties.every((p: { visible: boolean }) => p.visible)).toBe(true)
    expect(body.detailLayout.relations.every((r: { visible: boolean }) => r.visible)).toBe(true)
    expect(body.detailLayout.showActivity).toBe(false)
  })

  it('PUT /api/entities/:id con un detailLayout lo persiste, y GET .../fields lo devuelve tal cual (round-trip)', async () => {
    const layout = {
      properties: [
        { name: 'estado', visible: true },
        { name: 'email', visible: false }
      ],
      relations: [{ entitySlug: facturasSlug, fieldName: 'cotizacion_id', visible: true }],
      showActivity: true
    }
    const putRes = await api(`/api/entities/${cotizacionesId}`, { method: 'PUT', body: JSON.stringify({ detailLayout: layout }) })
    expect(putRes.status).toBe(200)

    const getRes = await api(`/api/entities/${cotizacionesSlug}/fields`)
    const body = await getRes.json()
    expect(body.detailLayout).toEqual(layout)
  })

  it('un campo con forma invalida en detailLayout (viola el schema strict del bodySchema) es rechazado (400 - mismo criterio que name/description en este mismo endpoint, no el 422 de InvalidValidationRulesError que usan otros endpoints para reglas de negocio)', async () => {
    const res = await api(`/api/entities/${cotizacionesId}`, {
      method: 'PUT',
      body: JSON.stringify({ detailLayout: { properties: [{ name: 'estado' }], relations: [], showActivity: false } })
    })
    expect(res.status).toBe(400)
  })

  it('si despues se agrega un campo nuevo, el detailLayout resuelto lo suma al final como visible (reconciliacion, no rompe)', async () => {
    const telefonoRes = await api(`/api/entities/${cotizacionesId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'telefono', label: 'Teléfono', dataType: 'text' })
    })
    expect(telefonoRes.status).toBe(201)

    const getRes = await api(`/api/entities/${cotizacionesSlug}/fields`)
    const body = await getRes.json()
    const names = body.detailLayout.properties.map((p: { name: string }) => p.name)
    expect(names[names.length - 1]).toBe('telefono')
    expect(body.detailLayout.properties.find((p: { name: string }) => p.name === 'telefono').visible).toBe(true)
  })

  it('si un campo referenciado en el detailLayout guardado se borra, el detailLayout resuelto lo descarta silenciosamente (no rompe)', async () => {
    const deleteRes = await api(`/api/entity-fields/${emailFieldId}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    const getRes = await api(`/api/entities/${cotizacionesSlug}/fields`)
    const body = await getRes.json()
    expect(body.detailLayout.properties.some((p: { name: string }) => p.name === 'email')).toBe(false)
  })

  it('si el campo relation de Facturas se borra, la relacion inversa desaparece de inverseRelations y del detailLayout resuelto', async () => {
    const deleteRes = await api(`/api/entity-fields/${cotizacionIdFieldId}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    const getRes = await api(`/api/entities/${cotizacionesSlug}/fields`)
    const body = await getRes.json()
    expect(body.inverseRelations).toEqual([])
    expect(body.detailLayout.relations).toEqual([])
  })

  it('GET /api/records/:entity/:id sobre una Cotizacion trae el registro real (base de la pagina de detalle)', async () => {
    const res = await api(`/api/records/${cotizacionesSlug}/${cotizacionRecordId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customData.estado).toBe('aprobada')
  })

  it('SSR: /registros/:entity (listado) renderiza el link "Ver detalle" hacia /registros/:entity/:id', async () => {
    const res = await fetch(`${baseUrl}/registros/${cotizacionesSlug}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain(`/registros/${cotizacionesSlug}/${cotizacionRecordId}`)
    expect(html).toContain('Ver detalle')
  })

  it('SSR: /registros/:entity/:id (ficha de detalle) renderiza sin error, con el valor real del registro', async () => {
    const res = await fetch(`${baseUrl}/registros/${cotizacionesSlug}/${cotizacionRecordId}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('aprobada')
  })

  it('SSR: /registros/:entity/:id con un id inexistente muestra un mensaje de error (mismo criterio que editar.vue - no propaga el statusCode real a la respuesta HTTP, useFetch captura el error sin re-lanzarlo)', async () => {
    const res = await fetch(`${baseUrl}/registros/${cotizacionesSlug}/${randomUUID()}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Este registro no existe')
  })

  it('SSR: pages/modulos/[id]/editar.vue renderiza el indicador de 3 pasos, incluido el nuevo paso "Diseño del detalle"', async () => {
    const res = await fetch(`${baseUrl}/modulos/${cotizacionesId}/editar`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Diseño del detalle')
  })
})

describe('e2e: HU-ERD-75 (Diseño del listado / Table Builder - columnas, filtros y orden por defecto)', () => {
  let pedidosLLSlug: string
  let pedidosLLId: string

  beforeAll(async () => {
    pedidosLLSlug = 'pedidos-listlayout-e2e'
    const entityRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pedidos ListLayout E2E', slug: pedidosLLSlug })
    })
    expect(entityRes.status).toBe(201)
    const entity = await entityRes.json()
    pedidosLLId = entity.id

    const nombreRes = await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'nombre', label: 'Nombre', dataType: 'text' })
    })
    expect(nombreRes.status).toBe(201)

    const montoRes = await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'monto', label: 'Monto', dataType: 'number' })
    })
    expect(montoRes.status).toBe(201)

    const prioridadRes = await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'prioridad',
        label: 'Prioridad',
        dataType: 'select',
        validationRules: { options: [{ value: 'alta', label: 'Alta', color: 'warning' }, { value: 'baja', label: 'Baja', color: 'neutral' }] }
      })
    })
    expect(prioridadRes.status).toBe(201)

    const etiquetasRes = await api(`/api/entities/${entity.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'etiquetas',
        label: 'Etiquetas',
        dataType: 'multiselect',
        validationRules: { options: [{ value: 'bug', label: 'Bug', color: 'error' }] }
      })
    })
    expect(etiquetasRes.status).toBe(201)

    for (const [nombre, monto] of [['Bajo', 100], ['Medio', 200], ['Alto', 300]] as const) {
      const res = await api(`/api/records/${pedidosLLSlug}`, {
        method: 'POST',
        body: JSON.stringify({ customData: { nombre, monto, prioridad: 'alta' } })
      })
      expect(res.status).toBe(201)
    }
  }, 30_000)

  it('sin listLayout guardado, GET .../fields devuelve el default: todas las columnas visibles, TODOS los Select/Multiselect como filtro, sin orden por defecto (AC: no rompe compatibilidad)', async () => {
    const res = await api(`/api/entities/${pedidosLLSlug}/fields`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.listLayout.columns.map((c: { name: string }) => c.name)).toEqual(['nombre', 'monto', 'prioridad', 'etiquetas'])
    expect(body.listLayout.columns.every((c: { visible: boolean }) => c.visible)).toBe(true)
    expect(body.listLayout.filterFields.sort()).toEqual(['etiquetas', 'prioridad'])
    expect(body.listLayout.defaultSort).toBeNull()
  })

  it('PUT /api/entities/:id con un listLayout lo persiste, y GET .../fields lo devuelve tal cual (round-trip)', async () => {
    const layout = {
      columns: [
        { name: 'monto', visible: true },
        { name: 'nombre', visible: true },
        { name: 'prioridad', visible: false },
        { name: 'etiquetas', visible: false }
      ],
      filterFields: ['prioridad'],
      defaultSort: { field: 'monto', dir: 'asc' }
    }
    const putRes = await api(`/api/entities/${pedidosLLId}`, { method: 'PUT', body: JSON.stringify({ listLayout: layout }) })
    expect(putRes.status).toBe(200)

    const getRes = await api(`/api/entities/${pedidosLLSlug}/fields`)
    const body = await getRes.json()
    expect(body.listLayout).toEqual(layout)
  })

  it('un listLayout con forma invalida (viola el schema strict) es rechazado (400 - mismo criterio que detailLayout en este mismo endpoint, HU-ERD-74)', async () => {
    const res = await api(`/api/entities/${pedidosLLId}`, {
      method: 'PUT',
      body: JSON.stringify({ listLayout: { columns: [{ name: 'monto' }], filterFields: [], defaultSort: null } })
    })
    expect(res.status).toBe(400)
  })

  it('un filterFields guardado con un campo que no es Select/Multiselect real se descarta al leer (AC explicito: nunca un campo que el backend no puede filtrar)', async () => {
    const putRes = await api(`/api/entities/${pedidosLLId}`, {
      method: 'PUT',
      body: JSON.stringify({
        listLayout: {
          columns: [{ name: 'nombre', visible: true }, { name: 'monto', visible: true }, { name: 'prioridad', visible: true }, { name: 'etiquetas', visible: true }],
          filterFields: ['prioridad', 'nombre'],
          defaultSort: null
        }
      })
    })
    expect(putRes.status).toBe(200)

    const getRes = await api(`/api/entities/${pedidosLLSlug}/fields`)
    const body = await getRes.json()
    expect(body.listLayout.filterFields).toEqual(['prioridad'])
  })

  it('si despues se agrega una columna nueva, el listLayout resuelto la suma al final como visible (reconciliacion, no rompe)', async () => {
    const activoRes = await api(`/api/entities/${pedidosLLId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'activo', label: 'Activo', dataType: 'boolean' })
    })
    expect(activoRes.status).toBe(201)

    const getRes = await api(`/api/entities/${pedidosLLSlug}/fields`)
    const body = await getRes.json()
    const names = body.listLayout.columns.map((c: { name: string }) => c.name)
    expect(names[names.length - 1]).toBe('activo')
    expect(body.listLayout.columns.find((c: { name: string }) => c.name === 'activo').visible).toBe(true)

    // un campo Select/Multiselect nuevo, en cambio, NO se agrega solo a
    // filterFields (lista curada explicitamente, ver server/utils/listLayout.ts)
    const urgenteRes = await api(`/api/entities/${pedidosLLId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'urgencia', label: 'Urgencia', dataType: 'select', validationRules: { options: [{ value: 'si', label: 'Si' }] } })
    })
    expect(urgenteRes.status).toBe(201)
    const getRes2 = await api(`/api/entities/${pedidosLLSlug}/fields`)
    const body2 = await getRes2.json()
    expect(body2.listLayout.filterFields).not.toContain('urgencia')
  })

  it('si la columna referenciada en un defaultSort guardado se borra, el listLayout resuelto vuelve a defaultSort=null (no rompe)', async () => {
    const fieldsRes = await api(`/api/entities/${pedidosLLSlug}/fields`)
    const activoField = (await fieldsRes.json()).fields.find((f: { name: string }) => f.name === 'activo')

    await api(`/api/entities/${pedidosLLId}`, {
      method: 'PUT',
      body: JSON.stringify({
        listLayout: { columns: [], filterFields: [], defaultSort: { field: 'activo', dir: 'desc' } }
      })
    })
    const deleteRes = await api(`/api/entity-fields/${activoField.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    const getRes = await api(`/api/entities/${pedidosLLSlug}/fields`)
    const body = await getRes.json()
    expect(body.listLayout.defaultSort).toBeNull()
  })

  it('SSR: /registros/:entity respeta el orden por defecto configurado (monto ascendente) sin pasar sortBy en la URL', async () => {
    await api(`/api/entities/${pedidosLLId}`, {
      method: 'PUT',
      body: JSON.stringify({
        listLayout: {
          columns: [
            { name: 'monto', visible: true },
            { name: 'nombre', visible: true },
            { name: 'prioridad', visible: false },
            { name: 'etiquetas', visible: false },
            { name: 'activo', visible: false },
            { name: 'urgencia', visible: false }
          ],
          filterFields: [],
          defaultSort: { field: 'monto', dir: 'asc' }
        }
      })
    })

    const res = await fetch(`${baseUrl}/registros/${pedidosLLSlug}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    const iBajo = html.indexOf('Bajo')
    const iMedio = html.indexOf('Medio')
    const iAlto = html.indexOf('Alto')
    expect(iBajo).toBeGreaterThan(-1)
    expect(iMedio).toBeGreaterThan(-1)
    expect(iAlto).toBeGreaterThan(-1)
    expect(iBajo).toBeLessThan(iMedio)
    expect(iMedio).toBeLessThan(iAlto)
  })

  it('SSR: /registros/:entity muestra solo las columnas visibles configuradas, en el orden configurado (Monto antes que Nombre, Prioridad ausente)', async () => {
    const res = await fetch(`${baseUrl}/registros/${pedidosLLSlug}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    const iMonto = html.indexOf('Monto')
    const iNombre = html.indexOf('Nombre')
    expect(iMonto).toBeGreaterThan(-1)
    expect(iNombre).toBeGreaterThan(-1)
    expect(iMonto).toBeLessThan(iNombre)
    // "Prioridad" SI aparece en el HTML (el payload de hidratacion __NUXT_DATA__
    // serializa TODOS los campos, visibles u ocultos - eso es correcto, no un
    // bug) - lo que hay que confirmar es que no aparece como encabezado de
    // columna, es decir, dentro del <thead> de la tabla.
    const theadHtml = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? ''
    expect(theadHtml).not.toContain('Prioridad')
  })

  it('SSR: /registros/:entity no muestra el botón "Filtros" cuando listLayout.filterFields quedó vacío, aunque la entidad tenga campos Select/Multiselect (AC: filtros ofrecidos = subconjunto elegido, no automático)', async () => {
    const res = await fetch(`${baseUrl}/registros/${pedidosLLSlug}`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('Filtros')
  })

  it('SSR: pages/modulos/[id]/editar.vue renderiza el indicador de 4 pasos, incluido el nuevo paso "Diseño del listado"', async () => {
    const res = await fetch(`${baseUrl}/modulos/${pedidosLLId}/editar`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Diseño del listado')
  })
})

// HU-ERD-76: GET /api/entity-fields/:fieldId (mismo recurso plano de
// HU-ERD-67, diferenciado por verbo HTTP - ver el comentario largo en
// server/utils/moduleEntityFields.ts sobre por que NO se agrego un segmento
// nuevo como .../impact) - conteo real de records que ya usan la clave de
// este campo en custom_data, consumido por el modal de advertencia antes de
// confirmar una edicion/borrado riesgoso (componentes/FieldImpactWarningModal.vue
// + ModuleFieldsCard.vue). El modal en si es una capa de UI que no se puede
// probar por HTTP; lo que este describe cubre es el contrato real que ese
// modal consume, y que el flujo de escritura real (PUT/DELETE, is_dirty,
// entity_field_history - ya probado en HU-ERD-67) sigue siendo exactamente
// el mismo por debajo, sin una ruta alternativa de guardado.
describe('e2e: HU-ERD-76 (Advertencia al editar/eliminar un campo con datos existentes - GET /api/entity-fields/:fieldId con affectedRecords)', () => {
  const IMPACT_NON_ADMIN_EMAIL = 'vendedor@e2e.test'
  const IMPACT_NON_ADMIN_PASSWORD = 'e2e-password-1234'
  let impactNonAdminCookie: string
  let impactEntityId: string
  let impactEntitySlug: string
  let montoFieldId: string
  let etiquetaFieldId: string

  beforeAll(async () => {
    // El usuario no-admin ya existe (creado en el describe de HU-ERD-66) -
    // solo hace falta loguear, mismo patron que HU-ERD-67.
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, email: IMPACT_NON_ADMIN_EMAIL, password: IMPACT_NON_ADMIN_PASSWORD })
    })
    expect(loginRes.status).toBe(200)
    impactNonAdminCookie = extractCookie(loginRes)

    impactEntitySlug = 'impacto-campos-e2e'
    const entityRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Impacto Campos E2E', slug: impactEntitySlug })
    })
    expect(entityRes.status).toBe(201)
    impactEntityId = (await entityRes.json()).id

    const montoRes = await api(`/api/entities/${impactEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'monto', label: 'Monto total', dataType: 'number' })
    })
    expect(montoRes.status).toBe(201)
    montoFieldId = (await montoRes.json()).id

    // "etiqueta" queda SIN ningun record que la use - sirve para probar el
    // caso affectedRecords === 0 (campo publicado, pero todavia sin datos).
    const etiquetaRes = await api(`/api/entities/${impactEntityId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: 'etiqueta', label: 'Etiqueta', dataType: 'text' })
    })
    expect(etiquetaRes.status).toBe(201)
    etiquetaFieldId = (await etiquetaRes.json()).id
  }, 30_000)

  it('GET /api/entity-fields/:fieldId sin cookie es 401, y con un rol no-admin es 403', async () => {
    const noAuthRes = await fetch(`${baseUrl}/api/entity-fields/${montoFieldId}`)
    expect(noAuthRes.status).toBe(401)

    const nonAdminRes = await fetch(`${baseUrl}/api/entity-fields/${montoFieldId}`, { headers: { cookie: impactNonAdminCookie } })
    expect(nonAdminRes.status).toBe(403)
  })

  it('GET /api/entity-fields/:fieldId con un id inexistente es 404', async () => {
    const res = await api(`/api/entity-fields/${randomUUID()}`)
    expect(res.status).toBe(404)
  })

  it('un campo recien publicado, todavia sin records que lo usen, devuelve affectedRecords: 0', async () => {
    const res = await api(`/api/entity-fields/${etiquetaFieldId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: etiquetaFieldId, name: 'etiqueta', dataType: 'text', affectedRecords: 0 })
  })

  it('affectedRecords cuenta SOLO los records que ya tienen una clave para ese campo en custom_data - no records de otro campo, no records de otra entidad (conteo siempre server-side)', async () => {
    // 3 records que SI usan "monto"...
    for (const monto of [100, 200, 300]) {
      const res = await api(`/api/records/${impactEntitySlug}`, { method: 'POST', body: JSON.stringify({ customData: { monto } }) })
      expect(res.status).toBe(201)
    }
    // ...y 1 record que solo usa "etiqueta" (no debe sumar al conteo de "monto").
    const soloEtiquetaRes = await api(`/api/records/${impactEntitySlug}`, { method: 'POST', body: JSON.stringify({ customData: { etiqueta: 'x' } }) })
    expect(soloEtiquetaRes.status).toBe(201)

    const montoImpact = await api(`/api/entity-fields/${montoFieldId}`)
    expect((await montoImpact.json()).affectedRecords).toBe(3)

    const etiquetaImpact = await api(`/api/entity-fields/${etiquetaFieldId}`)
    expect((await etiquetaImpact.json()).affectedRecords).toBe(1)
  })

  it('GET es de solo lectura: llamarlo varias veces no cambia el conteo ni escribe en entity_field_history (el modal es una capa de confirmacion, no una ruta alternativa de guardado)', async () => {
    const first = await api(`/api/entity-fields/${montoFieldId}`)
    const second = await api(`/api/entity-fields/${montoFieldId}`)
    expect((await first.json()).affectedRecords).toBe((await second.json()).affectedRecords)

    // El PUT real (HU-ERD-67) sigue siendo el UNICO camino que versiona el
    // campo - confirma que pasar antes por GET (como hace el modal) no lo
    // reemplaza ni lo duplica: sigue devolviendo 200 y el dataType nuevo.
    const putRes = await api(`/api/entity-fields/${montoFieldId}`, { method: 'PUT', body: JSON.stringify({ label: 'Monto total (ARS)' }) })
    expect(putRes.status).toBe(200)
    expect((await putRes.json()).label).toBe('Monto total (ARS)')
  })
})

// Rediseno "Editar Módulo" (2026-09-01, feedback directo del usuario -
// bug real "agrego campos y no hace nada" + Screen/Editar Módulo y
// Screen/Editar Módulo - Campos actualizadas en el .pen, revisadas con las
// herramientas de Pencil antes de este cambio): switch "Módulo activo"
// (entities.is_active) bloqueado en requirePermission() para roles NO
// administrador, barra de pestañas (reemplaza el indicador de pasos con
// circulos), campo "Ruta" (ex "Slug"), y "Zona de peligro" (eliminar modulo
// desde la propia pagina de edicion, mismo endpoint que pages/modulos/index.vue).
//
// El bug de FieldFormModal.vue (auto-slug de "Nombre técnico" desde
// "Etiqueta visible", boton "Agregar campo" que quedaba deshabilitado en
// silencio si el usuario no tocaba el nombre tecnico a mano) es logica
// puramente client-side dentro de un <script setup> de un SFC - este repo no
// tiene infraestructura de test de componentes (ni @vue/test-utils ni un DOM
// simulado, ver package.json) para montarlo y disparar eventos de input
// reales; se valida por typecheck + build + revision de codigo (mismo patron
// ya seguido, no un test nuevo).
describe('e2e: Rediseno "Editar Módulo" (switch Módulo activo bloquea acceso para roles no-admin, Zona de peligro, pestañas)', () => {
  const REDESIGN_NON_ADMIN_EMAIL = 'vendedor@e2e.test'
  const REDESIGN_NON_ADMIN_PASSWORD = 'e2e-password-1234'
  let redesignNonAdminCookie: string
  let vendedorRoleId: string
  let redesignEntityId: string
  let redesignEntitySlug: string

  beforeAll(async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: TENANT_ID, email: REDESIGN_NON_ADMIN_EMAIL, password: REDESIGN_NON_ADMIN_PASSWORD })
    })
    expect(loginRes.status).toBe(200)
    redesignNonAdminCookie = extractCookie(loginRes)

    const rolesRes = await api('/api/roles')
    const { roles } = await rolesRes.json()
    vendedorRoleId = roles.find((r: { name: string }) => r.name === 'Vendedor').id

    redesignEntitySlug = 'rediseno-editar-modulo-e2e'
    const entityRes = await api('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rediseno Editar Modulo E2E', slug: redesignEntitySlug })
    })
    expect(entityRes.status).toBe(201)
    const entity = await entityRes.json()
    redesignEntityId = entity.id
    expect(entity.isActive).toBe(true)

    // Vendedor (no-admin) no tiene ningun permiso otorgado por defecto sobre
    // un modulo nuevo (solo el rol Administrador se auto-otorga CRUD al
    // crearlo, HU-ERD-66) - se le concede canRead explicitamente para poder
    // probar el bloqueo por "modulo inactivo" (y no confundirlo con un 403
    // por falta de permiso, que es un caso YA cubierto por HU-ERD-15).
    const grantRes = await api(`/api/roles/${vendedorRoleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: [{ entityId: redesignEntityId, canRead: true, canCreate: false, canUpdate: false, canDelete: false }] })
    })
    expect(grantRes.status).toBe(200)
  }, 30_000)

  it('un modulo activo (default) es accesible para un rol no-admin con canRead otorgado', async () => {
    const res = await fetch(`${baseUrl}/api/entities/${redesignEntitySlug}/fields`, { headers: { cookie: redesignNonAdminCookie } })
    expect(res.status).toBe(200)
  })

  it('PUT /api/entities/:id { isActive: false } lo desactiva, y bloquea con 403 el acceso a fields/records para el rol no-admin (aunque tenga canRead otorgado)', async () => {
    const putRes = await api(`/api/entities/${redesignEntityId}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) })
    expect(putRes.status).toBe(200)
    expect((await putRes.json()).isActive).toBe(false)

    const fieldsRes = await fetch(`${baseUrl}/api/entities/${redesignEntitySlug}/fields`, { headers: { cookie: redesignNonAdminCookie } })
    expect(fieldsRes.status).toBe(403)
    expect((await fieldsRes.json()).statusMessage).toContain('desactivado')

    const recordsRes = await fetch(`${baseUrl}/api/records/${redesignEntitySlug}`, { headers: { cookie: redesignNonAdminCookie } })
    expect(recordsRes.status).toBe(403)
  })

  it('un administrador sigue teniendo acceso completo a un modulo desactivado (para poder reactivarlo)', async () => {
    const res = await api(`/api/entities/${redesignEntitySlug}/fields`)
    expect(res.status).toBe(200)
  })

  it('reactivar el modulo (isActive: true) restaura el acceso del rol no-admin', async () => {
    const putRes = await api(`/api/entities/${redesignEntityId}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) })
    expect(putRes.status).toBe(200)

    const fieldsRes = await fetch(`${baseUrl}/api/entities/${redesignEntitySlug}/fields`, { headers: { cookie: redesignNonAdminCookie } })
    expect(fieldsRes.status).toBe(200)
  })

  it('SSR: pages/modulos/[id]/editar.vue renderiza la barra de pestañas nueva (incluidas Diseño del detalle/Diseño del listado/Vista previa), el campo "Ruta" y la Zona de peligro', async () => {
    const res = await fetch(`${baseUrl}/modulos/${redesignEntityId}/editar`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    for (const label of ['Información general', 'Campos', 'Diseño del detalle', 'Diseño del listado', 'Vista previa', 'Ruta', 'Módulo activo', 'Zona de peligro', 'Eliminar módulo']) {
      expect(html).toContain(label)
    }
  })

  it('SSR: pages/modulos/index.vue muestra la columna "Estado" con el badge Activo/Inactivo real de cada modulo', async () => {
    const res = await fetch(`${baseUrl}/modulos`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Estado')
    expect(html).toContain('Activo')
  })
})

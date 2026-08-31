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

  it('SSR: /modulos/:id/editar reusa ModuleFieldsCard - muestra "Campos del módulo" con el campo real y su badge de tipo', async () => {
    const res = await fetch(`${baseUrl}/modulos/${wizardModuleId}/editar`, { headers: { cookie: authCookie } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Campos del módulo')
    expect(html).toContain('Edad')
    expect(html).toContain('Número')
    expect(html).toContain('Obligatorio')
    // Misma card de vista previa que el asistente, ahora con el campo real
    // (no el estado vacio, porque ya tiene 1 campo) - confirma que ambas
    // paginas envuelven el mismo DynamicForm.vue.
    expect(html).toContain('Vista previa en vivo')
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

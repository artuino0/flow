import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

const tenantId = randomUUID()
const otherTenant = randomUUID()
const splitTenant = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let sessions: typeof import('../../server/utils/moduleDesigner/sessions')
let credits: typeof import('../../server/utils/moduleDesigner/credits')
let exporter: typeof import('../../server/utils/blueprint/export')
let withTenant: typeof import('../../server/db').withTenant
let userId: string
let splitUserId: string
let adminRoleId: string
let ordinaryRoleId: string
const fetchMock = vi.fn()

function aiReply(value: unknown, input = 50, output = 100) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ model: 'test-designer', choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: input, completion_tokens: output } }), { status: 200 }))
}

async function proposal(name = 'Órdenes', slug = 'ordenes') {
  const base = await exporter.exportBlueprint(tenantId)
  base.modules.push({ ref: slug, action: 'create', kind: 'hecho', name, slug, fields: [{ name: 'nota', label: 'Nota', dataType: 'text' }] })
  return base
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`INSERT INTO tenants (id, name, slug) VALUES (${tenantId}, 'Taller', 'designer-taller'), (${otherTenant}, 'Otro', 'designer-otro'), (${splitTenant}, 'Dividido', 'designer-dividido')`
  const [adminRole] = await admin`INSERT INTO roles (tenant_id, name, is_system) VALUES (${tenantId}, 'Administrador', true) RETURNING id`
  adminRoleId = adminRole.id
  const [ordinaryRole] = await admin`INSERT INTO roles (tenant_id, name, is_system) VALUES (${tenantId}, 'Operador', false) RETURNING id`
  ordinaryRoleId = ordinaryRole.id
  const [person] = await admin`INSERT INTO people (email, password_hash, full_name) VALUES ('designer@test.local', 'x', 'Designer') RETURNING id`
  const [user] = await admin`INSERT INTO users (tenant_id, role_id, person_id) VALUES (${tenantId}, ${adminRoleId}, ${person.id}) RETURNING id`
  userId = user.id
  const [splitRole] = await admin`INSERT INTO roles (tenant_id, name, is_system) VALUES (${splitTenant}, 'Administrador', true) RETURNING id`
  const [splitUser] = await admin`INSERT INTO users (tenant_id, role_id, person_id) VALUES (${splitTenant}, ${splitRole.id}, ${person.id}) RETURNING id`
  splitUserId = splitUser.id
  await admin`INSERT INTO entities (tenant_id, name, singular_name, slug, module_kind) VALUES (${tenantId}, 'Clientes', 'Cliente', 'clientes', 'dimension')`
  process.env.APP_DATABASE_URL = testDb.appUrl
  process.env.AI_PROVIDER = 'openai'
  process.env.OPENAI_API_KEY = 'simulated-key'
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('getRouterParam', (event: any, name: string) => event.context.params?.[name])
  ;({ withTenant } = await import('../../server/db'))
  // Esperas de reintento reales (2 s y 5 s) harían lentas las pruebas; el código las lee en cada llamada.
  const { DESIGNER_RETRY_DELAYS_MS } = await import('../../server/utils/aiProvider')
  DESIGNER_RETRY_DELAYS_MS.splice(0, DESIGNER_RETRY_DELAYS_MS.length, 10, 10)
  sessions = await import('../../server/utils/moduleDesigner/sessions')
  credits = await import('../../server/utils/moduleDesigner/credits')
  exporter = await import('../../server/utils/blueprint/export')
}, 60_000)

beforeEach(() => fetchMock.mockReset())
afterAll(async () => { await admin.end(); await testDb.stop(); vi.unstubAllGlobals() })

describe('diseñador de módulos (Postgres real, IA simulada)', () => {
  it('crea una sesión con la estructura actual y la edición manual no cobra', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId)
    expect((session as { blueprint: { modules: Array<{ slug: string }> } }).blueprint.modules.some(module => module.slug === 'clientes')).toBe(true)
    const edited = await sessions.editSessionBlueprint(tenantId, (session as { id: string }).id, await proposal())
    expect(edited.session.version).toBe(2)
    expect(await admin`SELECT id FROM ai_credit_ledger WHERE session_id = ${(session as { id: string }).id}`).toHaveLength(0)
  })

  it('genera por 2 créditos, itera por 1 y registra tokens y modelo', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const design = await proposal()
    const explanation = 'Propuse Órdenes y reutilicé Clientes.\n### ¿Por qué?\n- **Órdenes**: registra cada solicitud.'
    aiReply({ message: 'Creé las órdenes.', explanation, blueprint: design })
    const generated = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea órdenes')
    expect(generated.explanation).toContain(explanation)
    expect(generated.explanation).toContain('icono genérico')
    expect((await sessions.findSession(tenantId, session.id)).messages.at(-1)?.explanation).toBe(generated.explanation)
    aiReply({ message: 'Ajusté las órdenes.', blueprint: design }, 25, 40)
    await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Ajusta las órdenes')
    const rows = await admin`SELECT kind, credits, input_tokens, output_tokens, model FROM ai_credit_ledger WHERE session_id = ${session.id} ORDER BY created_at, id`
    expect(rows.map(row => [row.kind, row.credits])).toEqual([['generate', 2], ['iterate', 1]])
    expect(rows[0]).toMatchObject({ input_tokens: 50, output_tokens: 100, model: 'test-designer' })
    expect((await sessions.findSession(tenantId, session.id)).creditsConsumed).toBe(3)
  })

  it('acepta estados en arreglo del proveedor, advierte pérdidas y aplica el flujo', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const design = await proposal('Pedidos con estados', 'pedidos-estados') as unknown as { modules: Array<{ fields: unknown[]; workflow?: unknown }> }
    const module = design.modules[design.modules.length - 1]!
    module.fields.push({ name: 'estado', label: 'Estado', dataType: 'select', validationRules: { options: [{ value: 'recibido', label: 'Recibido' }, { value: 'confirmado', label: 'Confirmado' }] } })
    module.workflow = { field: 'estado', states: ['recibido', 'confirmado'], transitions: [{ from: 'recibido', to: 'confirmado' }, { from: 'confirmado', to: 'desconocido' }], rules: [{ type: 'required', when: 'confirmado', fields: ['nota'], message: 'Falta nota' }] }
    aiReply({ message: 'Preparé los pedidos.', blueprint: design })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea pedidos con estados')
    expect(result.message).toContain('transición 2')
    expect(result.message).toContain('regla 1')
    expect(result.explanation).toContain('- **Ajuste automático:**')
    expect(result.explanation).toContain('transición 2')
    expect(result.explanation).toContain('regla 1')
    expect(result.blueprint.modules.find(item => item.slug === 'pedidos-estados')?.workflow?.transitions).toEqual([{ from: 'recibido', to: 'confirmado', roles: 'all' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await sessions.applySession(tenantId, userId, session.id)
    const [saved] = await admin`SELECT workflow_config FROM entities WHERE tenant_id = ${tenantId} AND slug = 'pedidos-estados'`
    expect(saved.workflow_config).toMatchObject({ enabled: true, initial: 'recibido', states: { recibido: { locked: false, editableFields: [] } }, transitions: [{ from: 'recibido', to: 'confirmado', roles: 'all' }] })
  })

  it('sustituye un icono inexistente del proveedor sin rechazar ni cobrar otro intento', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const design = await proposal('Proveedores con icono', 'proveedores-icono')
    design.modules[design.modules.length - 1]!.icon = 'IconoInexistente'
    aiReply({ message: 'Preparé proveedores.', blueprint: design })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea proveedores')
    expect(result.blueprint.modules.find(item => item.slug === 'proveedores-icono')?.icon).toBe('Box')
    expect(result.message).toContain('Usé un icono genérico para Proveedores con icono')
    expect(result.explanation).toContain('- **Ajuste automático:** Usé un icono genérico para Proveedores con icono')
    expect(result.explanation).toContain('### ¿Por qué?')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const saved = await sessions.findSession(tenantId, session.id)
    expect((saved.blueprint as Awaited<ReturnType<typeof proposal>>).modules.find(item => item.slug === 'proveedores-icono')?.icon).toBe('Box')
  })

  it('autorrepara una respuesta inválida con una sola llamada adicional sin cobrarla', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    aiReply({ message: 'Borrador', explanation: 'Borrador.\n### ¿Por qué?\n- **Órdenes**: registra solicitudes.', blueprint: { version: 1, summary: 'Inválido', modules: [{ bad: true }], associations: [] } })
    aiReply({ message: 'Corregido', explanation: 'Corregí Órdenes.\n### ¿Por qué?\n- **Órdenes**: registra solicitudes válidas.', blueprint: await proposal() })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea órdenes')
    expect(result.message).toContain('Corregido')
    expect(result.explanation).toContain('Corregí Órdenes')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const rows = await admin`SELECT credits, input_tokens FROM ai_credit_ledger WHERE session_id = ${session.id}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ credits: 2, input_tokens: 100 })
  })

  it('fusiona un duplicado persistente y lo explica en el chat', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const duplicate = await proposal('Cliente', 'cliente-nuevo')
    duplicate.modules[duplicate.modules.length - 1]!.kind = 'dimension'
    aiReply({ message: 'Agregué clientes.', blueprint: duplicate })
    aiReply({ message: 'Agregué clientes.', blueprint: duplicate })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Necesito clientes')
    expect(result.merges).toHaveLength(1)
    expect(result.message).toContain('Usé tu módulo Clientes existente')
    expect(result.blueprint.modules.filter(module => module.slug === 'clientes')).toHaveLength(1)
  })

  it('devuelve el crédito ante fallo de proveedor y permite reintentar', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    fetchMock.mockRejectedValueOnce(new Error('timeout simulado'))
    await expect((await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea órdenes')).rejects.toMatchObject({ statusCode: 503, data: { code: 'ai_unavailable' } })
    expect((await sessions.findSession(tenantId, session.id)).status).toBe('error')
    expect(await admin`SELECT kind, credits FROM ai_credit_ledger WHERE session_id = ${session.id} ORDER BY created_at, id`).toMatchObject([{ kind: 'generate', credits: 2 }, { kind: 'refund', credits: 2 }])
    aiReply({ message: 'Listo', blueprint: await proposal() })
    await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Reintenta')
    expect((await sessions.findSession(tenantId, session.id)).status).toBe('draft')
  })

  it('responde 503 ai_unavailable ante proveedor saturado persistente y la sesión queda recuperable', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    fetchMock.mockImplementation(async () => new Response('overloaded', { status: 503 }))
    await expect((await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea órdenes'))
      .rejects.toMatchObject({ statusCode: 503, statusMessage: 'La IA está saturada en este momento. No se cobraron créditos; intenta de nuevo en un minuto.', data: { code: 'ai_unavailable' } })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect((await sessions.findSession(tenantId, session.id)).status).toBe('error')
    expect(await admin`SELECT kind, credits FROM ai_credit_ledger WHERE session_id = ${session.id} ORDER BY created_at, id`).toMatchObject([{ kind: 'generate', credits: 2 }, { kind: 'refund', credits: 2 }])
    fetchMock.mockReset()
    aiReply({ message: 'Listo', blueprint: await proposal() })
    await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Reintenta')
    expect((await sessions.findSession(tenantId, session.id)).status).toBe('draft')
  })

  it('no reintenta un 404 del proveedor', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    fetchMock.mockImplementation(async () => new Response('not found', { status: 404 }))
    await expect((await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea órdenes')).rejects.toThrow('HTTP 404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('consume paquetes cuando se agotan los incluidos y protege reservas simultáneas', async () => {
    await withTenant(tenantId, tx => tx.execute(sql`INSERT INTO tenant_limit_overrides (tenant_id, concept, value, reason) VALUES (${tenantId}::uuid, 'aiCredits', 0, 'Prueba de paquetes') ON CONFLICT (tenant_id, concept) DO UPDATE SET value = 0`))
    const { invalidatePlanCache } = await import('../../server/utils/plans')
    invalidatePlanCache(tenantId)
    const one = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    await expect((await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, one.id, 'Crea órdenes')).rejects.toMatchObject({ statusCode: 402, data: { code: 'ai_credits' } })
    const [pack] = await admin`INSERT INTO ai_credit_packages (tenant_id, quantity, remaining, origin) VALUES (${tenantId}, 2, 2, 'manual') RETURNING id`
    aiReply({ message: 'Listo', blueprint: await proposal() })
    await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, one.id, 'Crea órdenes')
    expect((await admin`SELECT remaining FROM ai_credit_packages WHERE id = ${pack.id}`)[0]?.remaining).toBe(0)
    const two = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const three = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const [pack2] = await admin`INSERT INTO ai_credit_packages (tenant_id, quantity, remaining, origin) VALUES (${tenantId}, 2, 2, 'manual') RETURNING id`
    aiReply({ message: 'Listo', blueprint: await proposal() })
    const outcomes = await Promise.allSettled([two, three].map(session => (import('../../server/utils/moduleDesigner/generate')).then(module => module.generateDesign(tenantId, session.id, 'Crea órdenes'))))
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect((await admin`SELECT remaining FROM ai_credit_packages WHERE id = ${pack2.id}`)[0]?.remaining).toBe(0)
    await admin`DELETE FROM tenant_limit_overrides WHERE tenant_id = ${tenantId} AND concept = 'aiCredits'`
    invalidatePlanCache(tenantId)
  })

  it('registra los tokens una vez cuando el cobro se reparte entre incluidos y paquete', async () => {
    await admin`INSERT INTO tenant_limit_overrides (tenant_id, concept, value, reason) VALUES (${splitTenant}, 'aiCredits', 1, 'Prueba de cobro dividido')`
    await admin`INSERT INTO ai_credit_packages (tenant_id, quantity, remaining, origin) VALUES (${splitTenant}, 1, 1, 'manual')`
    const session = await sessions.createModuleDesignSession(splitTenant, splitUserId) as { id: string }
    const design = await exporter.exportBlueprint(splitTenant)
    design.modules.push({ ref: 'ordenes', action: 'create', kind: 'hecho', name: 'Órdenes', slug: 'ordenes', fields: [{ name: 'nota', label: 'Nota', dataType: 'text' }] })
    aiReply({ message: 'Listo', blueprint: design })
    await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(splitTenant, session.id, 'Crea órdenes')
    const rows = await admin`SELECT credits, input_tokens, output_tokens FROM ai_credit_ledger WHERE session_id = ${session.id}`
    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.credits, 0)).toBe(2)
    expect(rows.reduce((sum, row) => sum + row.input_tokens, 0)).toBe(50)
    expect(rows.reduce((sum, row) => sum + row.output_tokens, 0)).toBe(100)
  })

  it('recupera una reserva huérfana al abrir la sesión y no reembolsa dos veces', async () => {
    await admin`INSERT INTO tenant_limit_overrides (tenant_id, concept, value, reason) VALUES (${otherTenant}, 'aiCredits', 1, 'Prueba de reserva huérfana')`
    await admin`INSERT INTO ai_credit_packages (tenant_id, quantity, remaining, origin) VALUES (${otherTenant}, 1, 1, 'manual')`
    const session = await sessions.createModuleDesignSession(otherTenant, userId) as { id: string }
    const reservations = await credits.reserveAiCredits(otherTenant, session.id, 2, 'generate')
    expect(reservations).toHaveLength(2)
    const { getDesignerTimeoutMs } = await import('../../server/utils/aiProvider')
    const expiredAt = new Date(Date.now() - getDesignerTimeoutMs() * 2 - 1000)
    await admin`UPDATE module_design_sessions SET processing_at = ${expiredAt} WHERE id = ${session.id}`

    const recovered = await sessions.findSession(otherTenant, session.id)
    expect(recovered.status).toBe('error')
    expect(recovered.processingAt).toBeNull()
    const ledger = await admin`SELECT kind, credits, settled_at FROM ai_credit_ledger WHERE session_id = ${session.id} ORDER BY kind, credits`
    expect(ledger).toHaveLength(4)
    expect(ledger.filter(row => row.kind === 'refund')).toHaveLength(2)
    expect(ledger.every(row => row.settled_at !== null)).toBe(true)
    expect((await admin`SELECT remaining FROM ai_credit_packages WHERE tenant_id = ${otherTenant}`)[0]?.remaining).toBe(1)

    await sessions.findSession(otherTenant, session.id)
    expect(await admin`SELECT id FROM ai_credit_ledger WHERE session_id = ${session.id} AND kind = 'refund'`).toHaveLength(2)
  })

  it('aplica la estructura una sola vez y aísla sesiones de otros tenants', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    await sessions.editSessionBlueprint(tenantId, session.id, await proposal('Garantías', 'garantias'))
    await sessions.applySession(tenantId, userId, session.id)
    await sessions.applySession(tenantId, userId, session.id)
    expect(await admin`SELECT id FROM entities WHERE tenant_id = ${tenantId} AND slug = 'garantias'`).toHaveLength(1)
    await expect(sessions.findSession(otherTenant, session.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rechaza texto ejecutable en ediciones manuales', async () => {
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const unsafe = await proposal('Enlaces', 'enlaces')
    unsafe.modules[unsafe.modules.length - 1]!.fields[0]!.label = 'https://ejemplo.test/ejecutar'
    await expect(sessions.editSessionBlueprint(tenantId, session.id, unsafe)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('fusiona un campo equivalente dentro de la instantánea existente', async () => {
    const [client] = await admin`SELECT id FROM entities WHERE tenant_id = ${tenantId} AND slug = 'clientes'`
    await admin`INSERT INTO entity_fields (entity_id, name, label, data_type) VALUES (${client.id}, 'codigo', 'Código', 'text')`
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const duplicated = await exporter.exportBlueprint(tenantId)
    duplicated.modules.find(module => module.slug === 'clientes')!.fields.push({ name: 'codigos', label: 'Códigos', dataType: 'text' })
    const explanation = 'Reutilicé Clientes.\n### ¿Por qué?\n- **Clientes**: evita duplicar el código.'
    aiReply({ message: 'Añadí códigos', explanation, blueprint: duplicated })
    aiReply({ message: 'Añadí códigos', blueprint: duplicated })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Agrega códigos a Clientes')
    expect(result.merges.some(merge => merge.message.includes('campo codigo'))).toBe(true)
    expect(result.explanation).toContain(explanation)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.blueprint.modules.find(module => module.slug === 'clientes')!.fields.map(field => field.name)).toEqual(['codigo'])
  })

  it('limita mensajes por usuario y por tenant con estado compartido en PostgreSQL', async () => {
    const { checkDesignerMessageRate } = await import('../../server/utils/moduleDesigner/rateLimit')
    for (let i = 0; i < 10; i++) await checkDesignerMessageRate(tenantId, userId)
    await expect(checkDesignerMessageRate(tenantId, userId)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('bloquea usuarios sin rol administrador y permite Agenda', async () => {
    const event = { context: { auth: { tenantId, sub: userId, roleId: ordinaryRoleId } } } as any
    await expect(sessions.requireDesignerAccess(event)).rejects.toMatchObject({ statusCode: 403 })
    const [agenda] = await admin`SELECT id FROM plans WHERE key = 'agenda'`
    await admin`UPDATE tenant_subscriptions SET plan_id = ${agenda.id} WHERE tenant_id = ${tenantId}`
    event.context.auth.roleId = adminRoleId
    await expect(sessions.requireDesignerAccess(event)).resolves.toMatchObject({ tenantId, sub: userId, roleId: adminRoleId })
  })

  it('autorrepara una auto-asociación inválida propuesta por el proveedor simulado', async () => {
    await admin`INSERT INTO ai_credit_packages (tenant_id, quantity, remaining, origin) VALUES (${tenantId}, 2, 2, 'manual')`
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const invalid = await proposal('Perfiles de doctor', 'perfiles-doctor')
    invalid.associations.push({ name: 'Perfil de usuario doctor', sourceRef: 'perfiles-doctor', targetRef: 'perfiles-doctor' })
    aiReply({ message: 'Propuse un perfil.', blueprint: invalid })
    aiReply({ message: 'Corregí el perfil.', blueprint: await proposal('Perfiles de doctor', 'perfiles-doctor') })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea perfiles de doctor')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.blueprint.associations).toEqual([])
    expect(result.message).toContain('Corregí el perfil')
    const saved = await sessions.findSession(tenantId, session.id)
    expect((saved.blueprint as { associations: unknown[] }).associations).toEqual([])
  })

  it('normaliza una asociación duplicada por relation y la explica', async () => {
    await admin`INSERT INTO ai_credit_packages (tenant_id, quantity, remaining, origin) VALUES (${tenantId}, 2, 2, 'manual')`
    const session = await sessions.createModuleDesignSession(tenantId, userId) as { id: string }
    const design = await proposal()
    design.modules.at(-1)!.fields.push({ name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } })
    design.associations.push({ name: 'Orden cliente', sourceRef: 'ordenes', targetRef: 'clientes' })
    aiReply({ message: 'Preparé órdenes.', blueprint: design })
    const result = await (await import('../../server/utils/moduleDesigner/generate')).generateDesign(tenantId, session.id, 'Crea órdenes con cliente')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.blueprint.associations).toEqual([])
    expect(result.explanation).toContain('Omití la asociación «Orden cliente»')
  })
})

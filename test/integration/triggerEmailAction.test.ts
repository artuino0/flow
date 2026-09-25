import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { executeTriggerActions as ExecuteTriggerActions } from '../../server/utils/triggerActions'
import type { runJobQueueTick as RunJobQueueTick } from '../../server/utils/jobQueue'

// HU-ERD-50: accion "email" de un trigger, contra Postgres real (mismo
// patron que triggerActions.test.ts, ERD-49) con nodemailer mockeado (mismo
// criterio que users.test.ts, ERD-84) - este test NO manda correos reales.

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}))

const TENANT_A = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let executeTriggerActions: typeof ExecuteTriggerActions
let runJobQueueTick: typeof RunJobQueueTick

let entityId: string

function setSmtpEnv(): void {
  process.env.SMTP_HOST = 'smtp.test.local'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_USER = 'user'
  process.env.SMTP_PASSWORD = 'pass'
  process.env.SMTP_FROM = 'Flow <no-responder@test.local>'
}

async function insertTrigger(name: string): Promise<string> {
  const [row] = await admin`
    insert into triggers (tenant_id, entity_id, name, trigger_event, condition, is_active)
    values (${TENANT_A}, ${entityId}, ${name}, 'on_create', ${admin.json({})}, true)
    returning id
  `
  return row.id as string
}

async function insertEmailAction(triggerId: string, config: { to: string; subject: string; body: string }): Promise<string> {
  const [row] = await admin`
    insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order)
    values (${TENANT_A}, ${triggerId}, 'email', ${admin.json(config as never)}, 0)
    returning id
  `
  return row.id as string
}

async function insertRecord(customData: Record<string, unknown>): Promise<string> {
  const [row] = await admin`
    insert into records (entity_id, tenant_id, custom_data) values (${entityId}, ${TENANT_A}, ${admin.json(customData as never)}) returning id
  `
  return row.id as string
}

async function getLog(triggerId: string) {
  const rows = await admin`select * from trigger_logs where trigger_id = ${triggerId} order by created_at desc limit 1`
  return rows[0] as Record<string, unknown> | undefined
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Acme Corp')`
  const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Facturas', 'facturas') returning id`
  entityId = entity.id as string
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'nombre', 'Nombre', 'text')`
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'correo', 'Correo', 'text')`

  process.env.APP_DATABASE_URL = testDb.appUrl
  setSmtpEnv()
  ;({ executeTriggerActions } = await import('../../server/utils/triggerActions'))
  ;({ runJobQueueTick } = await import('../../server/utils/jobQueue'))
  ;(await import('../../server/utils/jobHandlers')).registerDefaultJobHandlers()
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

/** La accion "email" ahora encola; esto corre la cola una vez (sin limite de ritmo) para que el correo salga. */
async function drainQueue() {
  await admin`update job_queue set run_at = now() where status = 'pending'`
  return runJobQueueTick({ ratePerSecond: 1000, budgetMs: 10_000 })
}

beforeEach(async () => {
  await admin`delete from job_queue`
  sendMailMock.mockReset().mockResolvedValue({ messageId: 'test' })
  setSmtpEnv()
})

describe('executeTriggerActions - accion email', () => {
  it('resuelve relaciones del mismo tenant y rechaza registros ajenos', async () => {
    const { templateRelationData } = await import('../../server/utils/templateRelations')
    await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${entityId}, 'cliente', 'Cliente', 'relation', ${admin.json({ relationEntity: 'facturas' })})`
    const related = await insertRecord({ nombre: 'Cliente relacionado' })
    const resolved = await templateRelationData(TENANT_A, entityId, { cliente: related }, ['{{cliente.nombre}}'])
    expect(resolved['cliente.nombre']).toBe('Cliente relacionado')
    const foreignTenant = randomUUID()
    await admin`insert into tenants (id, name) values (${foreignTenant}, 'Otro tenant')`
    const [foreign] = await admin`insert into records (entity_id, tenant_id, custom_data) values (${entityId}, ${foreignTenant}, ${admin.json({ nombre: 'Privado' })}) returning id`
    await expect(templateRelationData(TENANT_A, entityId, { cliente: foreign.id }, ['{{cliente.nombre}}'])).rejects.toThrow('no está disponible')
    expect(sendMailMock).not.toHaveBeenCalled()
  })
  it('exito: interpola to/subject/body contra el customData del record y envia via SMTP', async () => {
    const triggerId = await insertTrigger('Notificar por correo')
    await insertEmailAction(triggerId, { to: '{{correo}}', subject: 'Hola {{nombre}}', body: '<p>Bienvenido, {{nombre}}</p>' })
    const recordId = await insertRecord({ nombre: 'Ana', correo: 'ana@example.com' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Notificar por correo', recordId, 'on_create', {
      nombre: 'Ana',
      correo: 'ana@example.com'
    })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('success')

    // Encolado, no enviado dentro del disparador.
    expect(sendMailMock).not.toHaveBeenCalled()
    expect((await admin`select count(*)::int as n from job_queue where status = 'pending'`)[0]!.n).toBe(1)
    const tick = await drainQueue()
    expect(tick).toMatchObject({ claimed: 1, succeeded: 1, dead: 0 })

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0]
    expect(call.to).toBe('ana@example.com')
    expect(call.subject).toBe('Hola Ana')
    expect(call.html).toContain('Bienvenido, Ana')
  })

  it('escapa HTML en los valores interpolados - nunca inyecta markup del record en el correo', async () => {
    const triggerId = await insertTrigger('Con HTML malicioso')
    await insertEmailAction(triggerId, { to: '{{correo}}', subject: 'Aviso', body: 'Nombre: {{nombre}}' })
    const recordId = await insertRecord({ nombre: '<img src=x onerror=alert(1)>', correo: 'ana@example.com' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Con HTML malicioso', recordId, 'on_create', {
      nombre: '<img src=x onerror=alert(1)>',
      correo: 'ana@example.com'
    })

    await drainQueue()
    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).not.toContain('<img src=x onerror=alert(1)>')
    expect(call.html).toContain('&lt;img')
  })

  it('config invalida (falta "body"): falla permanente, nunca llama sendMail', async () => {
    const triggerId = await insertTrigger('Mal configurado')
    await admin`
      insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order)
      values (${TENANT_A}, ${triggerId}, 'email', ${admin.json({ to: 'a@b.com', subject: 'x' } as never)}, 0)
    `
    const recordId = await insertRecord({ nombre: 'Ana', correo: 'ana@example.com' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Mal configurado', recordId, 'on_create', { nombre: 'Ana', correo: 'ana@example.com' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('failed')
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('el "to" interpolado no da un correo valido (campo ausente en el record): falla permanente', async () => {
    const triggerId = await insertTrigger('Sin correo')
    await insertEmailAction(triggerId, { to: '{{correo}}', subject: 'Aviso', body: 'Hola' })
    const recordId = await insertRecord({ nombre: 'Ana' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Sin correo', recordId, 'on_create', { nombre: 'Ana' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('failed')
    expect(log?.last_error).toContain('correo válido')
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('SMTP sin configurar: falla permanente (no reintentable), con el mensaje explicando que falta', async () => {
    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    delete process.env.SMTP_FROM

    const triggerId = await insertTrigger('Sin SMTP')
    await insertEmailAction(triggerId, { to: '{{correo}}', subject: 'Aviso', body: 'Hola' })
    const recordId = await insertRecord({ correo: 'ana@example.com' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Sin SMTP', recordId, 'on_create', { correo: 'ana@example.com' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('failed')
    expect(log?.last_error).toContain('SMTP')
  })

  it('un error real de SMTP (sendMail rechaza) es reintentable', async () => {
    sendMailMock.mockReset().mockRejectedValue(new Error('Connection timeout'))

    const triggerId = await insertTrigger('SMTP caido')
    await insertEmailAction(triggerId, { to: '{{correo}}', subject: 'Aviso', body: 'Hola' })
    const recordId = await insertRecord({ correo: 'ana@example.com' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'SMTP caido', recordId, 'on_create', { correo: 'ana@example.com' })

    // El disparador ya no reintenta: la cola lo hace con retroceso.
    expect((await getLog(triggerId))?.status).toBe('success')
    const tick = await drainQueue()
    expect(tick).toMatchObject({ claimed: 1, succeeded: 0, retried: 1, dead: 0 })
    const [job] = await admin`select status, attempts, last_error, run_at > now() as delayed from job_queue`
    expect(job).toMatchObject({ status: 'pending', attempts: 1, delayed: true })
    expect(String(job!.last_error)).toContain('Connection timeout')
  })
})

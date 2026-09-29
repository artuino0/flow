import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

const { sendPlainEmail } = vi.hoisted(() => ({ sendPlainEmail: vi.fn(async () => {}) }))
vi.mock('../../server/utils/mailer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/utils/mailer')>(),
  sendPlainEmail
}))

let testDb: TestDb
let admin: postgres.Sql
let sendCriticalEmail: typeof import('../../server/utils/criticalEmail').sendCriticalEmail
let runJobQueueTick: typeof import('../../server/utils/jobQueue').runJobQueueTick
let registerJobHandler: typeof import('../../server/utils/jobQueue').registerJobHandler
let handleEmailJob: typeof import('../../server/utils/jobHandlers').handleEmailJob
const tenantId = randomUUID()
const payload = { to: 'persona@example.test', subject: 'Verifica tu correo', html: '<p>Enlace</p>' }

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${tenantId}, 'Correo inmediato')`
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ sendCriticalEmail } = await import('../../server/utils/criticalEmail'))
  ;({ runJobQueueTick, registerJobHandler } = await import('../../server/utils/jobQueue'))
  ;({ handleEmailJob } = await import('../../server/utils/jobHandlers'))
}, 60_000)

beforeEach(async () => {
  sendPlainEmail.mockReset()
  sendPlainEmail.mockResolvedValue(undefined)
  await admin`delete from job_queue`
})

afterAll(async () => {
  await admin.end()
  await testDb.stop()
  delete process.env.APP_DATABASE_URL
})

describe('correo crítico inmediato', () => {
  it('envía directamente y registra una sola fila exitosa que cuenta para el plan', async () => {
    await sendCriticalEmail(tenantId, payload)
    expect(sendPlainEmail).toHaveBeenCalledTimes(1)
    const rows = await admin`select status, attempts from job_queue where tenant_id = ${tenantId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'succeeded', attempts: 1 })
    registerJobHandler('email', async () => { throw new Error('No debe reenviar') })
    expect((await runJobQueueTick({ budgetMs: 2_000 })).claimed).toBe(0)
    expect(sendPlainEmail).toHaveBeenCalledTimes(1)
  })

  it('si falla SMTP, deja una sola fila pendiente para reintento, sin doble envío', async () => {
    sendPlainEmail.mockRejectedValueOnce(new Error('conexión rota'))
    await sendCriticalEmail(tenantId, payload)
    expect(sendPlainEmail).toHaveBeenCalledTimes(1)
    const rows = await admin`select status, attempts, run_at, last_error from job_queue where tenant_id = ${tenantId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'conexión rota' })
    expect(rows[0]!.run_at.getTime()).toBeGreaterThan(Date.now() + 45_000)
    expect((await runJobQueueTick({ budgetMs: 2_000 })).claimed).toBe(0)
    expect(sendPlainEmail).toHaveBeenCalledTimes(1)
    registerJobHandler('email', handleEmailJob)
    const later = new Date(Date.now() + 70_000)
    expect((await runJobQueueTick({ now: () => later, budgetMs: 2_000 })).succeeded).toBe(1)
    expect(sendPlainEmail).toHaveBeenCalledTimes(2)
    expect((await admin`select status from job_queue where tenant_id = ${tenantId}`)[0]).toMatchObject({ status: 'succeeded' })
    expect((await runJobQueueTick({ now: () => later, budgetMs: 2_000 })).claimed).toBe(0)
    expect(sendPlainEmail).toHaveBeenCalledTimes(2)
  })
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

// Cola de trabajos contra un Postgres real: reparto justo, SKIP LOCKED entre
// procesos, reintentos con retroceso, recuperación, aislamiento RLS y ritmo.
const TENANT_A = randomUUID()
const TENANT_B = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let queue: typeof import('../../server/utils/jobQueue')
let db: typeof import('../../server/db')

const email = (n: number) => ({ to: `dest${n}@example.com`, subject: `Aviso ${n}`, html: '<p>hola</p>' })

async function seed(tenantId: string, count: number, offset = 0) {
  for (let i = 0; i < count; i++) await queue.enqueueEmail(tenantId, email(offset + i))
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT_A}, 'A'), (${TENANT_B}, 'B')`
  process.env.APP_DATABASE_URL = testDb.appUrl
  db = await import('../../server/db')
  queue = await import('../../server/utils/jobQueue')
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

beforeEach(async () => {
  await admin`delete from job_queue`
  queue.clearJobHandlers()
})

describe('encolar', () => {
  it('guarda el trabajo pendiente y no duplica una misma clave de idempotencia', async () => {
    const first = await queue.enqueueEmail(TENANT_A, email(1), { idempotencyKey: 'recordatorio:cita-1' })
    const again = await queue.enqueueEmail(TENANT_A, email(1), { idempotencyKey: 'recordatorio:cita-1' })
    const otherTenant = await queue.enqueueEmail(TENANT_B, email(1), { idempotencyKey: 'recordatorio:cita-1' })
    expect(first).toBeTruthy()
    expect(again).toBeNull()
    expect(otherTenant).toBeTruthy() // la clave es por organización
    expect((await admin`select count(*)::int as n from job_queue`)[0]!.n).toBe(2)
  })

  it('rechaza un correo con destinatario inválido antes de encolarlo', async () => {
    await expect(queue.enqueueEmail(TENANT_A, { to: 'no-es-correo', subject: 's', html: 'h' })).rejects.toThrow()
  })
})

describe('tomar trabajos', () => {
  it('reparte por rondas: como mucho N por organización, aunque una tenga muchos', async () => {
    await seed(TENANT_A, 25)
    await seed(TENANT_B, 3)
    const batch = await queue.claimJobs({ batchSize: 40, perTenantLimit: 10, workerId: 'w1' })
    expect(batch.every(job => job.tenantId !== null)).toBe(true)
    const byTenant = batch.reduce<Record<string, number>>((acc, job) => ({ ...acc, [job.tenantId!]: (acc[job.tenantId!] ?? 0) + 1 }), {})
    expect(byTenant[TENANT_A]).toBe(10)
    expect(byTenant[TENANT_B]).toBe(3)
    expect(batch.every(job => job.attempts === 1)).toBe(true)
    expect((await admin`select count(*)::int as n from job_queue where status = 'pending'`)[0]!.n).toBe(15)
  })

  it('respeta el tamaño de lote y no toma trabajos futuros', async () => {
    await seed(TENANT_A, 5)
    await queue.enqueueEmail(TENANT_A, email(99), { runAt: new Date(Date.now() + 3_600_000) })
    const batch = await queue.claimJobs({ batchSize: 3, perTenantLimit: 10, workerId: 'w1' })
    expect(batch).toHaveLength(3)
    const rest = await queue.claimJobs({ batchSize: 50, perTenantLimit: 10, workerId: 'w2' })
    expect(rest).toHaveLength(2) // el programado a futuro se queda
  })

  it('dos procesos a la vez nunca toman el mismo trabajo (SKIP LOCKED)', async () => {
    await seed(TENANT_A, 30)
    const [one, two, three] = await Promise.all([
      queue.claimJobs({ batchSize: 20, perTenantLimit: 30, workerId: 'a' }),
      queue.claimJobs({ batchSize: 20, perTenantLimit: 30, workerId: 'b' }),
      queue.claimJobs({ batchSize: 20, perTenantLimit: 30, workerId: 'c' })
    ])
    const ids = [...one, ...two, ...three].map(job => job.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(30)
  })
})

describe('reintentos', () => {
  it('un error reintentable reprograma con retroceso y, al agotar los intentos, queda dead', async () => {
    await seed(TENANT_A, 1)
    const now = new Date(Date.now() + 1000)
    let job = (await queue.claimJobs({ now, batchSize: 5, perTenantLimit: 5, workerId: 'w' }))[0]!
    expect(await queue.failJob(job, { ok: false, error: 'timeout' }, now, () => 0.5)).toBe('retry')
    const [row] = await admin`select status, run_at, last_error from job_queue`
    expect(row).toMatchObject({ status: 'pending', last_error: 'timeout' })
    expect(new Date(row!.run_at as string).getTime() - now.getTime()).toBe(60_000) // primer retroceso: 1 min

    // Agota los intentos.
    await admin`update job_queue set attempts = max_attempts - 1, run_at = ${now.toISOString()}::timestamptz`
    job = (await queue.claimJobs({ now, batchSize: 5, perTenantLimit: 5, workerId: 'w' }))[0]!
    expect(job.attempts).toBe(job.maxAttempts)
    expect(await queue.failJob(job, { ok: false, error: 'timeout' }, now)).toBe('dead')
    expect((await admin`select status from job_queue`)[0]!.status).toBe('dead')
  })

  it('un error permanente va directo a dead', async () => {
    await seed(TENANT_A, 1)
    const [job] = await queue.claimJobs({ batchSize: 5, perTenantLimit: 5, workerId: 'w' })
    expect(await queue.failJob(job!, { ok: false, retryable: false, error: '550 buzón inexistente' })).toBe('dead')
    const [row] = await admin`select status, attempts, last_error from job_queue`
    expect(row).toMatchObject({ status: 'dead', attempts: 1, last_error: '550 buzón inexistente' })
  })

  it('recupera los trabajos que quedaron "en proceso" de un proceso caído', async () => {
    await seed(TENANT_A, 2)
    await queue.claimJobs({ batchSize: 5, perTenantLimit: 5, workerId: 'muerto' })
    await admin`update job_queue set locked_at = now() - interval '30 minutes' where id = (select id from job_queue limit 1)`
    expect(await queue.recoverStuckJobs()).toBe(1)
    expect((await admin`select status, count(*)::int as n from job_queue group by status order by status`).map(row => `${row.status}:${row.n}`)).toEqual(['pending:1', 'processing:1'])
  })

  it('un administrador puede reintentar un correo dead de su organización, no el de otra', async () => {
    await seed(TENANT_A, 1)
    const [job] = await queue.claimJobs({ batchSize: 5, perTenantLimit: 5, workerId: 'w' })
    await queue.failJob(job!, { ok: false, retryable: false, error: 'x' })
    expect(await queue.retryDeadJob(TENANT_B, job!.id)).toBe(false)
    expect(await queue.retryDeadJob(TENANT_A, job!.id)).toBe(true)
    expect((await admin`select status, attempts from job_queue`)[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })
})

describe('aislamiento por organización (RLS)', () => {
  it('una organización solo ve sus trabajos; el proceso de la cola ve todos; otras tablas no', async () => {
    await seed(TENANT_A, 2)
    await seed(TENANT_B, 1)
    const asB = await db.withTenant(TENANT_B, tx => tx.execute(sql`select tenant_id from job_queue`)) as unknown as Array<{ tenant_id: string }>
    expect([...asB].map(row => row.tenant_id)).toEqual([TENANT_B])
    const summaryA = await queue.summarizeQueue(TENANT_A)
    expect(summaryA.counts.pending).toBe(2)
    expect(summaryA.recent).toHaveLength(2)
    const all = await db.withJobWorker(tx => tx.execute(sql`select count(*)::int as n from job_queue`)) as unknown as Array<{ n: number }>
    expect([...all][0]!.n).toBe(3)
    const tenantsSeen = await db.withJobWorker(tx => tx.execute(sql`select count(*)::int as n from records`)) as unknown as Array<{ n: number }>
    expect([...tenantsSeen][0]!.n).toBe(0)
  })

  it('no se puede insertar un trabajo a nombre de otra organización', async () => {
    await expect(db.withTenant(TENANT_B, tx => tx.execute(sql`insert into job_queue (tenant_id, kind) values (${TENANT_A}, 'email')`))).rejects.toThrow()
  })
})

describe('ciclo del proceso', () => {
  it('ejecuta los trabajos, marca los resultados y respeta el ritmo máximo', async () => {
    await seed(TENANT_A, 6)
    await seed(TENANT_B, 6)
    const seen: string[] = []
    queue.registerJobHandler('email', async (job) => {
      seen.push(job.id)
      return (job.payload.to as string) === 'dest0@example.com' && job.tenantId === TENANT_B ? { ok: false, retryable: false, error: 'rechazado' } : { ok: true }
    })
    const startedAt = Date.now()
    const result = await queue.runJobQueueTick({ ratePerSecond: 20, concurrency: 4, budgetMs: 10_000 })
    const elapsed = Date.now() - startedAt
    expect(result).toMatchObject({ claimed: 12, succeeded: 11, dead: 1, retried: 0 })
    expect(new Set(seen).size).toBe(12)
    // 12 envíos a 20 por segundo: al menos ~0.5 s (con margen por el reloj).
    expect(elapsed).toBeGreaterThanOrEqual(450)
    expect((await admin`select status, count(*)::int as n from job_queue group by status order by status`).map(row => `${row.status}:${row.n}`)).toEqual(['dead:1', 'succeeded:11'])
  })

  it('un manejador que lanza una excepción cuenta como fallo reintentable', async () => {
    await seed(TENANT_A, 1)
    queue.registerJobHandler('email', async () => { throw new Error('conexión rota') })
    const result = await queue.runJobQueueTick({ ratePerSecond: 1000, budgetMs: 5_000 })
    expect(result).toMatchObject({ claimed: 1, retried: 1 })
    expect((await admin`select status, last_error from job_queue`)[0]).toMatchObject({ status: 'pending', last_error: 'conexión rota' })
  })

  it('un tipo de trabajo sin manejador queda dead con un mensaje claro', async () => {
    await seed(TENANT_A, 1)
    const result = await queue.runJobQueueTick({ ratePerSecond: 1000, budgetMs: 5_000 })
    expect(result.dead).toBe(1)
    expect(String((await admin`select last_error from job_queue`)[0]!.last_error)).toContain('manejador')
  })

  it('con la cola vacía no hace nada', async () => {
    const startedAt = Date.now()
    expect(await queue.runJobQueueTick({ budgetMs: 2_000 })).toMatchObject({ claimed: 0, succeeded: 0 })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })
})

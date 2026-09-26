import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, withJobWorker, withTenant } from '~/server/db'
import { jobQueue } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'
import { getPlanUsage } from '~/server/utils/billing'
import { getLicenseStatus, IS_ONPREM_BUILD } from '~/server/utils/license'

// Cola de trabajos en Postgres. Objetivos:
//  - Los correos (y otras tareas) ya no se envían dentro de la petición o del
//    disparador: se encolan y salen a un ritmo controlado (Amazon SES limita los
//    envíos por segundo) y con reintentos.
//  - Reparto justo: cada ronda toma como máximo N trabajos por organización, así
//    una organización con miles de correos no retrasa a las demás.
//  - Varias instancias a la vez sin duplicar (FOR UPDATE SKIP LOCKED).
//  - Un trabajo se identifica opcionalmente con una clave de idempotencia
//    (p. ej. "recordatorio:<cita>:<programación>") y no se encola dos veces.

export type JobKind = 'email'
export type JobStatus = 'pending' | 'processing' | 'succeeded' | 'dead'

export interface ClaimedJob {
  id: string
  tenantId: string
  kind: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

export class PermanentJobError extends Error {}

export interface JobOutcome {
  ok: boolean
  /** Si falla, ¿tiene sentido reintentar? (error de red, 4xx) o no (dirección inválida, mala configuración). */
  retryable?: boolean
  error?: string
}

export type JobHandler = (job: ClaimedJob) => Promise<JobOutcome>

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]

/** Retroceso exponencial escalonado: 1 min, 5 min, 15 min, 1 h, 6 h (con un poco de variación para no golpear a la vez). */
export function computeRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1]!
  return Math.round(base * (0.9 + random() * 0.2))
}

/** Limitador de ritmo: espacia las salidas para no pasar de `perSecond` por segundo. */
export function createRateLimiter(perSecond: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const interval = perSecond > 0 ? 1000 / perSecond : 0
  let next = 0
  return async function take(): Promise<void> {
    if (!interval) return
    const current = now()
    const wait = Math.max(0, next - current)
    next = Math.max(current, next) + interval
    if (wait > 0) await sleep(wait)
  }
}

export interface EnqueueOptions {
  idempotencyKey?: string
  runAt?: Date
  maxAttempts?: number
}

/**
 * Encola un trabajo para una organización. Devuelve el id, o `null` si ya existía
 * un trabajo con la misma clave de idempotencia (no se duplica).
 */
export async function enqueueJob(tenantId: string, kind: JobKind, payload: Record<string, unknown>, options: EnqueueOptions = {}): Promise<string | null> {
  const rows = await withTenant(tenantId, tx => tx.insert(jobQueue).values({
    tenantId,
    kind,
    payload,
    idempotencyKey: options.idempotencyKey ?? null,
    runAt: options.runAt ?? new Date(),
    maxAttempts: options.maxAttempts ?? 6
  }).onConflictDoNothing().returning({ id: jobQueue.id }))
  return rows[0]?.id ?? null
}

export const emailJobSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(500_000),
  recordUrl: z.string().max(2048).optional()
})
export type EmailJobPayload = z.infer<typeof emailJobSchema>

export async function enqueueEmail(tenantId: string, payload: EmailJobPayload, options: EnqueueOptions = {}) {
  const parsed = emailJobSchema.parse(payload)
  const usage = await getPlanUsage(tenantId)
  const quota = usage.usage.find(item => item.concept === 'emails')!
  if (!(IS_ONPREM_BUILD && getLicenseStatus().activated) && quota.limit !== null && quota.used >= quota.limit) {
    const rows = await withTenant(tenantId, tx => tx.insert(jobQueue).values({
      tenantId, kind: 'email', payload: parsed, status: 'dead', lastError: `Límite del plan ${usage.plan}: se excedió la cuota mensual de correos (${quota.limit}).`,
      completedAt: new Date(), idempotencyKey: options.idempotencyKey ?? null, runAt: options.runAt ?? new Date(), maxAttempts: options.maxAttempts ?? 6
    }).onConflictDoNothing().returning({ id: jobQueue.id }))
    return rows[0]?.id ?? null
  }
  return enqueueJob(tenantId, 'email', parsed, options)
}

const MAX_ERROR_LENGTH = 1000
const truncate = (message: string) => message.slice(0, MAX_ERROR_LENGTH)

export interface ClaimOptions {
  now?: Date
  batchSize: number
  perTenantLimit: number
  workerId: string
}

/**
 * Toma un lote de trabajos listos. Como mucho `perTenantLimit` por organización en
 * cada llamada (reparto justo) y `batchSize` en total, y sin pisar a otros procesos.
 *
 * El costo NO depende del tamaño de la cola: primero se eligen al azar hasta
 * `batchSize` organizaciones que tengan algo listo (una búsqueda por índice en cada
 * una) y de cada una se toman sus más antiguos. Elegir al azar reparte la atención
 * sin guardar estado: una organización con 100 mil correos no desplaza a una con 3.
 * (Una versión anterior numeraba toda la cola con row_number(): ~750 ms con 300 mil
 * pendientes y crecía linealmente.)
 */
export async function claimJobs(options: ClaimOptions): Promise<ClaimedJob[]> {
  const now = options.now ?? new Date()
  // La función de base de datos claim_job_batch (migración 0073) hace la toma con
  // los privilegios del dueño: bajo RLS Postgres recorrería toda la cola.
  const rows = await db.execute(sql`
    SELECT id, tenant_id AS "tenantId", kind, payload, attempts, max_attempts AS "maxAttempts"
    FROM claim_job_batch(${options.batchSize}::int, ${options.perTenantLimit}::int, ${options.workerId}, ${now.toISOString()}::timestamptz)`)
  return [...rows] as unknown as ClaimedJob[]
}

export async function completeJob(id: string, now = new Date()): Promise<void> {
  await withJobWorker(tx => tx.update(jobQueue)
    .set({ status: 'succeeded', completedAt: now, lockedAt: null, lockedBy: null, lastError: null, updatedAt: now })
    .where(and(eq(jobQueue.id, id), eq(jobQueue.status, 'processing'))))
}

/** Registra un fallo: reintenta con retroceso si procede, o lo deja en "dead" (visible para el administrador). */
export async function failJob(job: Pick<ClaimedJob, 'id' | 'attempts' | 'maxAttempts'>, outcome: JobOutcome, now = new Date(), random?: () => number): Promise<'retry' | 'dead'> {
  const retry = outcome.retryable !== false && job.attempts < job.maxAttempts
  await withJobWorker(tx => tx.update(jobQueue).set(retry
    ? { status: 'pending', runAt: new Date(now.getTime() + computeRetryDelayMs(job.attempts, random)), lockedAt: null, lockedBy: null, lastError: truncate(outcome.error ?? 'Error desconocido'), updatedAt: now }
    : { status: 'dead', lockedAt: null, lockedBy: null, lastError: truncate(outcome.error ?? 'Error desconocido'), completedAt: now, updatedAt: now })
    .where(and(eq(jobQueue.id, job.id), eq(jobQueue.status, 'processing'))))
  return retry ? 'retry' : 'dead'
}

/** Devuelve a la cola los trabajos que llevan demasiado "en proceso" (el proceso se cayó a media ejecución). */
export async function recoverStuckJobs(olderThanMs = 10 * 60_000, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs)
  const rows = await withJobWorker(tx => tx.execute(sql`
    UPDATE job_queue SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = ${now.toISOString()}::timestamptz,
      last_error = COALESCE(last_error, 'El proceso se interrumpió durante el envío')
    WHERE status = 'processing' AND locked_at < ${cutoff.toISOString()}::timestamptz
    RETURNING id`))
  return [...rows].length
}

/** Borra los trabajos terminados hace más de `keepDays` días. */
export async function purgeFinishedJobs(keepDays = 14, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000)
  const rows = await withJobWorker(tx => tx.execute(sql`
    DELETE FROM job_queue WHERE status IN ('succeeded', 'dead') AND completed_at < ${cutoff.toISOString()}::timestamptz RETURNING id`))
  return [...rows].length
}

const handlers = new Map<string, JobHandler>()
export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler)
}

export interface TickOptions {
  now?: () => Date
  /** Tiempo máximo del tick (una función serverless tiene límite de ejecución). */
  budgetMs?: number
  batchSize?: number
  perTenantLimit?: number
  concurrency?: number
  ratePerSecond?: number
  workerId?: string
}

export interface TickResult { claimed: number; succeeded: number; retried: number; dead: number; recovered: number; purged: number }

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Un ciclo del proceso: recupera atascados, toma trabajos por rondas justas y los
 * ejecuta con un ritmo máximo, hasta agotar el tiempo o la cola.
 */
export async function runJobQueueTick(options: TickOptions = {}): Promise<TickResult> {
  const clock = options.now ?? (() => new Date())
  const budgetMs = options.budgetMs ?? envNumber('JOB_QUEUE_BUDGET_MS', 45_000)
  const batchSize = options.batchSize ?? envNumber('JOB_QUEUE_BATCH_SIZE', 40)
  const perTenantLimit = options.perTenantLimit ?? envNumber('JOB_QUEUE_PER_TENANT_LIMIT', 10)
  const concurrency = options.concurrency ?? envNumber('JOB_QUEUE_CONCURRENCY', 4)
  const take = createRateLimiter(options.ratePerSecond ?? envNumber('JOB_QUEUE_RATE_PER_SECOND', 10))
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`
  const startedAt = Date.now()
  const result: TickResult = { claimed: 0, succeeded: 0, retried: 0, dead: 0, recovered: await recoverStuckJobs(undefined, clock()), purged: 0 }

  const execute = async (job: ClaimedJob) => {
    const handler = handlers.get(job.kind)
    let outcome: JobOutcome
    if (!handler) outcome = { ok: false, retryable: false, error: `No hay un manejador para el tipo de trabajo "${job.kind}"` }
    else {
      await take()
      try { outcome = await handler(job) } catch (error) {
        outcome = { ok: false, retryable: !(error instanceof PermanentJobError), error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (outcome.ok) { await completeJob(job.id, clock()); result.succeeded++; return }
    const verdict = await failJob(job, outcome, clock())
    if (verdict === 'retry') result.retried++
    else {
      result.dead++
      logger.warn('job_queue_dead', { jobId: job.id, tenantId: job.tenantId, kind: job.kind, attempts: job.attempts, errorMessage: outcome.error })
    }
  }

  while (Date.now() - startedAt < budgetMs) {
    const batch = await claimJobs({ now: clock(), batchSize, perTenantLimit, workerId })
    if (batch.length === 0) break
    result.claimed += batch.length
    const pending = [...batch]
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      for (let job = pending.shift(); job; job = pending.shift()) {
        try { await execute(job) } catch (error) {
          logger.error('job_queue_execute_failed', { jobId: job.id, errorMessage: error instanceof Error ? error.message : String(error) })
        }
      }
    }))
  }
  result.purged = Math.random() < 0.02 ? await purgeFinishedJobs(undefined, clock()) : 0
  return result
}

export interface QueueSummary {
  counts: Record<JobStatus, number>
  recent: Array<{ id: string; kind: string; status: string; attempts: number; to: string | null; subject: string | null; lastError: string | null; runAt: Date; createdAt: Date; completedAt: Date | null }>
}

/** Resumen para el administrador de una organización: conteos por estado y los últimos trabajos. */
export async function summarizeQueue(tenantId: string, limit = 50): Promise<QueueSummary> {
  return withTenant(tenantId, async (tx) => {
    const grouped = await tx.select({ status: jobQueue.status, count: sql<number>`count(*)::int` }).from(jobQueue)
      .where(eq(jobQueue.tenantId, tenantId)).groupBy(jobQueue.status)
    const counts: Record<JobStatus, number> = { pending: 0, processing: 0, succeeded: 0, dead: 0 }
    for (const row of grouped) counts[row.status as JobStatus] = row.count
    const rows = await tx.select().from(jobQueue).where(eq(jobQueue.tenantId, tenantId)).orderBy(desc(jobQueue.createdAt)).limit(limit)
    return {
      counts,
      recent: rows.map(row => {
        const payload = (row.payload ?? {}) as Record<string, unknown>
        return {
          id: row.id, kind: row.kind, status: row.status, attempts: row.attempts,
          to: typeof payload.to === 'string' ? payload.to : null,
          subject: typeof payload.subject === 'string' ? payload.subject : null,
          lastError: row.lastError, runAt: row.runAt, createdAt: row.createdAt, completedAt: row.completedAt
        }
      })
    }
  })
}

/** Vuelve a encolar un trabajo "dead" (por ejemplo, tras corregir la configuración de correo). */
export async function retryDeadJob(tenantId: string, jobId: string): Promise<boolean> {
  const rows = await withTenant(tenantId, tx => tx.update(jobQueue)
    .set({ status: 'pending', attempts: 0, runAt: new Date(), lockedAt: null, lockedBy: null, completedAt: null, updatedAt: new Date() })
    .where(and(eq(jobQueue.id, jobId), eq(jobQueue.tenantId, tenantId), eq(jobQueue.status, 'dead')))
    .returning({ id: jobQueue.id }))
  return rows.length > 0
}

/** Desacoplado de la base para pruebas: quita cualquier estado en memoria del registro de manejadores. */
export function clearJobHandlers(): void {
  handlers.clear()
}


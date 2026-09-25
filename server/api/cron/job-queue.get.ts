import { timingSafeEqual } from 'node:crypto'
import { registerDefaultJobHandlers } from '~/server/utils/jobHandlers'
import { runJobQueueTick } from '~/server/utils/jobQueue'

// GET /api/cron/job-queue - ejecuta un ciclo de la cola de trabajos. Pensado para
// Vercel Cron (que llama con `Authorization: Bearer <CRON_SECRET>`) o cualquier
// cron externo cuando el servidor no es de larga vida. Es pública para el
// middleware de sesión (no hay usuario) y se protege con el secreto.
// Sin CRON_SECRET configurado responde 503: nunca queda abierta.
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw createError({ statusCode: 503, statusMessage: 'CRON_SECRET no está configurado' })
  const header = getHeader(event, 'authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || !safeEqual(token, secret)) throw createError({ statusCode: 401, statusMessage: 'No autorizado' })

  registerDefaultJobHandlers()
  // Margen por debajo del límite de tiempo de una función serverless.
  const result = await runJobQueueTick({ budgetMs: Number(process.env.JOB_QUEUE_BUDGET_MS) || 40_000 })
  return { ok: true, ...result }
})

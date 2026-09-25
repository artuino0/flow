import { requireCronSecret } from '~/server/utils/cronAuth'
import { registerDefaultJobHandlers } from '~/server/utils/jobHandlers'
import { runJobQueueTick } from '~/server/utils/jobQueue'

// GET /api/cron/job-queue - ejecuta un ciclo de la cola de trabajos. Pensado para
// Vercel Cron (que llama con `Authorization: Bearer <CRON_SECRET>`) o cualquier
// cron externo cuando el servidor no es de larga vida. Es pública para el
// middleware de sesión (no hay usuario) y se protege con el secreto.
// Sin CRON_SECRET configurado responde 503: nunca queda abierta.
export default defineEventHandler(async (event) => {
  requireCronSecret(event)

  registerDefaultJobHandlers()
  // Margen por debajo del límite de tiempo de una función serverless.
  const result = await runJobQueueTick({ budgetMs: Number(process.env.JOB_QUEUE_BUDGET_MS) || 40_000 })
  return { ok: true, ...result }
})

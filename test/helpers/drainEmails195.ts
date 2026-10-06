import type postgres from 'postgres'
/** Worker explícito para fixtures antiguas que comprueban contenido entregado. */
export async function drainEmails195(admin: postgres.Sql) {
  const { handleEmailJob } = await import('../../server/utils/jobHandlers')
  const { completeJob, failJob } = await import('../../server/utils/jobQueue')
  const rows = await admin`update job_queue set status='processing',attempts=attempts+1 where kind='email' and status='pending' and run_at<=now() returning id,tenant_id,payload,attempts,max_attempts`
  for (const row of rows) {
    const job = { id: String(row.id), tenantId: String(row.tenant_id), kind: 'email', payload: row.payload as Record<string, unknown>, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts) }
    const result = await handleEmailJob(job)
    if (result.ok) await completeJob(job.id)
    else await failJob(job, result)
  }
}

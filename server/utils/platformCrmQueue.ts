import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, withTenant } from '~/server/db'
import type { ClaimedJob, JobOutcome } from './jobQueue'
import { platformCrmDestination, platformClientSource, syncPlatformClient } from './platformCrm'
import { logger } from './logger'

const payloadSchema = z.object({ tenantId: z.string().uuid(), deleted: z.object({ nombre: z.string(), correo: z.string().nullable(), fecha_alta: z.string(), fecha_baja: z.string(), attribution: z.unknown().optional() }).optional() })
export async function handlePlatformCrmJob(job: ClaimedJob): Promise<JobOutcome> {
  const parsed = payloadSchema.safeParse(job.payload)
  if (!parsed.success) return { ok: false, retryable: false, error: 'Evento CRM inválido' }
  try {
    const deleted = parsed.data.deleted
    await syncPlatformClient(parsed.data.tenantId, { deleted: deleted ? { nombre: deleted.nombre, correo: deleted.correo, fecha_alta: deleted.fecha_alta, fecha_baja: deleted.fecha_baja, fuente: platformClientSource(deleted.attribution) } : undefined })
    return { ok: true }
  } catch { return { ok: false, retryable: true, error: 'No se pudo sincronizar el CRM' } }
}

async function worker<T>(fn: (tx: typeof db) => Promise<T>, tenantId?: string) {
  const run = async (tx: typeof db) => {
    await tx.execute(sql`select set_config('app.platform_crm_worker', 'on', true)`)
    await tx.execute(sql`set local statement_timeout = '10000'`)
    return fn(tx)
  }
  return tenantId ? withTenant(tenantId, run) : db.transaction(tx => run(tx as unknown as typeof db))
}

/** Traslada eventos confirmados a la cola existente. La clave conserva idempotencia si cae el proceso. */
export async function drainPlatformCrmEvents(budgetMs = 5_000) {
  const summary = { queued: 0, errors: 0 }
  if (!process.env.PLATFORM_CRM_TENANT_SLUG) return summary
  try {
    const destination = await platformCrmDestination()
    if (!destination) return summary
    const started = Date.now()
    while (Date.now() - started < budgetMs) {
      const found = await worker(async tx => {
        const [row] = await tx.execute(sql`select tenant_id::text, generation::text, payload from platform_crm_events order by created_at, tenant_id limit 1 for update skip locked`)
        if (!row) return false
        if (row.tenant_id !== destination.id) await tx.execute(sql`insert into job_queue (tenant_id, kind, payload, idempotency_key)
          values (${destination.id}::uuid, 'platform_crm', ${JSON.stringify({ tenantId: row.tenant_id, ...(row.payload as Record<string, unknown>) })}::jsonb, ${`crm:${row.generation}`}) on conflict do nothing`)
        await tx.execute(sql`delete from platform_crm_events where tenant_id = ${String(row.tenant_id)}::uuid and generation = ${String(row.generation)}::uuid`)
        return true
      }, destination.id)
      if (!found) break
      summary.queued++
    }
  } catch { summary.errors++; logger.warn('platform_crm_enqueue_failed') }
  return summary
}

/** El trabajo diario es rápido: materializa eventos reparables; la cola ejecuta y reintenta. */
export async function refreshPlatformCrm(budgetMs = 10_000) {
  if (!process.env.PLATFORM_CRM_TENANT_SLUG) return { queued: 0, errors: 0 }
  try {
    const destination = await platformCrmDestination()
    if (!destination) return { queued: 0, errors: 0 }
    await worker(tx => tx.execute(sql`insert into platform_crm_events (tenant_id)
      select id from tenants where id <> ${destination.id}::uuid
      on conflict (tenant_id) do update set generation = gen_random_uuid()`))
    // Organizaciones borradas cuando la captura falló: conservar cliente y marcar baja.
    const orphans = await withTenant(destination.id, tx => tx.execute(sql`select distinct custom_data->>'organizacion_id' as id from records
      where tenant_id = ${destination.id}::uuid and custom_data->>'origen' = 'flow_saas'
      and entity_id in (select id from entities where tenant_id = ${destination.id}::uuid and slug = 'clientes')
      and custom_data->>'organizacion_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not exists (select 1 from tenants where id::text = records.custom_data->>'organizacion_id')`))
    if (orphans.length) await worker(tx => tx.execute(sql`insert into platform_crm_events (tenant_id)
      select value::uuid from jsonb_array_elements_text(${JSON.stringify(orphans.map(row => row.id))}::jsonb) on conflict do nothing`))
    return drainPlatformCrmEvents(budgetMs)
  } catch { logger.warn('platform_crm_refresh_failed'); return { queued: 0, errors: 1 } }
}

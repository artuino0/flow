import { sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'

/** Ventana fija de un minuto, compartida entre instancias y protegida por ON CONFLICT. */
export async function checkDesignerMessageRate(tenantId: string, userId: string) {
  await withTenant(tenantId, async tx => {
    for (const [scope, max] of [[`user:${userId}`, 10], ['tenant', 40]] as const) {
      const rows = await tx.execute(sql`
        INSERT INTO module_design_rate_limits (tenant_id, scope, bucket, hits)
        VALUES (${tenantId}::uuid, ${scope}, date_trunc('minute', now()), 1)
        ON CONFLICT (tenant_id, scope, bucket) DO UPDATE SET hits = module_design_rate_limits.hits + 1
          WHERE module_design_rate_limits.hits < ${max}
        RETURNING hits
      `)
      if (!rows.length) throw createError({ statusCode: 429, statusMessage: 'Demasiadas solicitudes al diseñador. Inténtalo en un minuto.' })
    }
  })
}

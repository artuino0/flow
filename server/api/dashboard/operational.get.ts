import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { cfdiDocuments, entities, people, recordActivities, records, roleEntityPermissions, users } from '~/server/db/schema'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})
const attentionValues: Record<string, string[]> = {
  cuentas_por_pagar: ['borrador', 'vencido'],
  cuentas_por_cobrar: ['borrador', 'vencido']
  // Fase H del dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md): facturas,
  // notas_credito y complementos_pago ya NO son módulos dinámicos — el resumen
  // fiscal se lee de cfdi_documents más abajo (`facturacion`).
}
const startOfDay = (value: string | undefined, fallback: Date) => value ? new Date(value + 'T00:00:00.000Z') : fallback
const endOfDay = (value: string | undefined, fallback: Date) => value ? new Date(value + 'T23:59:59.999Z') : fallback

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const now = new Date()
  const from = startOfDay(query.from, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
  const to = endOfDay(query.to, now)
  return withTenant(auth.tenantId, async (tx) => {
    // Resumen del dominio fiscal fijo (fase D/H de DOCS/HU_Timbrado_CFDI_PAC.md):
    // los documentos fiscales ya no son módulos dinámicos — se cuentan directo
    // de cfdi_documents. try/catch a propósito: una base sin la migración 0049
    // todavía aplicada no debe tumbar el tablero entero (mismo criterio defensivo
    // documentado en 0.79.1 con print_reports).
    let facturacion = null as null | { total: number; attention: number }
    try {
      const [fiscalRow] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          attention: sql<number>`count(*) filter (where ${cfdiDocuments.estado} in ('error', 'timbrando'))::int`
        })
        .from(cfdiDocuments)
        .where(and(eq(cfdiDocuments.tenantId, auth.tenantId), gte(cfdiDocuments.createdAt, from), lte(cfdiDocuments.createdAt, to)))
      facturacion = { total: fiscalRow?.total ?? 0, attention: fiscalRow?.attention ?? 0 }
    } catch {}
    const readable = auth.roleId
      ? await tx.select({ id: entities.id, slug: entities.slug, name: entities.name, icon: entities.icon, labelField: entities.labelField })
        .from(entities)
        .innerJoin(roleEntityPermissions, and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, auth.roleId), eq(roleEntityPermissions.canRead, true)))
        .where(and(eq(entities.tenantId, auth.tenantId), eq(entities.moduleKind, 'hecho'), eq(entities.isActive, true)))
        .orderBy(entities.name)
      : []
    if (!readable.length) return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), modules: [], facturacion, activityTotal: 0, activity: [] }
    const ids = readable.map(entity => entity.id)
    const modules = []
    for (const entity of readable) {
      const conditions = [eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), isNull(records.deletedAt), gte(records.createdAt, from), lte(records.createdAt, to)]
      const [total] = await tx.select({ count: sql<number>`count(*)::int` }).from(records).where(and(...conditions))
      let attention = 0
      const statuses = attentionValues[entity.slug]
      if (statuses?.length) {
        const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(records).where(and(...conditions, or(...statuses.map(value => sql`${records.customData}->>'estado' = ${value}`))))
        attention = pending?.count ?? 0
      }
      modules.push({ slug: entity.slug, name: entity.name, icon: entity.icon, total: total?.count ?? 0, attention })
    }
    const activityConditions = [eq(recordActivities.tenantId, auth.tenantId), inArray(records.entityId, ids), isNull(records.deletedAt), gte(recordActivities.createdAt, from), lte(recordActivities.createdAt, to)]
    const [activityCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(recordActivities).innerJoin(records, eq(records.id, recordActivities.recordId)).where(and(...activityConditions))
    const activity = await tx.select({
      id: recordActivities.id,
      recordId: records.id,
      actionType: recordActivities.actionType,
      createdAt: recordActivities.createdAt,
      customData: records.customData,
      entityName: entities.name,
      entitySlug: entities.slug,
      labelField: entities.labelField,
      userName: people.fullName,
      userEmail: people.email
    }).from(recordActivities)
      .innerJoin(records, eq(records.id, recordActivities.recordId))
      .innerJoin(entities, eq(entities.id, records.entityId))
      .leftJoin(users, eq(users.id, recordActivities.userId))
      .leftJoin(people, eq(people.id, users.personId))
      .where(and(...activityConditions)).orderBy(desc(recordActivities.createdAt)).limit(6)
    return {
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), modules, facturacion, activityTotal: activityCount?.count ?? 0,
      activity: activity.map(row => {
        const data = row.customData as Record<string, unknown>
        const rawLabel = row.labelField ? data?.[row.labelField] : null
        return { id: row.id, recordId: row.recordId, entityName: row.entityName, entitySlug: row.entitySlug, label: typeof rawLabel === 'string' && rawLabel ? rawLabel : row.recordId.slice(0, 8), actionType: row.actionType, userName: row.userName || row.userEmail || 'Sistema', createdAt: row.createdAt }
      })
    }
  })
})

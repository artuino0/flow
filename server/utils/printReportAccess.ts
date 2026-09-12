import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, roleEntityPermissions, roles } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'
import { loadTenantFieldContext, ReportPathPlanner } from '~/server/utils/reportFieldPath'
import type { PrintReportDsl } from '~/server/utils/printReport'
import { inputsForType } from '~/utils/reportParameters'

/** The catalog and execution use the same readable graph, including inactive-module rules. */
export async function readableReportContext(event: H3Event) {
  const auth = requireAuth(event)
  return withTenant(auth.tenantId, async tx => {
    const ctx = await loadTenantFieldContext(tx, auth.tenantId)
    const [role] = await tx.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, auth.roleId!))
    const readable = await tx.select({ id: entities.id, active: entities.isActive })
      .from(entities).innerJoin(roleEntityPermissions, and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, auth.roleId!), eq(roleEntityPermissions.canRead, true)))
      .where(eq(entities.tenantId, auth.tenantId))
    const allowed = new Set(readable.filter(entity => entity.active || role?.isSystem).map(entity => entity.id))
    for (const entity of ctx.entitiesById.values()) {
      if (allowed.has(entity.id)) continue
      ctx.entitiesById.delete(entity.id)
      ctx.entitiesBySlug.delete(entity.slug)
      ctx.fieldsByEntityId.delete(entity.id)
    }
    return ctx
  })
}

export async function requirePrintReportAccess(event: H3Event, dsl: PrintReportDsl) {
  const auth = requireAuth(event)
  const ctx = await readableReportContext(event)
  const base = ctx.entitiesBySlug.get(dsl.baseEntity)
  const detail = dsl.detail && ctx.entitiesBySlug.get(dsl.detail.entitySlug)
  if (!base || (dsl.detail && !detail)) throw createError({ statusCode: 403, statusMessage: 'No tienes acceso a todos los módulos del reporte.' })
  const planner = new ReportPathPlanner(ctx, auth.tenantId, base.id, detail ? detail.id : undefined)
  const sources = [...dsl.groupBy, ...dsl.columns.flatMap(col => col.kind === 'repartir' ? [col.source, col.conditionSource] : [col.source]), ...(dsl.filters ?? []).map(filter => filter.source), ...(dsl.orderBy ?? []).map(order => order.source)]
  try {
    for (const source of sources) planner.resolve(source)
    for (const parameter of dsl.parameters ?? []) {
      const { field } = planner.resolve(parameter.source)
      if (!inputsForType(field.dataType).some(input => input.value === parameter.input)) throw new Error('Tipo de entrada incompatible')
    }
  }
  catch { throw createError({ statusCode: 400, statusMessage: 'El reporte contiene campos que ya no existen o relaciones sin acceso. Revisa el selector de campos.' }) }
}

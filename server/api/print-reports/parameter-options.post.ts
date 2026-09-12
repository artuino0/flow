import { z } from 'zod'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'
import { requirePermission } from '~/server/utils/rbac'
import { readableReportContext, requirePrintReportAccess } from '~/server/utils/printReportAccess'
import { printReportDslSchema } from '~/server/utils/printReport'
import { ReportPathPlanner } from '~/server/utils/reportFieldPath'

export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, z.object({ dsl: printReportDslSchema, parameterId: z.string(), search: z.string().max(100).default('') }).parse)
  const { auth } = await requirePermission(event, body.dsl.baseEntity, 'canRead')
  await requirePrintReportAccess(event, body.dsl)
  const parameter = body.dsl.parameters?.find(item => item.id === body.parameterId && item.input === 'select')
  if (!parameter) throw createError({ statusCode: 400, statusMessage: 'Filtro no disponible.' })
  const ctx = await readableReportContext(event)
  const planner = new ReportPathPlanner(ctx, auth.tenantId, ctx.entitiesBySlug.get(body.dsl.baseEntity)!.id, body.dsl.detail ? ctx.entitiesBySlug.get(body.dsl.detail.entitySlug)!.id : undefined)
  const { field } = planner.resolve(parameter.source)
  if (field.dataType === 'select') {
    const options = ((field.validationRules as { options?: { value: string; label: string }[] })?.options ?? []).filter(option => option.label.toLocaleLowerCase().includes(body.search.toLocaleLowerCase()))
    return { options, recordId: false, more: false }
  }
  return withTenant(auth.tenantId, async tx => {
    const value = sql<string>`${records.customData} ->> ${field.name}`
    const fields = ctx.fieldsByEntityId.get(field.entityId) ?? []
    const configuredLabel = ctx.entitiesById.get(field.entityId)?.labelField
    const labelField = fields.find(item => item.name === configuredLabel && ['text', 'incremental'].includes(item.dataType))?.name
      ?? fields.find(item => item.name !== 'id' && ['text', 'incremental'].includes(item.dataType))?.name
    // A producer name identifies a record; a municipality selects all records
    // with that value, even when it is reached through the same relation.
    const identity = parameter.source.forwardHops.length > 0 && field.name === labelField
    const options = await tx.selectDistinct({ value: identity ? sql<string>`${records.id}::text` : value, label: value }).from(records)
      .where(and(eq(records.tenantId, auth.tenantId), eq(records.entityId, field.entityId), isNull(records.deletedAt), sql`${value} is not null and ${value} <> ''`, sql`strpos(lower(${value}), lower(${body.search})) > 0`))
      .orderBy(sql.raw('2')).limit(101)
    return { options: options.slice(0, 100), recordId: identity, more: options.length > 100 }
  })
})

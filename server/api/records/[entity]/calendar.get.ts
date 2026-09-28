import { z } from 'zod'
import { and, asc, eq, gte, lt, or, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields, records, tenants } from '~/server/db/schema'
import { recordNotDeleted } from '~/server/utils/records'
import { resolveCalendarConfig } from '~/server/utils/calendarConfig'
import { resolveRelationLabels } from '~/server/utils/relationLabels'
import { zonedTimeFromIso } from '~/utils/calendar'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignedToMe: z.enum(['true', 'false']).transform(value => value === 'true').optional()
}).superRefine((value, ctx) => {
  if (value.from >= value.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'El límite superior debe ser posterior al inicio' })
})

export default defineEventHandler(async event => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const query = await getValidatedQuery(event, querySchema.parse)

  return withTenant(auth.tenantId, async tx => {
    const fields = await tx.select({ name: entityFields.name, label: entityFields.label, dataType: entityFields.dataType, validationRules: entityFields.validationRules, isOwnerField: entityFields.isOwnerField })
      .from(entityFields).where(eq(entityFields.entityId, entity.id)).orderBy(entityFields.sortOrder)
    const config = resolveCalendarConfig(entity.calendarConfig, fields)
    if (!config.enabled || !config.startDateField) throw createError({ statusCode: 422, statusMessage: 'La vista de calendario no está configurada para este módulo' })

    let where = and(
      eq(records.tenantId, auth.tenantId),
      eq(records.entityId, entity.id),
      recordNotDeleted,
      gte(dsql`${records.customData}->>${config.startDateField}`, query.from),
      lt(dsql`${records.customData}->>${config.startDateField}`, query.to)
    )
    if (query.assignedToMe) {
      const ownerFields = fields.filter(field => field.dataType === 'user' && field.isOwnerField)
      where = and(where, ownerFields.length
        ? or(...ownerFields.map(field => dsql`(${records.customData}->>${field.name} = ${auth.sub} OR ${records.customData}->${field.name} ? ${auth.sub})`))
        : dsql`false`)
    }

    const rows = await tx.select().from(records).where(where).orderBy(asc(dsql`${records.customData}->>${config.startDateField}`))
    const relationLabels = await resolveRelationLabels(tx, auth.tenantId, fields, rows)
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1)
    const fieldByName = new Map(fields.map(field => [field.name, field]))
    const titleField = config.titleField ?? (entity.labelField && fieldByName.has(entity.labelField) ? entity.labelField : fields.find(field => ['text', 'incremental'].includes(field.dataType))?.name ?? null)
    const colorField = config.colorField ? fieldByName.get(config.colorField) : null
    const colorOptions = (colorField?.validationRules as { options?: Array<{ value: string; label?: string; color?: string }> } | null)?.options ?? []
    const groupField = config.groupByField ? fieldByName.get(config.groupByField) : null
    const groupOptions = (groupField?.validationRules as { options?: Array<{ value: string; label?: string }> } | null)?.options ?? []

    const events = rows.flatMap(row => {
      const data = row.customData as Record<string, unknown>
      const rawDate = String(data[config.startDateField!] ?? '')
      const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
      if (!date) return []
      const rawTime = config.startTimeField ? data[config.startTimeField] : null
      const time = typeof rawTime === 'string'
        ? (fieldByName.get(config.startTimeField!)?.dataType === 'datetime' ? zonedTimeFromIso(rawTime, tenant?.timezone ?? 'America/Mexico_City') : rawTime.match(/(?:T|^)(\d{1,2}:\d{2})/)?.[1] ?? '')
        : ''
      let durationMinutes = config.durationField ? Number(data[config.durationField]) : 60
      if (config.endField) {
        const rawEnd = data[config.endField]
        if (typeof rawEnd === 'string') {
          const endTime = fieldByName.get(config.endField)?.dataType === 'datetime'
            ? zonedTimeFromIso(rawEnd, tenant?.timezone ?? 'America/Mexico_City')
            : rawEnd.match(/(?:T|^)(\d{1,2}:\d{2})/)?.[1]
          if (endTime) {
            const start = time.match(/(\d{1,2}):(\d{2})/)
            const end = endTime.match(/(\d{1,2}):(\d{2})/)
            if (start && end) {
              durationMinutes = Number(end[1]) * 60 + Number(end[2]) - (Number(start[1]) * 60 + Number(start[2]))
              if (durationMinutes <= 0) durationMinutes += 1440
            }
          }
        }
      }
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) durationMinutes = 60
      const rawTitle = titleField ? data[titleField] : null
      const titleMeta = titleField ? fieldByName.get(titleField) : null
      const resolvedTitle = typeof rawTitle === 'string' && ['relation', 'user'].includes(titleMeta?.dataType ?? '')
        ? relationLabels[titleField!]?.[rawTitle]
        : null
      const title = resolvedTitle || (rawTitle == null || rawTitle === '' ? entity.name : String(rawTitle))
      const colorValue = config.colorField ? String(data[config.colorField] ?? '') : ''
      const groupValue = config.groupByField ? String(data[config.groupByField] ?? '') : ''
      const groupLabel = !groupValue ? '' : groupField?.dataType === 'select'
        ? groupOptions.find(option => option.value === groupValue)?.label ?? groupValue
        : relationLabels[config.groupByField!]?.[groupValue] ?? groupValue
      return [{
        id: row.id,
        customData: data,
        updatedAt: row.updatedAt,
        date,
        time,
        durationMinutes: Math.min(durationMinutes, 1440),
        title,
        color: colorOptions.find(option => option.value === colorValue)?.color ?? null,
        groupValue,
        groupLabel
      }]
    })
    return { config, events, relationLabels, timezone: tenant?.timezone ?? 'America/Mexico_City' }
  })
})

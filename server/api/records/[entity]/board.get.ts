import { z } from 'zod'
import { and, desc, eq, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields, records } from '~/server/db/schema'
import { recordNotDeleted } from '~/server/utils/records'
import { resolveBoardConfig } from '~/server/utils/boardConfig'
import { resolveRelationLabels } from '~/server/utils/relationLabels'
import { listFilterOperators, isListFilterable, type ListFilterOperator } from '~/utils/listFilters'

const querySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
  column: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).max(200).optional(),
  filterField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
  filterValues: z.string().trim().min(1).optional(),
  filterOperator: z.enum(['eq','neq','contains','gt','gte','lt','lte','between','is_true','is_false']).default('eq')
})

interface SelectOption {
  value: string
  label: string
  color?: string
}

export default defineEventHandler(async event => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const query = await getValidatedQuery(event, querySchema.parse)

  return withTenant(auth.tenantId, async tx => {
    const fields = await tx.select({
      name: entityFields.name,
      label: entityFields.label,
      dataType: entityFields.dataType,
      validationRules: entityFields.validationRules
    }).from(entityFields).where(eq(entityFields.entityId, entity.id)).orderBy(entityFields.sortOrder)

    const config = resolveBoardConfig(entity.boardConfig, fields)
    if (!config.enabled || !config.statusField) {
      throw createError({ statusCode: 422, statusMessage: 'La vista de tablero no está configurada para este módulo' })
    }

    const statusField = fields.find(field => field.name === config.statusField)!
    const rawOptions = (statusField.validationRules as { options?: unknown } | null)?.options
    const options: SelectOption[] = Array.isArray(rawOptions)
      ? rawOptions.filter((option): option is SelectOption => Boolean(option && typeof option === 'object' && typeof (option as SelectOption).value === 'string'))
      : []

    let baseWhere = and(eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted)
    if (query.search) {
      baseWhere = and(baseWhere, dsql`${records.customData}::text ilike ${'%' + query.search + '%'}`)
    }

    if (Boolean(query.filterField) !== Boolean(query.filterValues)) {
      throw createError({ statusCode: 422, statusMessage: 'filterField y filterValues deben enviarse juntos' })
    }
    if (query.filterField && query.filterValues) {
      const field = fields.find(candidate => candidate.name === query.filterField)
      if (!field) throw createError({ statusCode: 422, statusMessage: `"${query.filterField}" no es un campo de esta entidad` })
      if (!isListFilterable(field.dataType)) throw createError({ statusCode: 422, statusMessage: 'Este campo no admite filtros' })
      const allowed = listFilterOperators(field.dataType).map(operator => operator.value)
      if (!allowed.includes(query.filterOperator as ListFilterOperator)) throw createError({ statusCode: 422, statusMessage: 'Comparación no válida para este tipo de campo' })

      const values = query.filterValues.split(',').map(value => value.trim()).filter(Boolean)
      const pgArray = (vals: string[]) => dsql`ARRAY[${dsql.join(vals.map(value => dsql`${value}`), dsql.raw(', '))}]::text[]`
      const scalar = dsql`${records.customData}->>${query.filterField}`
      const numeric = field.dataType === 'number' || field.dataType === 'currency'
      if (numeric && values.some(value => !Number.isFinite(Number(value)))) throw createError({ statusCode: 422, statusMessage: 'El filtro requiere un valor numérico' })
      const comparable = numeric ? dsql`nullif(${scalar}, '')::numeric` : scalar
      const comparableValues: Array<string | number> = numeric ? values.map(Number) : values
      const operator = query.filterOperator

      if (operator === 'is_true' || operator === 'is_false') {
        baseWhere = and(baseWhere, dsql`${records.customData}->${query.filterField} = ${operator === 'is_true' ? dsql.raw("'true'::jsonb") : dsql.raw("'false'::jsonb")}`)
      } else if (operator === 'between') {
        if (values.length !== 2) throw createError({ statusCode: 422, statusMessage: 'El filtro entre requiere dos valores' })
        baseWhere = and(baseWhere, dsql`${comparable} >= ${comparableValues[0]} AND ${comparable} <= ${comparableValues[1]}`)
      } else if (operator === 'contains') {
        baseWhere = and(baseWhere, dsql`${scalar} ILIKE ${'%' + values[0] + '%'}`)
      } else if (operator === 'neq') {
        baseWhere = and(baseWhere, dsql`${comparable} <> ${comparableValues[0]}`)
      } else if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
        const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[operator]
        baseWhere = and(baseWhere, dsql`${comparable} ${dsql.raw(op)} ${comparableValues[0]}`)
      } else if (field.dataType === 'multiselect') {
        baseWhere = and(baseWhere, dsql`${records.customData}->${query.filterField} ?| ${pgArray(values)}`)
      } else {
        baseWhere = and(baseWhere, dsql`${comparable} = ${comparableValues[0]}`)
      }
    }
    const definitions = [...options.map(option => ({ key: option.value, label: option.label || option.value, color: option.color })), { key: '__unset__', label: 'Sin estado', color: undefined }]
      .filter(definition => !query.column || definition.key === query.column)
    if (query.column && definitions.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'La columna solicitada no existe en este tablero' })
    }
    const columns = await Promise.all(definitions.map(async definition => {
      const statusExpression = dsql`${records.customData}->>${config.statusField!}`
      const statusWhere = definition.key === '__unset__'
        ? dsql`coalesce(${statusExpression}, '') = ''`
        : dsql`${statusExpression} = ${definition.key}`
      const where = and(baseWhere, statusWhere)
      const [rows, [{ count }]] = await Promise.all([
        tx.select().from(records).where(where).orderBy(desc(records.updatedAt)).limit(query.pageSize).offset(query.offset),
        tx.select({ count: dsql<number>`count(*)::int` }).from(records).where(where)
      ])
      return { ...definition, records: rows, total: count }
    }))

    const flattened = columns.flatMap(column => column.records)
    const relationLabels = await resolveRelationLabels(tx, auth.tenantId, fields, flattened)
    return { config, columns, relationLabels, pageSize: query.pageSize }
  })
})

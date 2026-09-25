import { z } from 'zod'
import { and, eq, inArray, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields, records } from '~/server/db/schema'
import { recordNotDeleted } from '~/server/utils/records'

// GET /api/records/:entity/totals?filterField=&filterValue=&fields=a,b
// Suma de campos numéricos (number/currency) de los registros que tienen
// `filterField` = `filterValue` (p. ej. las líneas de un documento). Sirve la
// fila de totales de las tablas editables de la ficha, sin traer todas las filas.
const querySchema = z.object({
  filterField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  filterValue: z.string().min(1).max(200),
  fields: z.string().min(1).max(500)
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const query = await getValidatedQuery(event, querySchema.parse)
  const names = [...new Set(query.fields.split(',').map(name => name.trim()).filter(Boolean))].slice(0, 10)

  return withTenant(auth.tenantId, async (tx) => {
    const fields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType }).from(entityFields)
      .where(and(eq(entityFields.entityId, entity.id), inArray(entityFields.name, [...names, query.filterField])))
    if (!fields.some(field => field.name === query.filterField)) {
      throw createError({ statusCode: 422, statusMessage: `"${query.filterField}" no es un campo de esta entidad` })
    }
    const summable = names.filter(name => ['number', 'currency'].includes(fields.find(field => field.name === name)?.dataType ?? ''))
    const where = and(
      eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted,
      dsql`${records.customData}->>${query.filterField} = ${query.filterValue}`
    )
    const selection: Record<string, ReturnType<typeof dsql>> = { count: dsql`count(*)::int` }
    summable.forEach((name, index) => {
      selection[`t${index}`] = dsql`coalesce(sum(nullif(${records.customData}->>${name}, '')::numeric), 0)::float8`
    })
    const [row] = await tx.select(selection).from(records).where(where)
    return {
      count: Number(row?.count ?? 0),
      totals: Object.fromEntries(summable.map((name, index) => [name, Number((row as Record<string, unknown>)?.[`t${index}`] ?? 0)]))
    }
  })
})

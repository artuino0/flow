import { z } from 'zod'
import { and, eq, desc, asc, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// GET /api/records/:entity?page=1&pageSize=20&sortBy=createdAt&sortDir=desc&search=... (HU-ERD-16, orden HU-ERD-24, search HU-ERD-72)
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // "createdAt"/"updatedAt" ordenan por columna propia; cualquier otro nombre
  // se interpreta como un campo dinamico dentro de custom_data (jsonb) y se
  // ordena por su valor de texto (limitacion conocida: un orden numerico o de
  // fecha sobre un campo dinamico queda lexicografico, no "real" - el Table
  // Builder de ERD-24 lo documenta como tal en vez de fingir precision).
  // El nombre se parametriza como valor (operador ->>), nunca como
  // identificador SQL, asi que no hay riesgo de inyeccion aunque no se
  // valide contra la lista real de entity_fields de la entidad.
  sortBy: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  // HU-ERD-72: autocomplete de columnas de relacion dentro de un campo Tabla
  // (components/DynamicTableField.vue) - "buscar producto" necesita filtrar
  // records de OTRA entidad por texto libre. No hay un campo "nombre" fijo
  // (custom_data es jsonb dinamico por entidad), asi que se castea todo el
  // jsonb a texto y se filtra con ILIKE - mismo criterio pragmatico ya
  // aceptado para sortBy sobre un campo dinamico (imprecision documentada en
  // vez de fingir un motor de busqueda real). Sin indice full-text: valido
  // para tipeahead con pageSize chico, no pensado para catalogos enormes.
  search: z.string().trim().min(1).max(200).optional()
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const query = await getValidatedQuery(event, querySchema.parse)
  const offset = (query.page - 1) * query.pageSize

  const sortExpr =
    query.sortBy === 'createdAt'
      ? records.createdAt
      : query.sortBy === 'updatedAt'
        ? records.updatedAt
        : dsql`${records.customData}->>${query.sortBy}`
  const orderBy = query.sortDir === 'asc' ? asc(sortExpr) : desc(sortExpr)

  const baseWhere = and(eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id))
  const where = query.search ? and(baseWhere, dsql`${records.customData}::text ilike ${'%' + query.search + '%'}`) : baseWhere

  return withTenant(auth.tenantId, async (tx) => {
    const data = await tx.select().from(records).where(where).orderBy(orderBy).limit(query.pageSize).offset(offset)

    const [{ count }] = await tx.select({ count: dsql<number>`count(*)::int` }).from(records).where(where)

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      sortBy: query.sortBy,
      sortDir: query.sortDir
    }
  })
})

import { z } from 'zod'
import { and, eq, desc, asc, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records, entityFields } from '~/server/db/schema'
import { resolveRelationLabels } from '~/server/utils/relationLabels'

// GET /api/records/:entity?page=1&pageSize=20&sortBy=createdAt&sortDir=desc&search=...&filterField=...&filterValues=a,b
// (HU-ERD-16, orden HU-ERD-24, search HU-ERD-72, filtro HU-ERD-73)
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
  search: z.string().trim().min(1).max(200).optional(),
  // HU-ERD-73: panel de Filtros del listado (Screen/List Pedidos - Filtro
  // Select del .pen) - a diferencia de sortBy, filterField SI se valida
  // contra entity_fields real (abajo): un filtro que cambia los RESULTADOS
  // (no solo el orden) fallando en silencio para un nombre mal tipeado seria
  // mucho peor que la imprecision ya aceptada de sortBy. Un solo campo de
  // filtro a la vez (no una pila de filtros combinados con AND/OR) - el
  // diseño solo muestra un filtro activo por vez con "+ Agregar filtro" para
  // reemplazarlo, no una combinatoria de filtros; sumar eso queda para un
  // ticket futuro si hace falta.
  filterField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
  filterValues: z.string().trim().min(1).optional()
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const query = await getValidatedQuery(event, querySchema.parse)
  const offset = (query.page - 1) * query.pageSize

  if (Boolean(query.filterField) !== Boolean(query.filterValues)) {
    throw createError({ statusCode: 422, statusMessage: 'filterField y filterValues deben enviarse juntos' })
  }

  const sortExpr =
    query.sortBy === 'createdAt'
      ? records.createdAt
      : query.sortBy === 'updatedAt'
        ? records.updatedAt
        : dsql`${records.customData}->>${query.sortBy}`
  const orderBy = query.sortDir === 'asc' ? asc(sortExpr) : desc(sortExpr)

  const baseWhere = and(eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id))

  return withTenant(auth.tenantId, async (tx) => {
    let where = query.search ? and(baseWhere, dsql`${records.customData}::text ilike ${'%' + query.search + '%'}`) : baseWhere

    if (query.filterField && query.filterValues) {
      const [field] = await tx
        .select({ dataType: entityFields.dataType })
        .from(entityFields)
        .where(and(eq(entityFields.entityId, entity.id), eq(entityFields.name, query.filterField)))
        .limit(1)
      if (!field) {
        throw createError({ statusCode: 422, statusMessage: `"${query.filterField}" no es un campo de esta entidad` })
      }

      const values = query.filterValues.split(',').map((v) => v.trim()).filter(Boolean)
      // OJO con `sql`...${values}...``: drizzle-orm NO bindea un array JS
      // como un unico parametro Postgres - lo expande como lista de valores
      // separados por coma (pensado para armar "IN (${lista})"), asi que
      // `${values}::text[]` termina casteando UN SOLO valor escalar (o una
      // lista mal formada con mas de uno) a array, y Postgres tira "malformed
      // array literal". La forma correcta de armar un array real bindeado es
      // construirlo explicitamente con ARRAY[...] a partir de placeholders
      // individuales (sql.join) - pgArray() de abajo. Documentado aca porque
      // no es obvio y ya causo un 500 en runtime antes de esta nota.
      const pgArray = (vals: string[]) => dsql`ARRAY[${dsql.join(vals.map((v) => dsql`${v}`), dsql.raw(', '))}]::text[]`

      // "es alguno de" (multiselect, criterio de aceptacion explicito de
      // HU-ERD-73): el valor guardado es un array jsonb (['urgente','...']) -
      // el operador `?|` de Postgres compara ese array contra el array de
      // valores elegidos SIN traer registros a memoria para filtrar en el
      // cliente. Para el resto de los tipos (select y, en general, cualquier
      // campo escalar) el valor guardado es un solo string - "es"/"es alguno
      // de" se resuelven ambos con `= ANY(...)` (un solo value es el caso
      // particular de "es").
      const filterExpr =
        field.dataType === 'multiselect'
          ? dsql`${records.customData}->${query.filterField} ?| ${pgArray(values)}`
          : dsql`${records.customData}->>${query.filterField} = ANY(${pgArray(values)})`
      where = and(where, filterExpr)
    }

    const data = await tx.select().from(records).where(where).orderBy(orderBy).limit(query.pageSize).offset(offset)

    const [{ count }] = await tx.select({ count: dsql<number>`count(*)::int` }).from(records).where(where)

    // Reportado por el usuario (2026-09-03): columnas de tipo relation en el
    // listado mostraban el uuid crudo (ver comentario largo en
    // server/utils/relationLabels.ts) - se resuelve una sola vez aca, para
    // toda la pagina, en vez de que cada fila del cliente dispare su propia
    // consulta.
    const sourceFields = await tx
      .select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields)
      .where(eq(entityFields.entityId, entity.id))
    const relationLabels = await resolveRelationLabels(tx, auth.tenantId, sourceFields, data)

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      filterField: query.filterField,
      filterValues: query.filterValues,
      relationLabels
    }
  })
})

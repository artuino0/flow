import { z } from 'zod'
import { sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import {
  loadTenantFieldContext,
  ReportPathPlanner,
  InvalidFieldPathError,
  type ColumnSource,
  type EntityFieldMeta
} from '~/server/utils/reportFieldPath'

// ERD-88 (Diseñador de reportes imprimibles): DSL declarativo + motor de
// ejecución de un reporte imprimible con UNA tabla base, a lo sumo UNA "tabla
// relacionada" (detalle 1:N, ver Screen/Config de tabla relacionada), y hasta
// 4 niveles de agrupación (Screen/Vista previa impresión - grupos anidados).
// Mismo principio de server/utils/reportQuery.ts (ERD-46) y triggers.ts
// (ERD-48): nunca se genera SQL de texto libre a partir de input arbitrario -
// toda ruta de campo pasa por ReportPathPlanner, que solo arma joins a partir
// de metadata real de entity_fields ya validada (dataType==='relation').
//
// La consulta real es UN solo SELECT plano (una fila por combinación
// base×detalle, sin agregación en SQL) - agrupar/subtotalizar/totalizar se
// hace en TypeScript sobre esas filas (executePrintReport de abajo). Elegido
// por tractabilidad frente a un rollup SQL multi-nivel genérico, mismo
// criterio de simplicidad deliberada que reportQuery.ts.
//
// Tres tipos de columna (pedido explícito del usuario tras mostrar el
// reporte real de "empaque" con columnas condicionales/pivot):
//   - 'detalle': muestra el valor del campo tal cual, en cada fila impresa.
//   - 'sumar': suma el campo (debe ser numérico: dataType 'number' o
//     'incremental') y se imprime como subtotal en cada nivel de grupo activo
//     y como total general al final - NUNCA en las filas de detalle.
//   - 'repartir': reparte en partes iguales un total del ÚLTIMO nivel de
//     grupo activo (o del total general si no hay grupos) entre la cantidad
//     de filas de detalle de ese grupo - alcance deliberadamente simple
//     (reparto equitativo, no proporcional a otra columna) para esta HU;
//     cubre el caso real mostrado ("costo del lote repartido entre bultos").

export class PrintReportError extends Error {}

const columnKeySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'key debe ser snake_case (ej. "total_kilos")')

const columnSourceSchema = z
  .object({
    side: z.enum(['base', 'detail']),
    forwardHops: z.array(z.string().min(1).max(60)).max(3).default([]),
    field: z.string().min(1).max(60)
  })
  .strict()

const printReportColumnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('detalle'), key: columnKeySchema, label: z.string().min(1).max(80), source: columnSourceSchema }).strict(),
  z.object({ kind: z.literal('sumar'), key: columnKeySchema, label: z.string().min(1).max(80), source: columnSourceSchema }).strict(),
  z.object({ kind: z.literal('repartir'), key: columnKeySchema, label: z.string().min(1).max(80), source: columnSourceSchema }).strict()
])

export type PrintReportColumn = z.infer<typeof printReportColumnSchema>

export const printReportDslSchema = z
  .object({
    title: z.string().min(1).max(120),
    baseEntity: z.string().min(1).max(80),
    includeDeletedBase: z.boolean().default(false),
    detail: z
      .object({
        entitySlug: z.string().min(1).max(80),
        fieldName: z.string().min(1).max(60),
        includeDeleted: z.boolean().default(false)
      })
      .strict()
      .optional(),
    groupBy: z.array(columnSourceSchema).max(4).default([]),
    columns: z.array(printReportColumnSchema).min(1).max(20)
  })
  .strict()

export type PrintReportDsl = z.infer<typeof printReportDslSchema>

export interface PrintReportRow {
  values: Record<string, string | number | null>
}

export interface PrintReportGroup {
  level: number
  label: string
  rows: PrintReportRow[]
  children: PrintReportGroup[]
  subtotals: Record<string, number>
}

export interface PrintReportResult {
  title: string
  columns: Array<{ key: string; label: string; kind: PrintReportColumn['kind'] }>
  groups: PrintReportGroup[]
  ungroupedRows: PrintReportRow[]
  grandTotals: Record<string, number>
}

const NUMERIC_DATA_TYPES = new Set(['number', 'incremental'])

function assertNumericField(field: EntityFieldMeta, columnLabel: string): void {
  if (!NUMERIC_DATA_TYPES.has(field.dataType)) {
    throw new PrintReportError(`La columna "${columnLabel}" (${field.label}) no es numérica - no se puede sumar ni repartir`)
  }
}

function rawColumnAlias(key: string, index: number): string {
  // Los keys ya estan validados por columnKeySchema (snake_case), pero se
  // antepone un prefijo fijo + indice para blindar contra colisiones con los
  // alias fijos usados mas abajo (__base_id__, __detail_id__, __group_N__).
  return `col_${index}_${key}`
}

function groupAlias(index: number): string {
  return `group_${index}`
}

/**
 * Valida y ejecuta un PrintReportDsl: resuelve entidades/joins con
 * loadTenantFieldContext + ReportPathPlanner, corre UNA consulta plana y
 * arma la estructura de grupos/subtotales/total general en memoria.
 */
export async function executePrintReport(tenantId: string, dsl: PrintReportDsl): Promise<PrintReportResult> {
  return withTenant(tenantId, async (tx) => {
    const ctx = await loadTenantFieldContext(tx, tenantId)

    const baseEntity = ctx.entitiesBySlug.get(dsl.baseEntity)
    if (!baseEntity) throw new PrintReportError(`La entidad base "${dsl.baseEntity}" no existe`)

    let detailEntity: { id: string; slug: string; name: string } | undefined
    if (dsl.detail) {
      const found = ctx.entitiesBySlug.get(dsl.detail.entitySlug)
      if (!found) throw new PrintReportError(`La tabla relacionada "${dsl.detail.entitySlug}" no existe`)
      const detailFields = ctx.fieldsByEntityId.get(found.id) ?? []
      const relField = detailFields.find((f) => f.name === dsl.detail!.fieldName)
      if (!relField || relField.dataType !== 'relation') {
        throw new PrintReportError(`"${dsl.detail.fieldName}" no es un campo de relación válido en "${found.name}"`)
      }
      const rules = (relField.validationRules ?? {}) as { relationEntity?: string }
      if (rules.relationEntity !== baseEntity.slug) {
        throw new PrintReportError(`"${dsl.detail.fieldName}" no apunta a la entidad base "${baseEntity.slug}"`)
      }
      detailEntity = found
    }

    if (dsl.groupBy.some((g) => g.side === 'detail') && !detailEntity) {
      throw new PrintReportError('No se puede agrupar por la tabla relacionada: este reporte no tiene una configurada')
    }

    const planner = new ReportPathPlanner(ctx, tenantId, baseEntity.id, detailEntity?.id)

    // Resuelve (y valida) cada columna/agrupacion ANTES de armar el SQL, para
    // fallar con un error claro de dominio antes de tocar la base de datos.
    const resolvedColumns = dsl.columns.map((col, index) => {
      const { field } = planner.resolve(col.source)
      if (col.kind === 'sumar' || col.kind === 'repartir') assertNumericField(field, col.label)
      return { col, index, field }
    })
    const resolvedGroups = dsl.groupBy.map((source, index) => ({ source, index, ...planner.resolve(source) }))

    const selectParts: ReturnType<typeof dsql>[] = [
      dsql`${dsql.raw('r_base')}.id as __base_id__`,
      ...(detailEntity ? [dsql`${dsql.raw('r_detail')}.id as __detail_id__`] : [])
    ]
    for (const g of resolvedGroups) {
      selectParts.push(dsql`${planner.valueSql(g.source)} as ${dsql.raw(groupAlias(g.index))}`)
    }
    for (const { col, index } of resolvedColumns) {
      selectParts.push(dsql`${planner.valueSql(col.source)} as ${dsql.raw(rawColumnAlias(col.key, index))}`)
    }

    const whereParts = [
      dsql`${dsql.raw('r_base')}.tenant_id = ${tenantId}`,
      dsql`${dsql.raw('r_base')}.entity_id = ${baseEntity.id}`
    ]
    if (!dsl.includeDeletedBase) whereParts.push(dsql`${dsql.raw('r_base')}.deleted_at is null`)

    let fromSql = dsql`from records as ${dsql.raw('r_base')}`
    if (detailEntity && dsl.detail) {
      const detailConds = [
        dsql`${dsql.raw('r_detail')}.entity_id = ${detailEntity.id}`,
        dsql`(${dsql.raw('r_detail')}.custom_data ->> ${dsl.detail.fieldName})::uuid = ${dsql.raw('r_base')}.id`,
        dsql`${dsql.raw('r_detail')}.tenant_id = ${tenantId}`
      ]
      if (!dsl.detail.includeDeleted) detailConds.push(dsql`${dsql.raw('r_detail')}.deleted_at is null`)
      fromSql = dsql`${fromSql} left join records as ${dsql.raw('r_detail')} on ${dsql.join(detailConds, dsql` and `)}`
    }
    for (const joinPart of planner.joinSql) {
      fromSql = dsql`${fromSql} ${joinPart}`
    }

    const query = dsql`select ${dsql.join(selectParts, dsql`, `)} ${fromSql} where ${dsql.join(whereParts, dsql` and `)}`

    const rows = (await tx.execute(query)) as unknown as Record<string, unknown>[]

    return buildPrintReportResult(dsl, resolvedColumns.map(({ col, index }) => ({ col, index })), resolvedGroups.map((g) => g.index), rows)
  })
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function toDisplayValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  return String(value)
}

interface FlatRow {
  values: Record<string, unknown>
  groupKeys: string[]
  baseId: string | null
  hasDetail: boolean
}

/**
 * Suma "sin duplicar por join": el LEFT JOIN a la tabla relacionada repite el
 * mismo valor de un campo del lado 'base' en cada fila de detalle de ese
 * record base - sumar esas filas tal cual contaria el mismo total varias
 * veces. Para 'repartir' (y para 'sumar' cuando su fuente es del lado base)
 * se suma UNA sola vez por record base distinto (primera ocurrencia), no por
 * fila plana.
 */
function sumDedupByBase(rows: FlatRow[], key: string): number {
  const seen = new Map<string, number>()
  for (const row of rows) {
    const dedupeKey = row.baseId ?? `__no_base_${seen.size}__`
    if (!seen.has(dedupeKey)) seen.set(dedupeKey, toNumber(row.values[key]))
  }
  let total = 0
  for (const v of seen.values()) total += v
  return total
}

/**
 * Colapsa las filas planas (una por cada combinación base×detalle) en el
 * arbol de grupos anidados + subtotales + total general que consume
 * Screen/Vista previa impresión. Las columnas 'sumar'/'repartir' solo se
 * calculan a nivel de grupo/total - nunca aparecen en las filas de detalle.
 */
function buildPrintReportResult(
  dsl: PrintReportDsl,
  columnRefs: Array<{ col: PrintReportColumn; index: number }>,
  groupIndexes: number[],
  rawRows: Record<string, unknown>[]
): PrintReportResult {
  const detailColumns = columnRefs.filter((c) => c.col.kind === 'detalle')
  const sumColumns = columnRefs.filter((c) => c.col.kind === 'sumar' || c.col.kind === 'repartir')
  const repartirColumns = columnRefs.filter((c) => c.col.kind === 'repartir')
  // 'sumar' cuenta una sola vez por record base cuando su fuente viene del
  // lado 'base' (constante en cada fila del join) - de lo contrario sumaria
  // el mismo valor N veces (N = filas de detalle de ese record). Si la
  // fuente es del detalle, cada fila plana es un valor real distinto y se
  // suma tal cual.
  const sumColumnDedup = new Set(sumColumns.filter((c) => c.col.source.side === 'base').map((c) => c.col.key))

  const hasDetailTable = Boolean(dsl.detail)
  const flatRows: FlatRow[] = rawRows.map((raw) => {
    const values: Record<string, unknown> = {}
    for (const { col, index } of columnRefs) values[col.key] = raw[rawColumnAlias(col.key, index)]
    const groupKeys = groupIndexes.map((i) => String(raw[groupAlias(i)] ?? ''))
    const baseId = raw.__base_id__ === null || raw.__base_id__ === undefined ? null : String(raw.__base_id__)
    // Sin tabla relacionada, cada fila plana ES un record base real. Con
    // tabla relacionada, el LEFT JOIN produce una fila "fantasma" (todo
    // detail null) para un record base sin ningun detalle vinculado - esa
    // fila fantasma cuenta para el grupo (aparece con 0 filas de detalle,
    // igual que un lote sin bultos en el reporte impreso real) pero NUNCA
    // debe imprimirse como una fila de detalle vacia.
    const hasDetail = !hasDetailTable || (raw.__detail_id__ !== null && raw.__detail_id__ !== undefined)
    return { values, groupKeys, baseId, hasDetail }
  })

  function sumColumn(rows: FlatRow[], key: string): number {
    if (sumColumnDedup.has(key)) return sumDedupByBase(rows, key)
    return rows.reduce((acc, r) => acc + toNumber(r.values[key]), 0)
  }

  const grandTotals: Record<string, number> = {}
  for (const { col } of sumColumns) grandTotals[col.key] = sumColumn(flatRows, col.key)

  function toPrintRow(row: FlatRow): PrintReportRow {
    const values: Record<string, string | number | null> = {}
    for (const { col } of detailColumns) values[col.key] = toDisplayValue(row.values[col.key])
    return { values }
  }

  function buildLevel(rows: FlatRow[], level: number): PrintReportGroup[] {
    if (level >= groupIndexes.length) return []
    const buckets = new Map<string, FlatRow[]>()
    for (const row of rows) {
      const key = row.groupKeys[level] ?? ''
      const bucket = buckets.get(key)
      if (bucket) bucket.push(row)
      else buckets.set(key, [row])
    }
    return Array.from(buckets.entries()).map(([label, bucketRows]) => {
      const subtotals: Record<string, number> = {}
      for (const { col } of sumColumns) subtotals[col.key] = sumColumn(bucketRows, col.key)

      const isLastLevel = level === groupIndexes.length - 1
      const children = buildLevel(bucketRows, level + 1)
      const realRows = bucketRows.filter((r) => r.hasDetail)
      const printedRows = isLastLevel ? realRows.map(toPrintRow) : []
      if (isLastLevel) {
        for (const { col } of repartirColumns) {
          const share = realRows.length > 0 ? subtotals[col.key] / realRows.length : 0
          for (const printed of printedRows) printed.values[col.key] = share
        }
      }
      return { level, label, rows: printedRows, children, subtotals }
    })
  }

  const groups = buildLevel(flatRows, 0)
  const realFlatRows = flatRows.filter((r) => r.hasDetail)
  const ungroupedRows = groupIndexes.length === 0 ? realFlatRows.map(toPrintRow) : []
  if (groupIndexes.length === 0) {
    for (const { col } of repartirColumns) {
      const share = realFlatRows.length > 0 ? grandTotals[col.key] / realFlatRows.length : 0
      for (const printed of ungroupedRows) printed.values[col.key] = share
    }
  }

  return {
    title: dsl.title,
    columns: columnRefs.map(({ col }) => ({ key: col.key, label: col.label, kind: col.kind })),
    groups,
    ungroupedRows,
    grandTotals
  }
}

export { InvalidFieldPathError }
export type { ColumnSource }

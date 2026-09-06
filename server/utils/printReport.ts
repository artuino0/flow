import { z } from 'zod'
import { sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import {
  loadTenantFieldContext,
  ReportPathPlanner,
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
// Tres tipos de columna (verificados 1:1 contra Screen/Config de tabla
// relacionada en Pencil - panel "Propiedades", sección "COLUMNAS ·
// AGREGACIÓN"):
//   - 'detalle': muestra el valor del campo tal cual, en cada fila impresa.
//     ("Sin agregación... se repite en cada fila")
//   - 'sumar': suma el campo (debe ser numérico: dataType 'number' o
//     'incremental') y se imprime como subtotal en cada nivel de grupo activo
//     y como total general al final - NUNCA en las filas de detalle.
//     ("Genera subtotal por grupo y total general")
//   - 'repartir': PIVOT condicional, no reparto proporcional (nombre inicial
//     mal interpretado en un borrador previo de este archivo, corregido tras
//     re-revisar el mock real "repcard" de Screen/Config de tabla
//     relacionada: "Repartir «Cantidad» por condición" + selector "Campo
//     condición" (ej. Embarcado sí/no) + un mapeo valor->nombre de columna
//     por cada valor posible (ej. "Sí"->"Embarcados", "No"->"No
//     embarcados"). Divide UNA columna numérica en VARIAS columnas, una por
//     cada valor posible de `conditionSource` (boolean o select) - el mismo
//     patron SQL "SUM(CASE WHEN condicion = X THEN valor ELSE 0 END)" del
//     reporte real de "empaque" que motivó esta HU. A diferencia de 'sumar',
//     cada columna generada SI aparece en las filas de detalle (con 0 en las
//     filas que no matchean esa condición) Y TAMBIEN se totaliza en
//     subtotales/total general - confirmado en Screen/Vista previa impresión
//     (columnas "Emb."/"No emb." con valores por fila Y sumadas en cada
//     "Subtotal ..."). Alcance deliberado: `source` y `conditionSource` deben
//     estar del MISMO lado (`side`) - evaluarlos en lados distintos de un
//     join 1:N no tiene una lectura correcta única y queda fuera de alcance.

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
  z
    .object({
      kind: z.literal('repartir'),
      key: columnKeySchema,
      label: z.string().min(1).max(80),
      source: columnSourceSchema,
      conditionSource: columnSourceSchema,
      // Override opcional de etiqueta por valor crudo de conditionSource
      // ("true"/"false" para boolean, el `value` de la opción para select) -
      // ej. {"true": "Embarcados", "false": "No embarcados"}. Sin override,
      // se usa "Sí"/"No" (boolean) o la label de la opción (select).
      valueLabels: z.record(z.string(), z.string().min(1).max(60)).optional()
    })
    .strict()
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
  isDeleted: boolean
}

export interface PrintReportGroup {
  level: number
  label: string
  rows: PrintReportRow[]
  children: PrintReportGroup[]
  subtotals: Record<string, number>
}

export interface PrintReportResultColumn {
  key: string
  label: string
  kind: PrintReportColumn['kind']
  // Solo presente para columnas generadas por un 'repartir': el key del
  // campo DSL original (dsl.columns[].key) del que salió esta columna - el
  // frontend lo usa para agrupar visualmente las columnas pivoteadas bajo el
  // mismo encabezado lógico si quiere.
  pivotOf?: string
}

export interface PrintReportResult {
  title: string
  columns: PrintReportResultColumn[]
  groups: PrintReportGroup[]
  ungroupedRows: PrintReportRow[]
  grandTotals: Record<string, number>
}

const NUMERIC_DATA_TYPES = new Set(['number', 'incremental'])
const PIVOTABLE_DATA_TYPES = new Set(['boolean', 'select'])

function assertNumericField(field: EntityFieldMeta, columnLabel: string): void {
  if (!NUMERIC_DATA_TYPES.has(field.dataType)) {
    throw new PrintReportError(`La columna "${columnLabel}" (${field.label}) no es numérica - no se puede sumar ni repartir`)
  }
}

interface PivotOption {
  rawValue: string
  label: string
}

function resolvePivotOptions(conditionField: EntityFieldMeta, valueLabels: Record<string, string> | undefined): PivotOption[] {
  if (!PIVOTABLE_DATA_TYPES.has(conditionField.dataType)) {
    throw new PrintReportError(`"${conditionField.label}" no se puede usar como condición de reparto - debe ser un campo booleano o de selección`)
  }
  if (conditionField.dataType === 'boolean') {
    return [
      { rawValue: 'true', label: valueLabels?.true ?? 'Sí' },
      { rawValue: 'false', label: valueLabels?.false ?? 'No' }
    ]
  }
  const rules = (conditionField.validationRules ?? {}) as { options?: Array<{ value: string; label: string }> }
  const options = rules.options ?? []
  if (options.length === 0) {
    throw new PrintReportError(`"${conditionField.label}" no tiene opciones configuradas - no se puede usar como condición de reparto`)
  }
  return options.map((o) => ({ rawValue: o.value, label: valueLabels?.[o.value] ?? o.label }))
}

function sanitizeAliasHint(s: string): string {
  const cleaned = s.replace(/[^a-zA-Z0-9_]/g, '_')
  return cleaned.length > 0 ? cleaned : 'x'
}

function rawColumnAlias(hint: string, index: number): string {
  // El indice numerico garantiza unicidad por si solo - `hint` (saneado) es
  // solo para que el SQL generado sea mas legible al depurar.
  return `col_${index}_${sanitizeAliasHint(hint)}`
}

function groupAlias(index: number): string {
  return `group_${index}`
}

// Una "hoja" resuelta a partir de una columna del DSL: una columna 'detalle'
// o 'sumar' produce exactamente una hoja; una 'repartir' produce una hoja por
// cada valor posible de su conditionSource. `inRows`/`inTotals` deciden en
// qué parte del resultado aparece cada hoja - ver el comentario grande de
// arriba sobre el comportamiento distinto de cada kind.
interface ResolvedLeaf {
  key: string
  label: string
  kind: PrintReportColumn['kind']
  pivotOf?: string
  inRows: boolean
  inTotals: boolean
  sourceSide: 'base' | 'detail'
  valueAlias: string
  conditionAlias?: string
  pivotRawValue?: string
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
    const selectParts: ReturnType<typeof dsql>[] = [
      dsql`${dsql.raw('r_base')}.id as __base_id__`,
      ...(detailEntity ? [dsql`${dsql.raw('r_detail')}.id as __detail_id__`, dsql`${dsql.raw('r_detail')}.deleted_at as __detail_deleted__`] : [dsql`${dsql.raw('r_base')}.deleted_at as __base_deleted__`])
    ]

    const groupAliases = dsl.groupBy.map((source, index) => {
      planner.resolve(source)
      const alias = groupAlias(index)
      selectParts.push(dsql`${planner.valueSql(source)} as ${dsql.raw(alias)}`)
      return alias
    })

    // Resuelve (y valida) cada columna del DSL, expandiendola a 1 o mas
    // "hojas" segun su kind, ANTES de armar el SQL - para fallar con un error
    // claro de dominio antes de tocar la base de datos.
    let leafCounter = 0
    const leaves: ResolvedLeaf[] = []
    for (const col of dsl.columns) {
      const { field } = planner.resolve(col.source)
      if (col.kind === 'detalle') {
        const alias = rawColumnAlias(col.key, leafCounter++)
        selectParts.push(dsql`${planner.valueSql(col.source)} as ${dsql.raw(alias)}`)
        leaves.push({ key: col.key, label: col.label, kind: 'detalle', inRows: true, inTotals: false, sourceSide: col.source.side, valueAlias: alias })
      } else if (col.kind === 'sumar') {
        assertNumericField(field, col.label)
        const alias = rawColumnAlias(col.key, leafCounter++)
        selectParts.push(dsql`${planner.valueSql(col.source)} as ${dsql.raw(alias)}`)
        leaves.push({ key: col.key, label: col.label, kind: 'sumar', inRows: false, inTotals: true, sourceSide: col.source.side, valueAlias: alias })
      } else {
        assertNumericField(field, col.label)
        if (col.conditionSource.side !== col.source.side) {
          throw new PrintReportError(`"${col.label}": el campo a repartir y el campo condición deben estar del mismo lado (base o tabla relacionada)`)
        }
        const { field: conditionField } = planner.resolve(col.conditionSource)
        const options = resolvePivotOptions(conditionField, col.valueLabels)
        const valueAlias = rawColumnAlias(col.key, leafCounter++)
        selectParts.push(dsql`${planner.valueSql(col.source)} as ${dsql.raw(valueAlias)}`)
        const conditionAlias = rawColumnAlias(`${col.key}_cond`, leafCounter++)
        selectParts.push(dsql`${planner.valueSql(col.conditionSource)} as ${dsql.raw(conditionAlias)}`)
        for (const opt of options) {
          leaves.push({
            key: `${col.key}__${sanitizeAliasHint(opt.rawValue)}`,
            label: opt.label,
            kind: 'repartir',
            pivotOf: col.key,
            inRows: true,
            inTotals: true,
            sourceSide: col.source.side,
            valueAlias,
            conditionAlias,
            pivotRawValue: opt.rawValue
          })
        }
      }
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

    return buildPrintReportResult(dsl, leaves, groupAliases, rows)
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
  isDeleted: boolean
}

/**
 * Suma "sin duplicar por join": el LEFT JOIN a la tabla relacionada repite el
 * mismo valor de un campo del lado 'base' en cada fila de detalle de ese
 * record base - sumar esas filas tal cual contaria el mismo total varias
 * veces. Para columnas cuya fuente es del lado 'base' se suma UNA sola vez
 * por record base distinto (primera ocurrencia), no por fila plana.
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
 * Screen/Vista previa impresión.
 */
function buildPrintReportResult(dsl: PrintReportDsl, leaves: ResolvedLeaf[], groupAliases: string[], rawRows: Record<string, unknown>[]): PrintReportResult {
  const rowColumns = leaves.filter((l) => l.inRows)
  const totalColumns = leaves.filter((l) => l.inTotals)
  const dedupKeys = new Set(totalColumns.filter((l) => l.sourceSide === 'base').map((l) => l.key))

  const hasDetailTable = Boolean(dsl.detail)
  const flatRows: FlatRow[] = rawRows.map((raw) => {
    const values: Record<string, unknown> = {}
    for (const leaf of leaves) {
      if (leaf.kind === 'repartir') {
        const matches = String(raw[leaf.conditionAlias!] ?? '') === leaf.pivotRawValue
        values[leaf.key] = matches ? toNumber(raw[leaf.valueAlias]) : 0
      } else {
        values[leaf.key] = raw[leaf.valueAlias]
      }
    }
    const groupKeys = groupAliases.map((alias) => String(raw[alias] ?? ''))
    const baseId = raw.__base_id__ === null || raw.__base_id__ === undefined ? null : String(raw.__base_id__)
    // Sin tabla relacionada, cada fila plana ES un record base real. Con
    // tabla relacionada, el LEFT JOIN produce una fila "fantasma" (todo
    // detail null) para un record base sin ningun detalle vinculado - esa
    // fila fantasma cuenta para el grupo (aparece con 0 filas de detalle,
    // igual que un lote sin bultos en el reporte impreso real) pero NUNCA
    // debe imprimirse como una fila de detalle vacia.
    const hasDetail = !hasDetailTable || (raw.__detail_id__ !== null && raw.__detail_id__ !== undefined)
    // Screen/Config de tabla relacionada: con "Incluir registros eliminados"
    // activo, una fila de la papelera SE MUESTRA (fila gris, "· Eliminado"),
    // no se descarta - isDeleted es la señal para que el frontend la pinte
    // distinto.
    const isDeleted = hasDetailTable ? raw.__detail_deleted__ !== null && raw.__detail_deleted__ !== undefined : raw.__base_deleted__ !== null && raw.__base_deleted__ !== undefined
    return { values, groupKeys, baseId, hasDetail, isDeleted }
  })

  function sumColumn(rows: FlatRow[], key: string): number {
    if (dedupKeys.has(key)) return sumDedupByBase(rows, key)
    return rows.reduce((acc, r) => acc + toNumber(r.values[key]), 0)
  }

  const grandTotals: Record<string, number> = {}
  for (const leaf of totalColumns) grandTotals[leaf.key] = sumColumn(flatRows, leaf.key)

  function toPrintRow(row: FlatRow): PrintReportRow {
    const values: Record<string, string | number | null> = {}
    for (const leaf of rowColumns) values[leaf.key] = toDisplayValue(row.values[leaf.key])
    return { values, isDeleted: row.isDeleted }
  }

  function buildLevel(rows: FlatRow[], level: number): PrintReportGroup[] {
    if (level >= groupAliases.length) return []
    const buckets = new Map<string, FlatRow[]>()
    for (const row of rows) {
      const key = row.groupKeys[level] ?? ''
      const bucket = buckets.get(key)
      if (bucket) bucket.push(row)
      else buckets.set(key, [row])
    }
    return Array.from(buckets.entries()).map(([label, bucketRows]) => {
      const subtotals: Record<string, number> = {}
      for (const leaf of totalColumns) subtotals[leaf.key] = sumColumn(bucketRows, leaf.key)

      const isLastLevel = level === groupAliases.length - 1
      const children = buildLevel(bucketRows, level + 1)
      const realRows = bucketRows.filter((r) => r.hasDetail)
      const printedRows = isLastLevel ? realRows.map(toPrintRow) : []
      return { level, label, rows: printedRows, children, subtotals }
    })
  }

  const groups = buildLevel(flatRows, 0)
  const realFlatRows = flatRows.filter((r) => r.hasDetail)
  const ungroupedRows = groupAliases.length === 0 ? realFlatRows.map(toPrintRow) : []

  return {
    title: dsl.title,
    columns: leaves
      .filter((l) => l.kind !== 'repartir' || l.inRows)
      .reduce<PrintReportResultColumn[]>((acc, l) => {
        if (acc.some((c) => c.key === l.key)) return acc
        acc.push({ key: l.key, label: l.label, kind: l.kind, pivotOf: l.pivotOf })
        return acc
      }, []),
    groups,
    ungroupedRows,
    grandTotals
  }
}

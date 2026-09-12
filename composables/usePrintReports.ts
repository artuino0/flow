// ERD-88 (Diseñador de reportes imprimibles): tipos compartidos entre las
// pantallas del Diseñador/Config de tabla relacionada/Vista previa - espejo
// en el cliente de server/utils/reportFieldPath.ts y server/utils/printReport.ts
// (mismo criterio que composables/useEntityFields.ts: el cliente no puede
// importar directo del server, así que los tipos se duplican a mano).

export interface FieldTreeLeaf {
  type: 'leaf'
  fieldName: string
  label: string
  dataType: string
}

export interface FieldTreeBranch {
  type: 'branch'
  kind: 'forward' | 'inverse'
  fieldName: string
  entitySlug: string
  entityName: string
  cardinality: '1:1' | '1:N'
  children: FieldTreeNode[]
}

export type FieldTreeNode = FieldTreeLeaf | FieldTreeBranch

export interface ColumnSource {
  side: 'base' | 'detail'
  forwardHops: string[]
  field: string
}

interface PrintReportColumnBase {
  key: string
  label: string
  source: ColumnSource
}

export interface PrintReportColumnDetalle extends PrintReportColumnBase {
  kind: 'detalle'
}
export interface PrintReportColumnSumar extends PrintReportColumnBase {
  kind: 'sumar'
}
export interface PrintReportColumnRepartir extends PrintReportColumnBase {
  kind: 'repartir'
  conditionSource: ColumnSource
  valueLabels?: Record<string, string>
}
export type PrintReportColumn = PrintReportColumnDetalle | PrintReportColumnSumar | PrintReportColumnRepartir

export interface PrintReportDetailConfig {
  entitySlug: string
  fieldName: string
  includeDeleted: boolean
}

export interface PrintReportDsl {
  parameters?: import('~/utils/reportParameters').ReportParameter[]
  mode?: 'detail' | 'summary'
  filters?: { source: ColumnSource; operator: 'eq' | 'contains' | 'gte' | 'lte' | 'lt' | 'gt'; value: string; recordId?: boolean }[]
  orderBy?: { source: ColumnSource; direction: 'asc' | 'desc' }[]
  layout?: import('~/utils/printLayout').PrintLayout
  title: string
  baseEntity: string
  includeDeletedBase: boolean
  detail?: PrintReportDetailConfig
  groupBy: ColumnSource[]
  columns: PrintReportColumn[]
}

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
  dataType?: string
  key: string
  label: string
  kind: PrintReportColumn['kind']
  pivotOf?: string
}

export interface PrintReportResult {
  criteria?: string[]
  mode?: 'detail' | 'summary'
  recordCount?: number
  title: string
  columns: PrintReportResultColumn[]
  groups: PrintReportGroup[]
  ungroupedRows: PrintReportRow[]
  grandTotals: Record<string, number>
}

export interface SavedPrintReport {
  id: string
  title: string
  baseEntitySlug: string
  dsl: PrintReportDsl
  createdAt: string
  updatedAt: string
}

/** GET /api/print-reports/fields?entity=<slug> - árbol de "Campos disponibles" del panel izquierdo del Diseñador. */
export function usePrintReportFieldTree(entitySlug: string) {
  return useFetch<{ fields: FieldTreeNode[] }>('/api/print-reports/fields', {
    key: `print-report-fields-${entitySlug}`,
    query: { entity: entitySlug },
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  })
}

export interface PrintReportPreviewDraft {
  // undefined = se estaba armando un reporte nuevo (pages/.../reportes/nuevo.vue);
  // un id = se estaba editando esa plantilla guardada (.../[id]/editar.vue).
  // El Diseñador solo restaura este draft si coincide (mismo contexto) -
  // nunca reaparece un borrador de OTRO reporte.
  reportId: string | undefined
  dsl: PrintReportDsl
}

// Bug reportado por el usuario (2026-09-07): "al dar vista previa y dar
// cerrar la previa se limpia el reporte no se guarda como esta en el
// momento" - PrintReportDesigner.vue dejaba el DSL en un useState solo para
// que Vista previa impresión lo leyera una vez; al volver con "Cerrar"
// (router.back(), misma ruta del Diseñador) el componente se monta de cero y
// nada leía ese DSL de vuelta, así que perdía título/columnas/agrupamientos
// no guardados. Ahora el mismo useState funciona como "borrador en curso" de
// esta pestaña: el Diseñador lo restaura al montar si coincide con lo que se
// está editando ahora mismo (mismo reportId, misma entidad base) y lo limpia
// al guardar o al descartar explícitamente.
export function usePrintReportPreviewDraft() {
  return useState<PrintReportPreviewDraft | null>('printReportPreviewDraft', () => null)
}

const NUMERIC_DATA_TYPES = new Set(['number', 'incremental'])
export function isNumericFieldType(dataType: string): boolean {
  return NUMERIC_DATA_TYPES.has(dataType)
}

const PIVOTABLE_DATA_TYPES = new Set(['boolean', 'select'])
export function isPivotableFieldType(dataType: string): boolean {
  return PIVOTABLE_DATA_TYPES.has(dataType)
}

export interface FlatLeaf {
  forwardHops: string[]
  field: string
  label: string
  dataType: string
}

// ReportPathPlanner (server/utils/reportFieldPath.ts) solo resuelve cadenas
// de saltos 'forward' (1:1) encadenados desde UN lado (base o detalle) - un
// salto inverso (1:N) anidado dentro de otro salto no tiene lectura posible
// en ese modelo. buildFieldTree() (mismo archivo) es un arbol generico que no
// conoce esa restriccion, asi que el cliente la aplica aca: al aplanar hojas
// "del lado base" se sigue SOLO por branches 'forward', descartando
// cualquier branch 'inverse' (esa es la candidata a "tabla relacionada", no
// una ruta de campo mas del lado base).
export function collectBaseLeaves(nodes: FieldTreeNode[], forwardHops: string[] = []): FlatLeaf[] {
  const out: FlatLeaf[] = []
  for (const node of nodes) {
    if (node.type === 'leaf') {
      out.push({ forwardHops, field: node.fieldName, label: node.label, dataType: node.dataType })
    } else if (node.kind === 'forward') {
      out.push(...collectBaseLeaves(node.children, [...forwardHops, node.fieldName]))
    }
    // node.kind === 'inverse': candidata a tabla relacionada, no se aplana aca.
  }
  return out
}

/** Branches 'inverse' de nivel 0 (candidatas a "tabla relacionada" - ReportPathPlanner solo soporta UNA). */
export function topLevelDetailCandidates(nodes: FieldTreeNode[]): FieldTreeBranch[] {
  return nodes.filter((n): n is FieldTreeBranch => n.type === 'branch' && n.kind === 'inverse')
}

/** Hojas navegables DENTRO de una tabla relacionada ya elegida (mismo criterio anti-inverse-anidado que collectBaseLeaves, aplicado a partir de sus children). */
export function collectDetailLeaves(detailBranch: FieldTreeBranch): FlatLeaf[] {
  return collectBaseLeaves(detailBranch.children, [])
}

// Vista previa impresión (ERD-88 #293): el DSL persistido solo guarda
// ColumnSource (side/forwardHops/field) para groupBy - a diferencia de las
// columnas normales, que sí traen su propio `label` elegido en el Diseñador.
// Para mostrar el encabezado de grupo "Fecha:  14 ago 2026" del mock hace
// falta resolver ese `field` contra el árbol de campos de vuelta a una
// etiqueta legible - esta función hace esa resolución una sola vez por
// pantalla (Vista previa/Imprimir), reusando el mismo árbol que ya trae
// GET /api/print-reports/fields.
export function resolveSourceLabel(fields: FieldTreeNode[], detail: PrintReportDetailConfig | undefined, source: ColumnSource): string {
  const pool = source.side === 'base' ? collectBaseLeaves(fields) : detailPool(fields, detail)
  const match = pool.find((l) => l.field === source.field && l.forwardHops.length === source.forwardHops.length && l.forwardHops.every((h, i) => h === source.forwardHops[i]))
  return match?.label ?? source.field
}

function detailPool(fields: FieldTreeNode[], detail: PrintReportDetailConfig | undefined): FlatLeaf[] {
  if (!detail) return []
  const branch = topLevelDetailCandidates(fields).find((b) => b.fieldName === detail.fieldName && b.entitySlug === detail.entitySlug)
  return branch ? collectDetailLeaves(branch) : []
}

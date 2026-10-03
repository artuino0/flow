<script setup lang="ts">
// The editable canvas and print preview share physical paper proportions.
// Layout is stored in the existing report DSL; older templates keep defaults.
import { resolvePrintLayout, paperDimensions } from '~/utils/printLayout'
import { inputsForType, type ReportParameter, type ParameterAnswers } from '~/utils/reportParameters'
import { moveReportColumn, readReportFieldDrop } from '~/utils/reportDesigner'
import { AlertTriangle, ArrowLeft, Ban, Calculator, ChevronDown, Eye, GripVertical, Plus, Search, FileWarning, Save, Settings2, Table2, Trash2, X, ZoomIn, ZoomOut } from '@lucide/vue'
import {
  collectBaseLeaves,
  resolveSourceLabel,
  type PrintReportResult,
  collectDetailLeaves,
  isNumericFieldType,
  isPivotableFieldType,
  topLevelDetailCandidates,
  usePrintReportFieldTree,
  usePrintReportPreviewDraft,
  type ColumnSource,
  type FieldTreeBranch,
  type FieldTreeNode,
  type FlatLeaf,
  type PrintReportColumn,
  type PrintReportDsl
} from '~/composables/usePrintReports'

const props = defineProps<{
  entitySlug: string
  reportId?: string
  initialTitle?: string
  initialDsl?: PrintReportDsl
}>()

const toast = useToast()
const router = useRouter()

const { data: treeData, pending: treePending, error: treeError } = usePrintReportFieldTree(props.entitySlug)
const baseEntityName = computed(() => treeData.value?.entityName || props.entitySlug)

// Ver el comentario grande de usePrintReportPreviewDraft(): si quedó un
// borrador de ESTE MISMO reporte (mismo reportId/entidad) de una vuelta
// anterior por Vista previa, se usa como fuente de los valores iniciales en
// vez de `props.initialDsl` (la plantilla guardada, ya desactualizada).
const previewDraft = usePrintReportPreviewDraft()
const restoredDsl =
  previewDraft.value && previewDraft.value.reportId === props.reportId && previewDraft.value.dsl.baseEntity === props.entitySlug ? previewDraft.value.dsl : null
const initialSource = restoredDsl ?? props.initialDsl
const mode = ref<'detail' | 'summary'>(initialSource?.mode ?? 'detail')
const filters = ref<NonNullable<PrintReportDsl['filters']>>(JSON.parse(JSON.stringify(initialSource?.filters ?? [])))
const parameters = ref<ReportParameter[]>(JSON.parse(JSON.stringify(initialSource?.parameters ?? [])))
const parameterModal = ref(false)
const legacyConverted = ref(false)
onMounted(() => watch(treeData, () => {
  if (!filters.value.length || !treeData.value) return
  parameters.value.push(...filters.value.map((filter, index) => {
    const leaf = availableLeaves.value.find(leaf => JSON.stringify([leaf.side, leaf.forwardHops, leaf.field]) === JSON.stringify([filter.source.side, filter.source.forwardHops, filter.source.field]))
    return { id: `legacy-${index}`, source: filter.source, label: leaf?.label ?? filter.source.field, input: inputsForType(leaf?.dataType ?? 'text')[0]?.value ?? 'text', required: false } as ReportParameter
  }))
  filters.value = []
  legacyConverted.value = true
}, { immediate: true }))
const orderBy = ref<NonNullable<PrintReportDsl['orderBy']>>(JSON.parse(JSON.stringify(initialSource?.orderBy ?? [])))
const fieldSearch = ref('')
const fieldSearchInput = ref<HTMLInputElement | null>(null)
const inlineResult = ref<PrintReportResult | null>(null)
const inlineLoading = ref(false)
const inlineError = ref('')
const inlineDate = ref(new Date())
const previewVisible = ref(false)
const structureZoom = ref(100)
const resultZoom = ref(100)
const currentZoom = computed(() => previewVisible.value ? resultZoom.value : structureZoom.value)
function changeZoom(delta: number) {
  const target = previewVisible.value ? resultZoom : structureZoom
  target.value = Math.min(150, Math.max(50, target.value + delta))
}
function setZoom(value: number) {
  if (!Number.isFinite(value)) return
  const target = previewVisible.value ? resultZoom : structureZoom
  target.value = Math.min(150, Math.max(50, value))
}
let previewRevision = 0

const title = ref(initialSource?.title ?? props.initialTitle ?? '')
const layout = ref(resolvePrintLayout(initialSource?.layout, initialSource?.columns.length))
const paperSize = computed(() => paperDimensions(layout.value))
const { data: reportBranding } = useFetch<{ name: string; hasLogo: boolean }>('/api/tenant/branding', { key: 'report-designer-branding' })
const includeDeletedBase = ref(initialSource?.includeDeletedBase ?? false)
const detail = ref(initialSource?.detail ? { ...initialSource.detail } : null as PrintReportDsl['detail'] | null)
const groupBy = ref<ColumnSource[]>(initialSource?.groupBy ? initialSource.groupBy.map((g) => ({ ...g })) : [])
const columns = ref<PrintReportColumn[]>(initialSource?.columns ? JSON.parse(JSON.stringify(initialSource.columns)) : [])
// dataType de cada columna, solo del lado cliente (el DSL que viaja al
// servidor no lo necesita - lo vuelve a resolver server-side - pero el
// Diseñador lo necesita para saber qué columnas pueden sumarse/repartirse y
// qué campos ofrecer como "Campo condición").
const columnDataTypes = ref<Record<string, string>>({})

const selectedKey = ref<string | null>(null)
const selectedColumn = computed(() => columns.value.find((c) => c.key === selectedKey.value) ?? null)
const activeSettingsSection = ref<'filters' | 'order' | 'columns' | 'calculations' | null>('filters')
watch(selectedKey, key => { if (key) activeSettingsSection.value = 'columns' })

const detailConfigOpen = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)

function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : 'columna'
}

function nextKey(label: string): string {
  const base = slugifyKey(label)
  const existing = new Set(columns.value.map((c) => c.key))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

const detailCandidates = computed<FieldTreeBranch[]>(() => topLevelDetailCandidates(treeData.value?.fields ?? []))
const detailEntityName = computed(() => detailCandidates.value.find(branch => branch.fieldName === detail.value?.fieldName && branch.entitySlug === detail.value?.entitySlug)?.entityName || detail.value?.entitySlug)
const baseLeaves = computed<FlatLeaf[]>(() => collectBaseLeaves(treeData.value?.fields ?? []))
const availableLeaves = computed(() => [...baseLeaves.value.map(leaf => ({ ...leaf, side: 'base' as const })), ...detailLeaves.value.map(leaf => ({ ...leaf, side: 'detail' as const }))])
const detailLeaves = computed<FlatLeaf[]>(() => {
  if (!detail.value) return []
  const branch = detailCandidates.value.find((b) => b.fieldName === detail.value!.fieldName && b.entitySlug === detail.value!.entitySlug)
  return branch ? collectDetailLeaves(branch) : []
})

// Al reabrir una plantilla guardada (initialDsl), sus columnas ya traen
// `source` resuelto pero no el dataType del campo (el DSL que viaja al
// servidor no lo necesita) - se lo busca en el árbol recién cargado para que
// el panel de Propiedades sepa si esa columna puede sumarse/repartirse.
function findLeafDataType(source: ColumnSource): string | undefined {
  const leaves = source.side === 'base' ? baseLeaves.value : detailLeaves.value
  const match = leaves.find((l) => l.field === source.field && l.forwardHops.length === source.forwardHops.length && l.forwardHops.every((h, i) => h === source.forwardHops[i]))
  return match?.dataType
}
watch(
  treeData,
  () => {
    for (const col of columns.value) {
      if (columnDataTypes.value[col.key]) continue
      const dt = findLeafDataType(col.source)
      if (dt) columnDataTypes.value[col.key] = dt
    }
  },
  { immediate: true }
)

function onSelectLeaf(payload: { side: 'base' | 'detail'; forwardHops: string[]; field: string; label: string; dataType: string }) {
  if (!findLeafDataType(payload)) return
  if (columns.value.length >= 20) {
    toast.error('Límite de columnas', 'El reporte admite hasta 20 columnas. Quita una antes de agregar otra.')
    return
  }
  const key = nextKey(payload.label)
  columns.value.push({ kind: 'detalle', key, label: payload.label, source: { side: payload.side, forwardHops: payload.forwardHops, field: payload.field } })
  columnDataTypes.value[key] = payload.dataType
  selectedKey.value = key
}

// Soltar una hoja arrastrada desde el árbol sobre la Zona Tabla del lienzo -
// mismo payload que emite `select-leaf` (ver PrintReportFieldTree.vue), así
// que reusa exactamente la misma lógica de alta que el clic.
function onCanvasDrop(event: DragEvent, targetKey?: string) {
  event.preventDefault()
  const movingKey = event.dataTransfer?.getData('application/x-flowerp-report-column')
  if (movingKey) {
    columns.value = moveReportColumn(columns.value, movingKey, targetKey ? columns.value.findIndex(column => column.key === targetKey) : columns.value.length - 1)
    return
  }
  const raw = event.dataTransfer?.getData('application/json')
  if (!raw) return
  const payload = readReportFieldDrop(raw)
  if (payload) {
    const previousCount = columns.value.length
    onSelectLeaf(payload)
    if (targetKey && columns.value.length > previousCount) columns.value = moveReportColumn(columns.value, columns.value[columns.value.length - 1]!.key, columns.value.findIndex(column => column.key === targetKey))
  }
}
function startColumnDrag(event: DragEvent, key: string) {
  event.dataTransfer?.setData('application/x-flowerp-report-column', key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onGroupDrop(event: DragEvent) {
  event.preventDefault()
  const payload = readReportFieldDrop(event.dataTransfer?.getData('application/json') ?? '')
  if (!payload || !findLeafDataType(payload) || groupBy.value.length >= 4) return
  const source = { side: payload.side, forwardHops: payload.forwardHops, field: payload.field }
  if (!groupBy.value.some(level => level.side === source.side && level.field === source.field && level.forwardHops.join('.') === source.forwardHops.join('.'))) groupBy.value.push(source)
}
function moveSelectedColumn(offset: number) {
  if (!selectedKey.value) return
  columns.value = moveReportColumn(columns.value, selectedKey.value, columns.value.findIndex(column => column.key === selectedKey.value) + offset)
}

function onSelectDetailBranch(branch: FieldTreeBranch) {
  if (detail.value && (detail.value.fieldName !== branch.fieldName || detail.value.entitySlug !== branch.entitySlug)) {
    toast.error('Este reporte ya tiene una tabla relacionada', `Ya se está usando "${detailEntityName.value}" - un reporte imprimible solo admite una.`)
    return
  }
  if (!detail.value) {
    detail.value = { entitySlug: branch.entitySlug, fieldName: branch.fieldName, includeDeleted: false }
  }
}

function removeColumn(key: string) {
  // groupBy referencia una ColumnSource (side/forwardHops/field), no la key
  // de una columna - borrar una columna de la lista de arriba no afecta los
  // niveles de agrupamiento ya configurados.
  columns.value = columns.value.filter((c) => c.key !== key)
  delete columnDataTypes.value[key]
  if (selectedKey.value === key) selectedKey.value = null
}

function columnKindOptions(col: PrintReportColumn): { value: PrintReportColumn['kind']; label: string; description: string; disabled: boolean }[] {
  const numeric = isNumericFieldType(columnDataTypes.value[col.key] ?? '')
  return [
    { value: 'detalle', label: 'Sin agregación', description: 'Columna de detalle, se repite en cada fila', disabled: false },
    { value: 'sumar', label: 'Sumar', description: 'Genera subtotal por grupo y total general', disabled: !numeric },
    { value: 'repartir', label: 'Repartir por condición', description: 'Divide la columna en varias según otro campo', disabled: !numeric }
  ]
}

function setColumnKind(col: PrintReportColumn, kind: PrintReportColumn['kind']) {
  const idx = columns.value.findIndex((c) => c.key === col.key)
  if (idx === -1) return
  if (kind === 'detalle') {
    columns.value[idx] = { kind: 'detalle', key: col.key, label: col.label, source: col.source }
  } else if (kind === 'sumar') {
    columns.value[idx] = { kind: 'sumar', key: col.key, label: col.label, source: col.source, ...(col.kind === 'sumar' && col.signRule ? { signRule: col.signRule } : {}) }
  } else {
    columns.value[idx] = {
      kind: 'repartir',
      key: col.key,
      label: col.label,
      source: col.source,
      conditionSource: col.kind === 'repartir' ? col.conditionSource : { side: col.source.side, forwardHops: [], field: '' }
    }
  }
}

function conditionCandidates(side: 'base' | 'detail'): FlatLeaf[] {
  return (side === 'base' ? baseLeaves.value : detailLeaves.value).filter((l) => isPivotableFieldType(l.dataType))
}

function setConditionField(col: Extract<PrintReportColumn, { kind: 'repartir' }>, leaf: FlatLeaf) {
  const idx = columns.value.findIndex((c) => c.key === col.key)
  if (idx === -1) return
  columns.value[idx] = { ...col, conditionSource: { side: col.source.side, forwardHops: leaf.forwardHops, field: leaf.field } }
}

function conditionLeafKey(source: { forwardHops: string[]; field: string }): string {
  return [...source.forwardHops, source.field].join('.')
}

function signCandidates(col: Extract<PrintReportColumn, { kind: 'sumar' }>): FlatLeaf[] {
  return conditionCandidates(col.source.side).filter(leaf =>
    leaf.forwardHops.length === col.source.forwardHops.length
    && leaf.forwardHops.every((hop, index) => hop === col.source.forwardHops[index])
    && (leaf.options?.length ?? 0) > 0
  )
}

function signRuleLeaf(col: Extract<PrintReportColumn, { kind: 'sumar' }>): FlatLeaf | undefined {
  if (!col.signRule) return undefined
  return signCandidates(col).find(leaf => conditionLeafKey(leaf) === conditionLeafKey(col.signRule!.source))
}

function factorsForLeaf(leaf: FlatLeaf, previous: Record<string, -1 | 0 | 1> = {}): Record<string, -1 | 0 | 1> {
  return Object.fromEntries((leaf.options ?? []).map(option => [option.value, previous[option.value] ?? 1]))
}

function setSignRuleEnabled(col: Extract<PrintReportColumn, { kind: 'sumar' }>, enabled: boolean) {
  const idx = columns.value.findIndex(column => column.key === col.key)
  if (idx === -1) return
  if (!enabled) {
    const { signRule: _signRule, ...withoutSignRule } = col
    columns.value[idx] = withoutSignRule
    return
  }
  const leaf = signCandidates(col)[0]
  if (!leaf) return
  columns.value[idx] = {
    ...col,
    signRule: {
      source: { side: col.source.side, forwardHops: leaf.forwardHops, field: leaf.field },
      factors: factorsForLeaf(leaf)
    }
  }
}

function setSignField(col: Extract<PrintReportColumn, { kind: 'sumar' }>, leaf: FlatLeaf) {
  const idx = columns.value.findIndex(column => column.key === col.key)
  if (idx === -1) return
  columns.value[idx] = {
    ...col,
    signRule: {
      source: { side: col.source.side, forwardHops: leaf.forwardHops, field: leaf.field },
      factors: factorsForLeaf(leaf)
    }
  }
}

function setSignFactor(col: Extract<PrintReportColumn, { kind: 'sumar' }>, rawValue: string, factor: -1 | 0 | 1) {
  const idx = columns.value.findIndex(column => column.key === col.key)
  if (idx === -1 || !col.signRule) return
  columns.value[idx] = { ...col, signRule: { ...col.signRule, factors: { ...col.signRule.factors, [rawValue]: factor } } }
}

function updateLabel(col: PrintReportColumn, label: string) {
  const idx = columns.value.findIndex((c) => c.key === col.key)
  if (idx === -1) return
  columns.value[idx] = { ...columns.value[idx], label }
}

function addGroupLevel() {
  if (groupBy.value.length >= 4) return
  const first = baseLeaves.value[0]
  if (!first) return
  groupBy.value.push({ side: 'base', forwardHops: first.forwardHops, field: first.field })
}
function removeGroupLevel(index: number) {
  groupBy.value.splice(index, 1)
}
function updateGroupLevel(index: number, value: string) {
  const [side, path] = value.split('|')
  const parts = path?.split('.') ?? []
  if (!side || !parts.length) return
  groupBy.value[index] = { side: side as 'base' | 'detail', forwardHops: parts.slice(0, -1), field: parts[parts.length - 1]! }
}
interface SidedLeaf extends FlatLeaf {
  side: 'base' | 'detail'
}
function groupLevelLeaves(): SidedLeaf[] {
  return [...baseLeaves.value.map((l) => ({ ...l, side: 'base' as const })), ...detailLeaves.value.map((l) => ({ ...l, side: 'detail' as const }))]
}
function groupLevelOptionValue(leaf: SidedLeaf): string {
  return `${leaf.side}|${[...leaf.forwardHops, leaf.field].join('.')}`
}
function groupLevelSelectedValue(level: ColumnSource): string {
  return `${level.side}|${[...level.forwardHops, level.field].join('.')}`
}
function groupLevelLabel(source: ColumnSource): string {
  const path = source.side === 'base' ? [] : [detailEntityName.value || 'Tabla relacionada']
  let nodes: FieldTreeNode[] = treeData.value?.fields ?? []
  if (source.side === 'detail') {
    const branch = detailCandidates.value.find(candidate =>
      candidate.fieldName === detail.value?.fieldName && candidate.entitySlug === detail.value?.entitySlug)
    nodes = branch?.children ?? []
  }
  for (const hop of source.forwardHops) {
    const branch = nodes.find((node): node is FieldTreeBranch =>
      node.type === 'branch' && node.kind === 'forward' && node.fieldName === hop)
    if (!branch) return [...path, resolveSourceLabel(treeData.value?.fields ?? [], detail.value ?? undefined, source)].join(' › ')
    path.push(branch.entityName)
    nodes = branch.children
  }
  const leaf = nodes.find(node => node.type === 'leaf' && node.fieldName === source.field)
  path.push(leaf?.type === 'leaf' ? leaf.label : source.field)
  return path.join(' › ')
}

function buildDsl(): PrintReportDsl {
  return {
    title: title.value.trim(),
    mode: mode.value,
    filters: filters.value,
    parameters: parameters.value,
    orderBy: orderBy.value,
    baseEntity: props.entitySlug,
    includeDeletedBase: includeDeletedBase.value,
    detail: detail.value ?? undefined,
    groupBy: groupBy.value,
    columns: columns.value,
    layout: layout.value
  }
}

async function onSave() {
  saveError.value = null
  if (!validateDataOptions()) return
  if (!title.value.trim()) {
    saveError.value = 'Ponele un nombre al reporte antes de guardar.'
    return
  }
  if (columns.value.length === 0) {
    saveError.value = 'Agregá al menos una columna desde "Campos disponibles".'
    return
  }
  saving.value = true
  try {
    const dsl = buildDsl()
    if (props.reportId) {
      await $fetch(`/api/print-reports/${props.reportId}`, { method: 'PUT', body: { title: dsl.title, dsl } })
      toast.success('Reporte actualizado', `Se guardaron los cambios de "${dsl.title}".`)
    } else {
      await $fetch('/api/print-reports', { method: 'POST', body: { title: dsl.title, dsl } })
      toast.success('Reporte guardado', `"${dsl.title}" ya está disponible en Reportes guardados.`)
    }
    // Ya quedó persistido - un borrador viejo de este mismo reporte no debe
    // resucitar la próxima vez que se abra (ver usePrintReportPreviewDraft()).
    previewDraft.value = null
    await router.push(`/registros/${props.entitySlug}`)
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo guardar el reporte'
    toast.error('No se pudo guardar el reporte', saveError.value!)
  } finally {
    saving.value = false
  }
}

function onDiscard() {
  // Descarte explícito - a diferencia de "Cerrar" en Vista previa, acá sí
  // hay que tirar cualquier borrador en curso de este reporte.
  previewDraft.value = null
  router.push(`/registros/${props.entitySlug}`)
}

async function onPreview() {
  saveError.value = null
  if (!validateDataOptions()) return
  // Mismo chequeo que onSave(): el DSL exige `title` no vacío (printReportDslSchema,
  // server/utils/printReport.ts) - sin esto, POST /api/print-reports/preview
  // devuelve un 400 con el JSON crudo del error de Zod en vez de un mensaje
  // entendible (bug real encontrado en un uso posterior a la entrega inicial).
  if (!title.value.trim()) {
    saveError.value = 'Ponele un nombre al reporte antes de ver la vista previa.'
    return
  }
  if (columns.value.length === 0) {
    saveError.value = 'Agregá al menos una columna antes de ver la vista previa.'
    return
  }
  previewDraft.value = { reportId: props.reportId, dsl: buildDsl() }
  await router.push(`/registros/${props.entitySlug}/reportes/vista-previa`)
}

const initialReportSnapshot = JSON.stringify(buildDsl())
const hasUnsavedChanges = computed(() => JSON.stringify(buildDsl()) !== initialReportSnapshot)
const sumColumns = computed(() => columns.value.filter((c) => c.kind === 'sumar' || c.kind === 'repartir'))
function validateDataOptions() {
  if (parameters.value.some(parameter => !parameter.label.trim())) {
    saveError.value = 'Escribe una etiqueta para cada filtro.'
    return false
  }
  if (mode.value === 'summary' && !sumColumns.value.length) {
    saveError.value = 'Para crear un resumen, configura al menos una columna como Sumar.'
    return false
  }
  return true
}
async function refreshInlinePreview(answers?: ParameterAnswers) {
  saveError.value = null
  if (!validateDataOptions() || !title.value.trim() || !columns.value.length) {
    saveError.value ||= 'Escribe un nombre y agrega columnas para probar el reporte.'
    return
  }
  if (parameters.value.length && !answers) { parameterModal.value = true; return }
  parameterModal.value = false
  const revision = ++previewRevision
  inlineLoading.value = true
  inlineError.value = ''
  inlineResult.value = null
  previewVisible.value = true
  try {
    const result = await $fetch<PrintReportResult>('/api/print-reports/preview', { method: 'POST', body: { dsl: buildDsl(), answers } })
    if (revision === previewRevision) { inlineResult.value = result; inlineDate.value = new Date() }
  } catch (error: any) {
    if (revision === previewRevision) inlineError.value = error?.data?.statusMessage || 'No se pudieron cargar los datos.'
  } finally { if (revision === previewRevision) inlineLoading.value = false }
}
watch([columns, groupBy, filters, parameters, orderBy, mode, detail, title], () => {
  previewRevision++
  inlineResult.value = null
  inlineLoading.value = false
}, { deep: true })
function clearDetail() {
  columns.value = columns.value.filter(col => col.source.side === 'base' && (col.kind !== 'repartir' || col.conditionSource.side === 'base'))
  groupBy.value = groupBy.value.filter(source => source.side === 'base')
  filters.value = filters.value.filter(filter => filter.source.side === 'base')
  parameters.value = parameters.value.filter(parameter => parameter.source.side === 'base')
  orderBy.value = orderBy.value.filter(order => order.source.side === 'base')
  detail.value = null
  detailConfigOpen.value = false
  selectedKey.value = null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-brand-bg">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-border-light bg-brand-surface px-4 py-3 lg:px-8">
      <div class="flex min-w-0 items-center gap-3">
        <NuxtLink :to="`/registros/${entitySlug}`" class="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-text-secondary hover:text-brand-blue">
          <ArrowLeft class="h-4 w-4" :stroke-width="1.75" /> Volver a {{ baseEntityName }}
        </NuxtLink>
        <span class="h-6 w-px shrink-0 bg-brand-border-light" />
        <input v-model="title" type="text" aria-label="Nombre del reporte" placeholder="Nombre del reporte" class="min-w-0 w-72 max-w-[35vw] bg-transparent text-base font-bold text-brand-text outline-none placeholder:text-brand-sites-muted focus-visible:rounded focus-visible:ring-2 focus-visible:ring-brand-blue/25" />
        <span class="hidden max-w-48 truncate rounded-full bg-brand-neutral-bg px-2.5 py-1 text-xs font-semibold text-brand-text-secondary md:inline">{{ baseEntityName }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="hasUnsavedChanges" class="hidden items-center gap-1.5 rounded-full bg-brand-warning-bg px-2.5 py-1 text-xs font-semibold text-brand-warning-text sm:inline-flex"><span class="h-1.5 w-1.5 rounded-full bg-brand-warning-text" />Cambios sin guardar</span>
        <span class="mx-1 hidden h-6 w-px bg-brand-border-light sm:block" />
        <button type="button" class="flex items-center gap-1.5 rounded border border-brand-control-border px-3.5 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="onDiscard">Descartar</button>
        <button type="button" class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:opacity-60" :disabled="saving" @click="onSave"><Save class="h-4 w-4" :stroke-width="1.75" />{{ saving ? 'Guardando...' : 'Guardar reporte' }}</button>
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-brand-border-light bg-brand-surface px-4 py-2.5 lg:px-8">
      <label class="flex items-center gap-2 text-xs font-semibold text-brand-sites-muted">Mostrar
        <select v-model="mode" aria-label="Contenido del reporte" class="rounded border border-brand-control-border bg-brand-surface px-2.5 py-1.5 text-xs font-normal text-brand-text"><option value="detail">Detalle y totales</option><option value="summary">Solo grupos y totales</option></select>
      </label>
      <PrintReportLayoutControls v-model="layout" />
      <div class="flex items-center gap-2" role="group" aria-label="Zoom del lienzo">
        <span class="text-xs font-semibold text-brand-sites-muted">Zoom</span>
        <div class="flex h-[36px] items-center rounded-md border border-brand-control-border bg-brand-surface focus-within:ring-2 focus-within:ring-brand-blue/25">
          <button type="button" class="flex h-full w-[34px] shrink-0 items-center justify-center rounded-l-[5px] text-brand-text-secondary hover:bg-brand-bg focus-visible:outline-none disabled:opacity-40" aria-label="Alejar lienzo" :disabled="currentZoom <= 50" @click="changeZoom(-25)"><ZoomOut class="h-4 w-4" :stroke-width="1.75" /></button>
          <span class="h-5 w-px shrink-0 bg-brand-border-light" />
          <ReportOptionSelect label="Zoom" label-hidden :model-value="String(currentZoom)" :options="[50, 75, 100, 125, 150].map(value => ({ value: String(value), label: `${value} %` }))" joined @update:model-value="setZoom(Number($event))" />
          <span class="h-5 w-px shrink-0 bg-brand-border-light" />
          <button type="button" class="flex h-full w-[34px] shrink-0 items-center justify-center rounded-r-[5px] text-brand-text-secondary hover:bg-brand-bg focus-visible:outline-none disabled:opacity-40" aria-label="Acercar lienzo" :disabled="currentZoom >= 150" @click="changeZoom(25)"><ZoomIn class="h-4 w-4" :stroke-width="1.75" /></button>
        </div>
      </div>
      <div class="flex-1" />
      <button type="button" class="rounded border border-brand-control-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-bg" :aria-pressed="!previewVisible" @click="previewVisible = false">Diseñar estructura</button>
      <button type="button" class="rounded border border-brand-control-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-bg disabled:opacity-50" :disabled="inlineLoading" @click="refreshInlinePreview()">{{ inlineLoading ? 'Consultando…' : 'Probar con datos' }}</button>
      <button type="button" class="flex items-center gap-1.5 rounded border border-brand-control-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-bg" @click="onPreview"><Eye class="h-3.5 w-3.5" :stroke-width="1.75" /> Vista previa</button>
    </div>
    <p v-if="saveError" role="alert" class="text-sm text-brand-error-text">{{ saveError }}</p>
    <p v-if="legacyConverted" class="text-sm text-brand-text-secondary">Los filtros anteriores ahora se preguntarán al generar. Guarda para actualizar esta plantilla.</p>
    <PrintReportParameterModal v-if="parameterModal" :dsl="buildDsl()" @cancel="parameterModal = false" @generate="refreshInlinePreview" />

    <div class="min-h-0 flex-1 overflow-x-auto">
      <div class="grid h-full min-w-[1100px] grid-cols-[280px_minmax(0,1fr)_380px]">
      <!-- Panel Campos -->
      <aside class="flex h-full min-h-0 flex-col border-r border-brand-border-light bg-brand-surface">
        <div class="shrink-0 border-b border-brand-border-light p-4">
          <h2 class="text-sm font-bold text-brand-text">Campos disponibles</h2>
          <p class="mt-1 text-xs leading-5 text-brand-sites-muted">Cada fila representa un registro de {{ baseEntityName }}.</p>
          <div class="mt-3 flex items-center gap-2 rounded border border-brand-control-border bg-brand-bg px-2.5 py-1.5">
            <Search class="h-3.5 w-3.5 shrink-0 text-brand-sites-muted" :stroke-width="1.75" />
            <input ref="fieldSearchInput" v-model="fieldSearch" type="search" aria-label="Buscar campos" placeholder="Buscar un campo…" class="min-w-0 w-full bg-transparent text-xs text-brand-text outline-none placeholder:text-brand-sites-muted" />
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <!-- Fila fija con el nombre de la entidad base (fiel a "branch Manifiestos"
          del mock: un renglón no-clicable arriba del árbol, para ubicar de qué
          módulo salen los campos de abajo). -->
          <div class="mb-1 flex items-center gap-1.5 rounded bg-brand-bg px-2 py-1.5">
            <Table2 class="h-3.5 w-3.5 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="truncate text-xs font-bold text-brand-text">{{ baseEntityName }}</span>
          </div>
          <p v-if="treePending" class="p-2 text-xs text-brand-sites-muted">Cargando campos...</p>
          <p v-else-if="treeError" class="p-2 text-xs text-brand-error-text">No se pudieron cargar los campos de esta entidad.</p>
          <PrintReportFieldTree
            v-else
            :nodes="treeData?.fields ?? []"
            :search="fieldSearch"
            :chosen-detail-field="detail ? `${detail.entitySlug}|${detail.fieldName}` : null"
            @select-leaf="onSelectLeaf"
            @select-detail-branch="onSelectDetailBranch"
          />
        </div>
      </aside>

      <section class="relative min-h-0 min-w-0 overflow-y-auto bg-brand-bg p-5 xl:p-8" aria-label="Lienzo del reporte">
        <div v-if="previewVisible" class="overflow-auto rounded-lg bg-brand-bg p-3" aria-label="Resultado dentro del editor">
          <p v-if="inlineLoading" role="status" class="p-6 text-sm">Preparando el reporte…</p>
          <p v-else-if="inlineError" role="alert" class="p-6 text-sm text-brand-error-text">{{ inlineError }}</p>
          <p v-else-if="!inlineResult" class="p-6 text-sm">El diseño cambió. Pulsa «Probar con datos» para actualizar el resultado.</p>
          <div v-else :style="{ zoom: resultZoom / 100 }"><PrintReportSheet :result="inlineResult" :generated-at="inlineDate" :layout="layout" :group-field-labels="groupBy.map(source => resolveSourceLabel(treeData?.fields ?? [], detail ?? undefined, source))" /></div>
        </div>
        <div v-else class="relative mx-auto flex min-h-full w-full max-w-[900px] items-start justify-center pb-20" aria-label="Lienzo del reporte" @dragover.prevent @drop="onCanvasDrop($event)">
          <div class="theme-light report-design-paper flex w-full flex-col gap-4 rounded-sm border border-brand-border-light bg-brand-surface p-8 shadow-[0_4px_20px_rgb(var(--brand-shadow)/0.2)]" :style="{ aspectRatio: `${paperSize.width} / ${paperSize.height}`, zoom: structureZoom / 100 }">
            <div class="flex items-center gap-3 border-b border-brand-border-light pb-4">
              <img v-if="reportBranding?.hasLogo" :src="'/api/tenant/logo'" alt="" class="h-9 w-12 object-contain" />
              <p class="text-lg font-bold text-brand-text">{{ reportBranding?.name || 'Organización' }}</p>
            </div>
            <div class="space-y-1">
              <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Reporte operativo</p>
              <h3 class="break-words text-[22px] font-bold text-brand-text">{{ title || 'Reporte sin nombre' }}</h3>
              <p class="text-xs text-brand-text-muted">{{ layout.paper === 'letter' ? 'Carta' : 'A4' }} · {{ layout.orientation === 'portrait' ? 'Vertical' : 'Horizontal' }} · Márgenes de 12 mm</p>
            </div>
            <div class="rounded border border-brand-border-light bg-brand-bg px-3.5 py-2.5" aria-label="Zona de agrupación" @dragover.prevent @drop.stop="onGroupDrop">
              <p class="text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Agrupaciones</p>
              <p class="mt-1 text-[13px] font-semibold text-brand-text">{{ groupBy.length ? groupBy.map(groupLevelLabel).join(' · ') : 'Arrastra aquí un campo para agrupar' }}</p>
            </div>
            <div class="space-y-2">
              <p class="text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">{{ detail ? 'TABLA RELACIONADA · ' + detailEntityName : 'COLUMNAS DEL REPORTE' }}</p>
              <div class="overflow-x-auto border border-brand-border-light">
                <p v-if="!columns.length" class="p-6 text-center text-xs text-brand-text-muted">Selecciona un campo de la izquierda para agregar la primera columna.</p>
                <div v-else class="flex min-w-max border-b border-brand-border-light bg-brand-bg">
                  <button v-for="col in columns" :key="col.key" type="button" draggable="true" :aria-label="`Columna ${col.label}`" class="flex min-w-28 flex-1 items-center justify-between gap-2 px-3.5 py-3 text-left text-[11px] font-bold text-brand-text-secondary hover:bg-brand-blue-bg" :class="selectedKey === col.key ? 'bg-brand-blue-bg text-brand-blue' : ''" @click="selectedKey = col.key" @dragstart="startColumnDrag($event, col.key)" @dragover.prevent @drop.stop="onCanvasDrop($event, col.key)">
                    <span class="truncate">{{ col.label }}</span>
                    <Calculator v-if="col.kind !== 'detalle'" class="h-3 w-3 shrink-0" :stroke-width="1.75" />
                  </button>
                </div>
                <div v-if="columns.length" class="flex min-w-max border-b border-brand-border-light bg-brand-surface">
                  <span v-for="col in columns" :key="col.key" class="min-w-28 flex-1 px-3.5 py-4 text-xs text-brand-text-muted">—</span>
                </div>
                <div v-if="columns.length && sumColumns.length" class="flex justify-end gap-5 bg-brand-bg px-5 py-3 text-xs font-bold text-brand-text"><span v-for="col in sumColumns" :key="col.key">{{ col.label }}: —</span></div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <aside class="flex h-full min-h-0 flex-col border-l border-brand-border-light bg-brand-surface">
        <div class="flex shrink-0 items-center gap-2 border-b border-brand-border-light px-4 py-3.5">
          <Settings2 class="h-4 w-4 text-brand-text-secondary" :stroke-width="1.75" />
          <h2 class="text-sm font-bold text-brand-text">Propiedades del reporte</h2>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <PrintReportDataControls v-model:filters="parameters" v-model:order-by="orderBy" :leaves="availableLeaves" :tree="treeData?.fields ?? []" :base-name="baseEntityName" :detail-name="detailEntityName" :detail-field-name="detail?.fieldName" :active-section="activeSettingsSection" @update:active-section="activeSettingsSection = $event" />
          <section class="border-b border-brand-border-light">
            <button type="button" class="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-brand-bg" :aria-expanded="activeSettingsSection === 'columns'" @click="activeSettingsSection = activeSettingsSection === 'columns' ? null : 'columns'">
              <Table2 class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
              <span class="min-w-0 flex-1 text-[13px] font-bold text-brand-text">Columnas</span>
              <span class="text-xs font-semibold text-brand-blue">{{ columns.length }} columnas</span>
              <ChevronDown class="h-4 w-4 shrink-0 text-brand-sites-muted transition-transform" :class="activeSettingsSection === 'columns' ? '' : '-rotate-90'" :stroke-width="1.75" />
            </button>
            <div v-if="activeSettingsSection === 'columns'" class="flex flex-col gap-2 px-4 pb-4">
              <p class="text-xs leading-5 text-brand-sites-muted">Arrastra para reordenar. Así se verán en el reporte.</p>
              <div role="listbox" aria-label="Columnas del reporte" class="flex flex-col gap-1.5">
                <div v-for="col in columns" :key="col.key" role="option" tabindex="0" draggable="true" :aria-selected="selectedKey === col.key" class="flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 text-xs text-brand-text outline-none hover:border-brand-blue/40 hover:bg-brand-blue-bg focus-visible:ring-2 focus-visible:ring-brand-blue/25" :class="selectedKey === col.key ? 'border-brand-blue bg-brand-blue-bg' : 'border-transparent bg-brand-bg'" @click="selectedKey = col.key" @keydown.enter="selectedKey = col.key" @dragstart="startColumnDrag($event, col.key)" @dragover.prevent @drop.stop="onCanvasDrop($event, col.key)">
                  <GripVertical class="h-3.5 w-3.5 shrink-0 text-brand-sites-muted" :stroke-width="1.75" />
                  <span class="min-w-0 flex-1 truncate">{{ col.label }}</span>
                  <span v-if="col.kind === 'sumar'" class="rounded bg-brand-blue-bg px-1.5 py-0.5 text-[10px] font-semibold text-brand-blue">Suma</span>
                  <button type="button" :aria-label="`Quitar ${col.label}`" class="text-brand-sites-muted hover:text-brand-error-text" @click.stop="removeColumn(col.key)"><X class="h-3.5 w-3.5" :stroke-width="1.75" /></button>
                </div>
              </div>
              <button type="button" class="flex items-center gap-1.5 self-start py-1 text-xs font-semibold text-brand-blue hover:underline" @click="fieldSearch = ''; fieldSearchInput?.focus()"><Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Agregar columna</button>
        <div class="flex flex-col gap-4 border-t border-brand-border-light pt-4">
          <p v-if="!selectedColumn" class="text-xs text-brand-sites-muted">Selecciona una columna para configurar su encabezado y agregación.</p>

          <template v-else>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="rounded border border-brand-control-border px-2 py-1 text-xs disabled:opacity-40" :disabled="columns[0]?.key === selectedKey" @click="moveSelectedColumn(-1)">Mover a la izquierda</button>
              <button type="button" class="rounded border border-brand-control-border px-2 py-1 text-xs disabled:opacity-40" :disabled="columns[columns.length - 1]?.key === selectedKey" @click="moveSelectedColumn(1)">Mover a la derecha</button>
            </div>
            <p class="text-xs font-semibold uppercase tracking-wide text-brand-sites-muted">Columna</p>

            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-brand-text-secondary">Encabezado</label>
              <input
                :value="selectedColumn.label"
                type="text"
                class="rounded border border-brand-control-border px-2.5 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                @input="updateLabel(selectedColumn, ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="flex flex-col gap-1.5 border-t border-brand-border-light pt-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-brand-sites-muted">Agregación</p>
              <label
                v-for="opt in columnKindOptions(selectedColumn)"
                :key="opt.value"
                class="flex items-start gap-2 rounded p-1.5"
                :class="opt.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-brand-bg'"
              >
                <input type="radio" class="mt-0.5" :checked="selectedColumn.kind === opt.value" :disabled="opt.disabled" @change="setColumnKind(selectedColumn, opt.value)" />
                <span class="flex flex-col">
                  <span class="text-sm font-semibold text-brand-text">{{ opt.label }}</span>
                  <span class="text-xs text-brand-sites-muted">{{ opt.description }}</span>
                </span>
              </label>
              <p v-if="!isNumericFieldType(columnDataTypes[selectedColumn.key] ?? '')" class="flex items-center gap-1.5 text-xs text-brand-sites-muted">
                <AlertTriangle class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
                Solo los campos numéricos se pueden sumar o repartir.
              </p>
            </div>

            <div v-if="selectedColumn.kind === 'sumar'" class="flex flex-col gap-3 rounded border border-brand-border-light bg-brand-bg p-3">
              <label class="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  class="mt-0.5 h-4 w-4"
                  :checked="!!selectedColumn.signRule"
                  :disabled="!signCandidates(selectedColumn).length"
                  @change="setSignRuleEnabled(selectedColumn, ($event.target as HTMLInputElement).checked)"
                />
                <span>
                  <span class="block text-xs font-bold text-brand-text">Sumar o restar según otro campo</span>
                  <span class="mt-0.5 block text-xs leading-5 text-brand-sites-muted">La cantidad se captura positiva. El valor elegido define si entra, sale o no afecta el total.</span>
                </span>
              </label>

              <template v-if="selectedColumn.signRule">
                <label class="text-xs font-semibold text-brand-text-secondary">Campo que define el movimiento</label>
                <select
                  class="rounded border border-brand-control-border bg-brand-surface px-2.5 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  :value="conditionLeafKey(selectedColumn.signRule.source)"
                  @change="setSignField(selectedColumn, signCandidates(selectedColumn).find(leaf => conditionLeafKey(leaf) === ($event.target as HTMLSelectElement).value)!)"
                >
                  <option v-for="leaf in signCandidates(selectedColumn)" :key="conditionLeafKey(leaf)" :value="conditionLeafKey(leaf)">{{ leaf.label }}</option>
                </select>

                <div class="flex flex-col divide-y divide-brand-border-light rounded border border-brand-border-light bg-brand-surface px-2.5">
                  <label v-for="option in signRuleLeaf(selectedColumn)?.options ?? []" :key="option.value" class="flex items-center gap-3 py-2">
                    <span class="min-w-0 flex-1 truncate text-xs font-semibold text-brand-text">{{ option.label }}</span>
                    <select
                      class="w-28 rounded border border-brand-control-border bg-brand-surface px-2 py-1.5 text-xs text-brand-text"
                      :value="selectedColumn.signRule.factors[option.value] ?? 0"
                      @change="setSignFactor(selectedColumn, option.value, Number(($event.target as HTMLSelectElement).value) as -1 | 0 | 1)"
                    >
                      <option :value="1">Sumar (+)</option>
                      <option :value="-1">Restar (−)</option>
                      <option :value="0">Ignorar</option>
                    </select>
                  </label>
                </div>
              </template>

              <p v-else-if="!signCandidates(selectedColumn).length" class="flex items-center gap-1.5 text-xs text-brand-sites-muted">
                <FileWarning class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
                Agrega un campo de selección o Sí/No en el mismo registro para definir el signo.
              </p>
            </div>

            <div v-if="selectedColumn.kind === 'repartir'" class="flex flex-col gap-2 rounded border border-brand-border-light bg-brand-bg p-3">
              <p class="text-xs font-bold text-brand-text">Repartir «{{ selectedColumn.label }}» por condición</p>
              <label class="text-xs font-semibold text-brand-text-secondary">Campo condición</label>
              <select
                class="rounded border border-brand-control-border px-2.5 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                :value="conditionLeafKey(selectedColumn.conditionSource)"
                @change="
                  setConditionField(
                    selectedColumn,
                    conditionCandidates(selectedColumn.source.side).find((l) => conditionLeafKey(l) === ($event.target as HTMLSelectElement).value)!
                  )
                "
              >
                <option value="" disabled>Elegí un campo booleano o de selección</option>
                <option v-for="leaf in conditionCandidates(selectedColumn.source.side)" :key="conditionLeafKey(leaf)" :value="conditionLeafKey(leaf)">{{ leaf.label }}</option>
              </select>
              <p v-if="conditionCandidates(selectedColumn.source.side).length === 0" class="flex items-center gap-1.5 text-xs text-brand-sites-muted">
                <FileWarning class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
                Este lado del reporte no tiene campos booleanos ni de selección.
              </p>
            </div>

            <button type="button" class="mt-1 flex items-center gap-1.5 self-start text-xs font-semibold text-brand-error-text hover:underline" @click="removeColumn(selectedColumn.key)">
              <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
              Quitar columna
            </button>
          </template>
        </div>
            </div>
          </section>
          <section class="border-b border-brand-border-light">
            <button type="button" class="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-brand-bg" :aria-expanded="activeSettingsSection === 'calculations'" @click="activeSettingsSection = activeSettingsSection === 'calculations' ? null : 'calculations'">
              <Calculator class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
              <span class="min-w-0 flex-1 text-[13px] font-bold text-brand-text">Cálculos y totales</span>
              <span class="text-xs font-semibold text-brand-blue">{{ groupBy.length ? 'Agrupado' : 'Sin agrupar' }}</span>
              <ChevronDown class="h-4 w-4 shrink-0 text-brand-sites-muted transition-transform" :class="activeSettingsSection === 'calculations' ? '' : '-rotate-90'" :stroke-width="1.75" />
            </button>
            <div v-if="activeSettingsSection === 'calculations'" class="flex flex-col gap-4 px-4 pb-4">
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between"><p class="text-[11px] font-bold uppercase tracking-wide text-brand-sites-muted">Agrupar filas por</p><button type="button" class="text-xs font-semibold text-brand-blue hover:underline disabled:opacity-40" :disabled="groupBy.length >= 4 || !groupLevelLeaves().length" @click="addGroupLevel">+ Agregar</button></div>
                <div v-for="(level, index) in groupBy" :key="index" class="flex items-center gap-2">
                  <ReportOptionSelect
                    class="min-w-0 flex-1"
                    :label="`Agrupar nivel ${index + 1}`"
                    label-hidden
                    fill
                    menu-portal
                    searchable
                    :model-value="groupLevelSelectedValue(level)"
                    :options="groupLevelLeaves().map(leaf => ({ value: groupLevelOptionValue(leaf), label: groupLevelLabel(leaf) }))"
                    @update:model-value="updateGroupLevel(index, $event)"
                  />
                  <button type="button" :aria-label="`Quitar agrupación ${index + 1}`" class="text-brand-sites-muted hover:text-brand-error-text" @click="removeGroupLevel(index)"><Trash2 class="h-4 w-4" :stroke-width="1.75" /></button>
                </div>
                <p v-if="!groupBy.length" class="text-xs text-brand-sites-muted">Sin agrupaciones.</p>
              </div>
              <div class="border-t border-brand-border-light pt-3"><p class="text-[11px] font-bold uppercase tracking-wide text-brand-sites-muted">Totales (sumar)</p><p class="mt-1.5 text-xs text-brand-text">{{ sumColumns.length ? sumColumns.map(col => col.label).join(' · ') : 'Sin columnas para sumar' }}</p></div>
              <button v-if="detail" type="button" class="flex items-center gap-1.5 self-start text-xs font-semibold text-brand-blue hover:underline" @click="detailConfigOpen = true"><Settings2 class="h-3.5 w-3.5" :stroke-width="1.75" /> Configurar tabla relacionada</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
    </div>

    <!-- Modal "Configurar tabla relacionada" (ERD-88 #292 - agrupamiento + papelera) -->
    <div v-if="detailConfigOpen && detail" class="fixed inset-0 z-30 flex items-center justify-center bg-brand-modal-overlay/30 p-4" @click.self="detailConfigOpen = false">
      <div class="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg bg-brand-surface p-5 shadow-xl">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-bold text-brand-text">Config de tabla relacionada</h3>
          <button type="button" class="text-brand-sites-muted hover:text-brand-text" @click="detailConfigOpen = false">
            <X class="h-4 w-4" :stroke-width="1.75" />
          </button>
        </div>

        <p class="text-sm text-brand-text-secondary">Cada fila representa un registro de {{ detailEntityName }}. Los campos del módulo principal acompañan sus detalles.</p>
        <button type="button" class="self-start text-sm text-brand-error-text underline" @click="clearDetail">Quitar tabla de detalle y sus campos del reporte</button>

        <div class="flex flex-col gap-2 border-b border-brand-border-light pb-4">
          <p class="text-xs font-bold uppercase tracking-wide text-brand-sites-muted">Datos</p>
          <label class="flex items-center justify-between gap-3 text-sm text-brand-text">
            Incluir registros eliminados de "{{ detailEntityName }}"
            <input v-model="detail.includeDeleted" type="checkbox" class="h-4 w-4" />
          </label>
          <label class="flex items-center justify-between gap-3 text-sm text-brand-text">
            Incluir registros eliminados de "{{ baseEntityName }}"
            <input v-model="includeDeletedBase" type="checkbox" class="h-4 w-4" />
          </label>
          <p class="flex items-center gap-1.5 text-xs text-brand-sites-muted">
            <Ban class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
            Un registro eliminado se muestra atenuado ("· Eliminado") en la vista previa, no se descarta.
          </p>
        </div>


      </div>
    </div>
  </div>
</template>

<style scoped>
input, select { color-scheme: inherit; }
button:focus-visible, a:focus-visible { outline: 2px solid rgb(var(--brand-blue)); outline-offset: 2px; }
</style>

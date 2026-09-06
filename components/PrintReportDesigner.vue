<script setup lang="ts">
// ERD-88 (Diseñador de reportes imprimibles), Screen/Diseñador de reporte
// imprimible (3 columnas) - revisado con las herramientas de Pencil antes de
// construir (regla pencil-antes-de-frontend). Reusado por
// pages/registros/[entity]/reportes/nuevo.vue (sin reportId) y
// pages/registros/[entity]/reportes/[id]/editar.vue (con reportId, reabre una
// plantilla guardada) - mismo criterio de componente compartido que
// components/ModuleWizard.vue para Crear/Editar Módulo.
//
// Decisión de alcance (documentada, no es un olvido): el mock arrastra
// campos del árbol al lienzo con drag-and-drop real y dibuja el lienzo como
// una hoja impresa completa (logo, encabezado con datos fiscales del
// tenant, parámetros de fecha/estado como placeholders `{...}`). Sin una
// librería de drag-and-drop en el proyecto, acá un CLIC en una hoja del
// árbol agrega la columna directamente (mismo criterio pragmático que el
// constructor de condiciones de Automatización, ERD-51, y el Table Builder,
// ERD-75 - ninguno de los dos usa drag-and-drop real tampoco). El lienzo
// central es una vista previa simplificada de las columnas ya agregadas
// (encabezados de tabla + resumen de subtotales configurados) en vez del
// dibujo pixel-perfecto de la hoja - la impresión real, con datos reales,
// vive en Vista previa impresión (ERD-88 #293).
//
// "PARÁMETROS DEL REPORTE" del mock (filtros de fecha/estado elegidos AL
// imprimir, no al diseñar) queda fuera de esta entrega: agregarlo bien
// requeriría un tipo de columna nuevo en el DSL (parámetro de filtro) +
// UI para completarlo en Vista previa impresión, y no hay evidencia en el
// resto del .pen de cómo se validan/aplican esos valores - se prefiere
// entregar el flujo completo (diseñar -> guardar -> imprimir) sin parámetros
// de filtro antes que una versión a medias de esa pieza. Documentado acá
// para que quede explícito, no perdido.
import { AlertTriangle, ArrowLeft, Ban, Calculator, FileWarning, Save, Settings2, SplitSquareHorizontal, Trash2, X } from '@lucide/vue'
import {
  collectBaseLeaves,
  collectDetailLeaves,
  isNumericFieldType,
  isPivotableFieldType,
  topLevelDetailCandidates,
  usePrintReportFieldTree,
  type ColumnSource,
  type FieldTreeBranch,
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

const title = ref(props.initialTitle ?? '')
const includeDeletedBase = ref(props.initialDsl?.includeDeletedBase ?? false)
const detail = ref(props.initialDsl?.detail ? { ...props.initialDsl.detail } : null as PrintReportDsl['detail'] | null)
const groupBy = ref<ColumnSource[]>(props.initialDsl?.groupBy ? props.initialDsl.groupBy.map((g) => ({ ...g })) : [])
const columns = ref<PrintReportColumn[]>(props.initialDsl?.columns ? JSON.parse(JSON.stringify(props.initialDsl.columns)) : [])
// dataType de cada columna, solo del lado cliente (el DSL que viaja al
// servidor no lo necesita - lo vuelve a resolver server-side - pero el
// Diseñador lo necesita para saber qué columnas pueden sumarse/repartirse y
// qué campos ofrecer como "Campo condición").
const columnDataTypes = ref<Record<string, string>>({})

const selectedKey = ref<string | null>(null)
const selectedColumn = computed(() => columns.value.find((c) => c.key === selectedKey.value) ?? null)

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
const baseLeaves = computed<FlatLeaf[]>(() => collectBaseLeaves(treeData.value?.fields ?? []))
const detailLeaves = computed<FlatLeaf[]>(() => {
  if (!detail.value) return []
  const branch = detailCandidates.value.find((b) => b.fieldName === detail.value!.fieldName)
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
  const key = nextKey(payload.label)
  columns.value.push({ kind: 'detalle', key, label: payload.label, source: { side: payload.side, forwardHops: payload.forwardHops, field: payload.field } })
  columnDataTypes.value[key] = payload.dataType
  selectedKey.value = key
}

function onSelectDetailBranch(branch: FieldTreeBranch) {
  if (detail.value && detail.value.fieldName !== branch.fieldName) {
    toast.error('Este reporte ya tiene una tabla relacionada', `Ya se está usando "${detail.value.entitySlug}" - un reporte imprimible solo admite una.`)
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
    columns.value[idx] = { kind: 'sumar', key: col.key, label: col.label, source: col.source }
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

function buildDsl(): PrintReportDsl {
  return {
    title: title.value.trim(),
    baseEntity: props.entitySlug,
    includeDeletedBase: includeDeletedBase.value,
    detail: detail.value ?? undefined,
    groupBy: groupBy.value,
    columns: columns.value
  }
}

async function onSave() {
  saveError.value = null
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
    await router.push(`/registros/${props.entitySlug}`)
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo guardar el reporte'
    toast.error('No se pudo guardar el reporte', saveError.value!)
  } finally {
    saving.value = false
  }
}

function onDiscard() {
  router.push(`/registros/${props.entitySlug}`)
}

const previewDsl = useState<PrintReportDsl | null>('printReportPreviewDsl', () => null)
async function onPreview() {
  saveError.value = null
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
  previewDsl.value = buildDsl()
  await router.push(`/registros/${props.entitySlug}/reportes/vista-previa`)
}

const sumColumns = computed(() => columns.value.filter((c) => c.kind === 'sumar' || c.kind === 'repartir'))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <span class="text-brand-text-muted">/</span>
      <span class="text-brand-text-secondary">Módulos</span>
      <span class="text-brand-text-muted">/</span>
      <NuxtLink :to="`/registros/${entitySlug}`" class="text-brand-text-secondary hover:underline">{{ entitySlug }}</NuxtLink>
      <span class="text-brand-text-muted">/</span>
      <span class="text-brand-text-secondary">Reportes</span>
      <span class="text-brand-text-muted">/</span>
      <span class="font-bold text-brand-text">Diseñador</span>
    </div>

    <div class="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-brand-border-light bg-brand-surface p-4">
      <div class="flex min-w-[240px] flex-1 flex-col gap-1">
        <label class="text-xs font-semibold text-brand-text-secondary">Nombre del reporte</label>
        <input
          v-model="title"
          type="text"
          placeholder="Ej. Remito de carga"
          class="w-full max-w-md rounded border border-brand-border px-3 py-2 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="flex items-center gap-1.5 rounded border border-brand-border-light px-3.5 py-2 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="onDiscard">
          <ArrowLeft class="h-4 w-4" :stroke-width="1.75" />
          Descartar
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-60"
          :disabled="saving"
          @click="onSave"
        >
          <Save class="h-4 w-4" :stroke-width="1.75" />
          {{ saving ? 'Guardando...' : 'Guardar reporte' }}
        </button>
      </div>
    </div>

    <p v-if="saveError" class="text-sm text-brand-error-text">{{ saveError }}</p>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <!-- Panel Campos -->
      <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface lg:col-span-3">
        <div class="border-b border-brand-border-light p-3.5">
          <h2 class="text-sm font-bold text-brand-text">Campos disponibles</h2>
        </div>
        <div class="max-h-[560px] overflow-y-auto p-2">
          <p v-if="treePending" class="p-2 text-xs text-brand-text-muted">Cargando campos...</p>
          <p v-else-if="treeError" class="p-2 text-xs text-brand-error-text">No se pudieron cargar los campos de esta entidad.</p>
          <PrintReportFieldTree
            v-else
            :nodes="treeData?.fields ?? []"
            :chosen-detail-field="detail?.fieldName ?? null"
            @select-leaf="onSelectLeaf"
            @select-detail-branch="onSelectDetailBranch"
          />
        </div>
      </div>

      <!-- Canvas (vista simplificada de columnas) -->
      <div class="flex flex-col gap-3 rounded-lg border border-brand-border-light bg-brand-surface p-4 lg:col-span-6">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold text-brand-text">{{ title || 'Reporte sin nombre' }}</h2>
          <button
            v-if="detail"
            type="button"
            class="flex items-center gap-1.5 rounded border border-brand-border-light px-2.5 py-1.5 text-xs font-semibold text-brand-text-secondary hover:bg-brand-bg"
            @click="detailConfigOpen = true"
          >
            <Settings2 class="h-3.5 w-3.5" :stroke-width="1.75" />
            Configurar tabla relacionada
          </button>
        </div>

        <p v-if="columns.length === 0" class="rounded border border-dashed border-brand-border-light p-6 text-center text-sm text-brand-text-muted">
          Elegí campos del panel de la izquierda para armar las columnas del reporte.
        </p>

        <div v-else class="overflow-x-auto rounded border border-brand-border-light">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-brand-border-light bg-brand-bg">
                <th v-for="col in columns" :key="col.key" class="px-3 py-2 font-semibold text-brand-text-secondary">
                  <button type="button" class="flex items-center gap-1 hover:text-brand-text" :class="{ 'text-brand-blue': selectedKey === col.key }" @click="selectedKey = col.key">
                    {{ col.label }}
                    <Calculator v-if="col.kind === 'sumar'" class="h-3 w-3" :stroke-width="2" />
                    <SplitSquareHorizontal v-else-if="col.kind === 'repartir'" class="h-3 w-3" :stroke-width="2" />
                  </button>
                </th>
                <th class="w-8"></th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-brand-border-light/60">
                <td v-for="col in columns" :key="col.key" class="px-3 py-2 text-brand-text-muted">
                  {{ col.kind === 'detalle' ? '…' : col.kind === 'sumar' ? 'Σ' : '⇉' }}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="sumColumns.length > 0" class="rounded border border-brand-border-light bg-brand-bg px-3 py-2 text-xs text-brand-text-secondary">
          Subtotal: {{ sumColumns.map((c) => c.label).join(' · ') }}
        </div>

        <button
          type="button"
          class="mt-auto flex items-center justify-center gap-1.5 self-end rounded border border-brand-border-light px-3.5 py-2 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg"
          @click="onPreview"
        >
          Vista previa
        </button>
      </div>

      <!-- Panel Propiedades -->
      <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface lg:col-span-3">
        <div class="border-b border-brand-border-light p-3.5">
          <h2 class="text-sm font-bold text-brand-text">Propiedades</h2>
        </div>
        <div class="flex flex-col gap-4 p-3.5">
          <p v-if="!selectedColumn" class="text-xs text-brand-text-muted">Elegí una columna del reporte para configurarla.</p>

          <template v-else>
            <p class="text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Columna</p>

            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-brand-text-secondary">Encabezado</label>
              <input
                :value="selectedColumn.label"
                type="text"
                class="rounded border border-brand-border px-2.5 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                @input="updateLabel(selectedColumn, ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="flex flex-col gap-1.5 border-t border-brand-border-light pt-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Agregación</p>
              <label
                v-for="opt in columnKindOptions(selectedColumn)"
                :key="opt.value"
                class="flex items-start gap-2 rounded p-1.5"
                :class="opt.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-brand-bg'"
              >
                <input type="radio" class="mt-0.5" :checked="selectedColumn.kind === opt.value" :disabled="opt.disabled" @change="setColumnKind(selectedColumn, opt.value)" />
                <span class="flex flex-col">
                  <span class="text-sm font-semibold text-brand-text">{{ opt.label }}</span>
                  <span class="text-xs text-brand-text-muted">{{ opt.description }}</span>
                </span>
              </label>
              <p v-if="!isNumericFieldType(columnDataTypes[selectedColumn.key] ?? '')" class="flex items-center gap-1.5 text-xs text-brand-text-muted">
                <AlertTriangle class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
                Solo los campos numéricos se pueden sumar o repartir.
              </p>
            </div>

            <div v-if="selectedColumn.kind === 'repartir'" class="flex flex-col gap-2 rounded border border-brand-border-light bg-brand-bg p-3">
              <p class="text-xs font-bold text-brand-text">Repartir «{{ selectedColumn.label }}» por condición</p>
              <label class="text-xs font-semibold text-brand-text-secondary">Campo condición</label>
              <select
                class="rounded border border-brand-border px-2.5 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
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
              <p v-if="conditionCandidates(selectedColumn.source.side).length === 0" class="flex items-center gap-1.5 text-xs text-brand-text-muted">
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
    </div>

    <!-- Modal "Configurar tabla relacionada" (ERD-88 #292 - agrupamiento + papelera) -->
    <div v-if="detailConfigOpen && detail" class="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" @click.self="detailConfigOpen = false">
      <div class="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg bg-brand-surface p-5 shadow-xl">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-bold text-brand-text">Config de tabla relacionada</h3>
          <button type="button" class="text-brand-text-muted hover:text-brand-text" @click="detailConfigOpen = false">
            <X class="h-4 w-4" :stroke-width="1.75" />
          </button>
        </div>

        <div class="flex flex-col gap-2 border-b border-brand-border-light pb-4">
          <p class="text-xs font-bold uppercase tracking-wide text-brand-text-muted">Datos</p>
          <label class="flex items-center justify-between gap-3 text-sm text-brand-text">
            Incluir registros eliminados de "{{ detail.entitySlug }}"
            <input v-model="detail.includeDeleted" type="checkbox" class="h-4 w-4" />
          </label>
          <label class="flex items-center justify-between gap-3 text-sm text-brand-text">
            Incluir registros eliminados de "{{ entitySlug }}"
            <input v-model="includeDeletedBase" type="checkbox" class="h-4 w-4" />
          </label>
          <p class="flex items-center gap-1.5 text-xs text-brand-text-muted">
            <Ban class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
            Un registro eliminado se muestra atenuado ("· Eliminado") en la vista previa, no se descarta.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <p class="text-xs font-bold uppercase tracking-wide text-brand-text-muted">Agrupamiento (subtotales anidados)</p>
            <button type="button" class="text-xs font-semibold text-brand-blue hover:underline disabled:opacity-40" :disabled="groupBy.length >= 4" @click="addGroupLevel">
              + Agregar nivel
            </button>
          </div>
          <p class="text-xs text-brand-text-muted">Genera un subtotal por cada nivel y un total general al final del documento.</p>

          <div v-for="(level, index) in groupBy" :key="index" class="flex items-center gap-2">
            <span class="w-16 shrink-0 text-xs font-semibold text-brand-text-secondary">Nivel {{ index + 1 }}</span>
            <select
              class="flex-1 rounded border border-brand-border px-2.5 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              :value="groupLevelSelectedValue(level)"
              @change="
                (() => {
                  const [side, path] = ($event.target as HTMLSelectElement).value.split('|')
                  const parts = path.split('.')
                  groupBy[index] = { side: side as 'base' | 'detail', forwardHops: parts.slice(0, -1), field: parts[parts.length - 1] }
                })()
              "
            >
              <option v-for="leaf in groupLevelLeaves()" :key="groupLevelOptionValue(leaf)" :value="groupLevelOptionValue(leaf)">
                {{ leaf.label }}
              </option>
            </select>
            <button type="button" class="text-brand-text-muted hover:text-brand-error-text" @click="removeGroupLevel(index)">
              <Trash2 class="h-4 w-4" :stroke-width="1.75" />
            </button>
          </div>
          <p v-if="groupBy.length === 0" class="text-xs text-brand-text-muted">Sin niveles configurados, el reporte se imprime como una sola lista.</p>
        </div>
      </div>
    </div>
  </div>
</template>

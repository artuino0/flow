<script setup lang="ts">
// HU-ERD-24: pagina generica de listado para cualquier entidad - arma la
// tabla a partir de GET /api/entities/:slug/fields (columnas + permisos) y
// GET /api/records/:slug (filas, paginado y ordenado). Reemplazable mas
// adelante por las pantallas de modulo especificas (ERD-32) sin cambiar el motor.
//
// Diseno Pencil: toolbar (titulo + badge de conteo + boton "Crear nuevo") y
// tabla igual que Screen/List Clientes del .pen. Se omite el buscador de
// texto libre del diseno (Screen/List Pedidos - Filtro Select): esta HU
// (ERD-73) solo pide el panel de Filtros para campos Select/Multiselect, no
// un buscador general para cualquier listado - sumar eso sin que la HU lo
// pida seria alcance extra, no algo de esta HU puntual.
//
// ERD-80 (2026-09-01): boton "Importar" agregado al toolbar, junto a "Crear
// nuevo" (mismo permiso canCreate) - lleva a pages/registros/:entity/importar.vue.
// No hay mock de Pencil para esta pantalla (revisado antes de construir,
// pencil-antes-de-frontend: no existe ningun Screen/Importar en el .pen) -
// se construyo siguiendo el mismo lenguaje visual ya establecido en el resto
// del Constructor de Modulos.
import { ChevronRight, FilePlus, FileText, Pencil, Filter, LayoutGrid, List, MoreHorizontal, Plus, Printer, RefreshCw, Search, Settings2, Upload, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import { calendarRange, localDateTimeToIso } from '~/utils/calendar'
import { formatRelativeTime } from '~/utils/relativeTime'
import { isListFilterable, listFilterOperators, type ListFilterOperator } from '~/utils/listFilters'

definePageMeta({ layout: 'default', fullBleed: true, darkReady: true })

const route = useRoute()
const slug = route.params.entity as string
const { user } = useAuth()

const { data: meta, pending: metaPending, error: metaError } = await useEntityFields(slug)

// Pedido directo del usuario (2026-09-05): "quiero que los modulos, en el
// listado, tengan un boton que lleve a la edicion del modulo, visible solo
// para el administrador" - reusa composables/useIsAdmin.ts (mismo dato que ya
// resuelve components/AppNav.vue para la seccion ADMINISTRACIÓN, deduplicado
// por Nuxt via useAsyncData). El boton lleva a pages/modulos/[id]/editar.vue,
// la misma pantalla que ya usa el Listado de Módulos (components/ModuleListing.vue)
// para esta accion - reusa su icono (Settings2) y texto ("Editar módulo") en
// vez de inventar un lenguaje visual nuevo.
const { data: isAdmin } = await useIsAdmin()

const page = ref(1)
// HU-ERD-75: orden por defecto del "Diseño del listado" (Table Builder) si el
// modulo tiene uno configurado - resuelto por el servidor (resolveListLayout,
// null cuando no hay configuracion propia), asi que sin listLayout guardado
// esto sigue siendo exactamente createdAt/desc como antes de esta HU.
const sortBy = ref(meta.value?.listLayout.defaultSort?.field ?? 'createdAt')
const sortDir = ref<'asc' | 'desc'>(meta.value?.listLayout.defaultSort?.dir ?? 'desc')

// HU-ERD-75: las columnas visibles y su orden salen del "Diseño del listado"
// (listLayout.columns, ya resuelto/reconciliado contra los campos reales por
// el servidor) - sin listLayout guardado, resolveListLayout() devuelve todos
// los campos visibles en el orden de entity_fields, exactamente el
// comportamiento anterior a esta HU (criterio de aceptacion explicito: sin
// romper compatibilidad para Clientes/Empresas/Empleados).
const visibleFields = computed<EntityFieldMeta[]>(() => {
  const layout = meta.value?.listLayout
  const allFields = meta.value?.fields ?? []
  if (!layout) return allFields
  const byName = new Map(allFields.map((f) => [f.name, f]))
  return layout.columns
    .filter((c) => c.visible)
    .map((c) => byName.get(c.name))
    .filter((f): f is EntityFieldMeta => !!f)
})

// HU-ERD-73/75: panel de Filtros (Screen/List Pedidos - Filtro Select del
// .pen) - un solo filtro activo a la vez (mismo alcance que el backend, ver
// el comentario en server/api/records/[entity]/index.get.ts), solo sobre
// campos Select/Multiselect que ademas esten en listLayout.filterFields (la
// lista de filtros "ofrecidos" del Table Builder - ya reconciliada contra
// los campos reales por el servidor, HU-ERD-75). Sin listLayout guardado,
// filterFields default es TODOS los Select/Multiselect (mismo comportamiento
// que HU-ERD-73 sin esta HU encima). Las etiquetas y colores salen siempre de
// field.validationRules.options, nunca hardcodeados (criterio de aceptacion
// explicito de HU-ERD-73).
const filterableFields = computed(() => {
  const offeredNames = new Set(meta.value?.listLayout.filterFields ?? [])
  return (meta.value?.fields ?? []).filter((f) => isListFilterable(f.dataType) && offeredNames.has(f.name))
})

const appliedFilterField = ref<string | null>(null)
const appliedFilterValues = ref<string[]>([])
const appliedFilterOperator = ref<ListFilterOperator>('eq')
const assignedToMe = ref(false)

const filterPopoverOpen = ref(false)
const draftFieldName = ref<string | null>(null)
const draftValues = ref<string[]>([])
const draftOperator = ref<ListFilterOperator>('eq')

const draftField = computed(() => filterableFields.value.find((f) => f.name === draftFieldName.value) ?? null)
const draftOperators = computed(() => listFilterOperators(draftField.value?.dataType ?? 'text'))
const draftOperatorMeta = computed(() => draftOperators.value.find((op) => op.value === draftOperator.value) ?? draftOperators.value[0])
const draftInput = computed({ get: () => draftValues.value[0] ?? '', set: (v: string) => { draftValues.value = v ? [v, ...(draftValues.value.slice(1))] : [] } })
const draftSecondInput = computed({ get: () => draftValues.value[1] ?? '', set: (v: string) => { draftValues.value = [draftValues.value[0] ?? '', v] } })
const draftOptions = computed<Array<{ value: string; label: string; color?: string }>>(() => {
  const raw = draftField.value?.validationRules?.options
  return Array.isArray(raw) ? (raw as Array<{ value: string; label: string; color?: string }>) : []
})

function openFilterPopover() {
  draftFieldName.value = appliedFilterField.value ?? filterableFields.value[0]?.name ?? null
  draftValues.value = [...appliedFilterValues.value]
  draftOperator.value = appliedFilterOperator.value
  filterPopoverOpen.value = true
  reportMenuOpen.value = false
}

function resetDraftField() {
  draftValues.value = []
  draftOperator.value = listFilterOperators(draftField.value?.dataType ?? 'text')[0]?.value ?? 'eq'
}

function toggleDraftValue(value: string) {
  draftValues.value = draftValues.value.includes(value)
    ? draftValues.value.filter((v) => v !== value)
    : [...draftValues.value, value]
}

function applyFilter() {
  const count = draftOperatorMeta.value?.values ?? 1
  const values = count === 0 ? ['true'] : draftValues.value.filter(Boolean)
  appliedFilterField.value = draftFieldName.value && values.length >= count ? draftFieldName.value : null
  appliedFilterValues.value = appliedFilterField.value ? values : []
  appliedFilterOperator.value = draftOperator.value
  filterPopoverOpen.value = false
  page.value = 1
}

function clearFilter() {
  appliedFilterField.value = null
  appliedFilterValues.value = []
  appliedFilterOperator.value = 'eq'
  draftValues.value = []
  filterPopoverOpen.value = false
  page.value = 1
}

// ERD-88 (Diseñador de reportes imprimibles): boton "Generar reporte" +
// "Entry Menu" del listado - fiel a Screen/Generar reporte (punto de
// entrada) del .pen, revisado con las herramientas de Pencil antes de
// construir esta pantalla (regla pencil-antes-de-frontend). El mock reusa el
// componente Button/Primary (mismo estilo que "Crear nuevo": fondo naranja,
// texto blanco) para este boton, NO el estilo Outline de "Filtros"/"Importar" -
// confirmado inspeccionando el nodo real (`ref: CnZSn` = Button/Primary).
//
// Al abrir el menu: "Nuevo reporte" (icono file-plus, azul) lleva siempre al
// Diseñador vacio; debajo, si hay plantillas guardadas para esta entidad, una
// seccion "REPORTES GUARDADOS" (icono file-text) - cada item es un documento
// ya configurado (ej. "Remito de carga", "Lista de embarque" en el mock), y
// tocar el titulo lleva a la Vista previa de impresión con datos vigentes.
// El lapiz visible solo para administradores abre directamente el diseñador;
// la API tambien exige ese rol para guardar o eliminar plantillas.
interface SavedPrintReport {
  id: string
  title: string
  updatedAt: string
}

const reportMenuOpen = ref(false)
const savedReports = ref<SavedPrintReport[]>([])
const savedReportsLoading = ref(false)
const savedReportsError = ref(false)
let savedReportsLoaded = false

async function toggleReportMenu() {
  if (reportMenuOpen.value) {
    reportMenuOpen.value = false
    return
  }
  reportMenuOpen.value = true
  filterPopoverOpen.value = false
  if (savedReportsLoaded) return
  savedReportsLoading.value = true
  savedReportsError.value = false
  try {
    savedReports.value = await $fetch<SavedPrintReport[]>('/api/print-reports', { query: { baseEntity: slug } })
    savedReportsLoaded = true
  } catch {
    savedReportsError.value = true
  } finally {
    savedReportsLoading.value = false
  }
}

const searchDraft = ref('')
const appliedSearch = ref('')
const refreshing = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchDraft, value => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    appliedSearch.value = value.trim()
    page.value = 1
  }, 280)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

interface RecordsResponse {
  data: { id: string; customData: Record<string, unknown> }[]
  page: number
  pageSize: number
  total: number
  // Reportado por el usuario (2026-09-03): etiquetas de columnas relation ya
  // resueltas server-side (ver server/utils/relationLabels.ts).
  relationLabels: Record<string, Record<string, string>>
}

// HU-ERD-32: mismo fix de forwarding de cookie en SSR que useEntityFields.ts
// (HU-ERD-22/23/24) - sin esto, un refresh completo (F5) de esta pagina tira
// 401 durante el SSR y muestra el estado de error aunque el usuario si este
// logueado.
const {
  data: recordsData,
  pending: recordsPending,
  error: recordsError,
  refresh: refreshRecords
} = await useFetch<RecordsResponse>(`/api/records/${slug}`, {
  key: () => `records-${slug}-${page.value}-${sortBy.value}-${sortDir.value}-${appliedSearch.value}-${appliedFilterField.value}-${appliedFilterOperator.value}-${appliedFilterValues.value.join(',')}-${assignedToMe.value}`,
  query: computed(() => ({
    page: page.value,
    pageSize: 20,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
    search: appliedSearch.value || undefined,
    filterField: appliedFilterField.value ?? undefined,
    filterValues: appliedFilterValues.value.length > 0 ? appliedFilterValues.value.join(',') : undefined,
    filterOperator: appliedFilterField.value ? appliedFilterOperator.value : undefined,
    assignedToMe: assignedToMe.value || undefined
  })),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

interface BoardResponse {
  config: NonNullable<typeof meta.value>['boardConfig']
  columns: Array<{ key: string; label: string; color?: string; records: Array<{ id: string; customData: Record<string, unknown>; updatedAt: string }>; total: number }>
  relationLabels: Record<string, Record<string, string>>
}
const boardEnabled = computed(() => Boolean(meta.value?.boardConfig?.enabled))
const calendarEnabled = computed(() => Boolean(meta.value?.calendarConfig?.enabled))
type RecordView = 'table' | 'board' | 'calendar'
const initialView: RecordView = calendarEnabled.value ? 'calendar' : boardEnabled.value && meta.value?.boardConfig.defaultView === 'board' ? 'board' : 'table'
const viewMode = ref<RecordView>(initialView)
const initialCalendarView = meta.value?.calendarConfig?.defaultView ?? 'month'
const calendarRangeValue = ref(calendarRange(new Date(), initialCalendarView))
function onCalendarRangeChange(range: { from: string; to: string }) {
  if (range.from !== calendarRangeValue.value.from || range.to !== calendarRangeValue.value.to) calendarRangeValue.value = range
}
interface CalendarResponse {
  config: NonNullable<typeof meta.value>['calendarConfig']
  events: Array<{ id: string; customData: Record<string, unknown>; updatedAt: string; date: string; time: string; durationMinutes: number; title: string; color: string | null; groupValue: string; groupLabel: string }>
  relationLabels: Record<string, Record<string, string>>
  timezone: string
}
const moduleDescription = computed(() => slug.toLowerCase() === 'prospectos'
  ? 'Gestiona oportunidades y avances comerciales.'
  : `Gestiona los registros y la operación de ${meta.value?.entity?.name || slug}.`)
const activeFilterCount = computed(() => (appliedFilterField.value ? 1 : 0))

const { data: boardData, pending: boardPending, error: boardError, refresh: refreshBoard } = await useFetch<BoardResponse>(`/api/records/${slug}/board`, {
  key: () => `record-board-${slug}-${appliedSearch.value}-${appliedFilterField.value}-${appliedFilterOperator.value}-${appliedFilterValues.value.join(',')}`,
  query: computed(() => ({
    pageSize: 40,
    search: appliedSearch.value || undefined,
    filterField: appliedFilterField.value ?? undefined,
    filterValues: appliedFilterValues.value.length > 0 ? appliedFilterValues.value.join(',') : undefined,
    filterOperator: appliedFilterField.value ? appliedFilterOperator.value : undefined
  })),
  immediate: boardEnabled.value,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const { data: calendarData, pending: calendarPending, error: calendarError, refresh: refreshCalendar } = await useFetch<CalendarResponse>(`/api/records/${slug}/calendar`, {
  key: () => `record-calendar-${slug}-${calendarRangeValue.value.from}-${calendarRangeValue.value.to}-${assignedToMe.value}`,
  query: computed(() => ({ ...calendarRangeValue.value, assignedToMe: assignedToMe.value || undefined })),
  immediate: calendarEnabled.value,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
onMounted(() => {
  const saved = localStorage.getItem(`flow-record-view:${slug}`)
  if (saved === 'table' || (saved === 'board' && boardEnabled.value) || (saved === 'calendar' && calendarEnabled.value)) viewMode.value = saved
})
watch(viewMode, value => {
  if (import.meta.client) localStorage.setItem(`flow-record-view:${slug}`, value)
  if (value === 'board' && !boardData.value) void refreshBoard()
  if (value === 'calendar' && !calendarData.value) void refreshCalendar()
})
async function refreshCurrentView() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    if (viewMode.value === 'board') await refreshBoard()
    else if (viewMode.value === 'calendar') await refreshCalendar()
    else await refreshRecords()
  } finally {
    refreshing.value = false
  }
}

function onCalendarCreate(payload: { date: string; time: string }) {
  const config = meta.value?.calendarConfig
  if (!config) return
  const query: Record<string, string> = {}
  if (config.startDateField) query[config.startDateField] = payload.date
  if (config.startTimeField) {
    const field = meta.value?.fields.find(item => item.name === config.startTimeField)
    query[config.startTimeField] = field?.dataType === 'datetime'
      ? localDateTimeToIso(payload.date, payload.time, calendarData.value?.timezone ?? 'America/Mexico_City')
      : payload.time
  }
  void navigateTo({ path: `/registros/${slug}/nuevo`, query })
}
function onCalendarUpdated(updated: CalendarResponse['events'][number]) {
  reconcileBoardRecord({ id: updated.id, customData: updated.customData, updatedAt: updated.updatedAt })
  void refreshCalendar()
}
function onCalendarOpen(id: string) { void navigateTo(`/registros/${slug}/${id}`) }

function reconcileBoardRecord(updated: { id: string; customData: Record<string, unknown>; updatedAt: string }) {
  const listRecord = recordsData.value?.data.find(record => record.id === updated.id)
  if (listRecord) listRecord.customData = { ...updated.customData }

  const board = boardData.value
  const statusField = board?.config?.statusField
  if (!board || !statusField) return

  let source: (typeof board.columns)[number] | undefined
  let sourceIndex = -1
  for (const column of board.columns) {
    const index = column.records.findIndex(record => record.id === updated.id)
    if (index >= 0) {
      source = column
      sourceIndex = index
      break
    }
  }

  const rawStatus = updated.customData[statusField]
  const targetKey = rawStatus === null || rawStatus === undefined || rawStatus === '' ? '__unset__' : String(rawStatus)
  const target = board.columns.find(column => column.key === targetKey)
  if (!target) return

  if (source?.key === target.key && sourceIndex >= 0) {
    source.records.splice(sourceIndex, 1, updated)
    return
  }

  if (source && sourceIndex >= 0) {
    source.records.splice(sourceIndex, 1)
    source.total = Math.max(0, source.total - 1)
  }
  target.records.unshift(updated)
  target.total += 1
}

const labelPrintUrl = computed(() => {
  const ids = recordsData.value?.data.map(record => record.id) ?? []
  return `/registros/${slug}/etiquetas/imprimir${ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''}`
})

function onSort(value: { sortBy: string; sortDir: 'asc' | 'desc' }) {
  sortBy.value = value.sortBy
  sortDir.value = value.sortDir
  page.value = 1
}

const deleteError = ref<string | null>(null)

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts. Reusa la variante "success" (Toast/Guardado,
// circle-check verde) para la confirmacion de borrado - el diseno en Pencil
// no tiene una quinta variante "Eliminado" propia, y semanticamente sigue
// siendo "la accion terminó bien", igual que crear.
const toast = useToast()

async function onDuplicate(id: string) {
  try {
    const copy = await $fetch<{ id: string }>(`/api/records/${slug}/${id}/duplicate`, { method: 'POST' })
    await navigateTo({ path: `/registros/${slug}/${copy.id}`, query: { duplicatedFrom: id } })
  } catch (err) {
    const message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.error('No se pudo duplicar el registro', message || 'Inténtalo de nuevo.')
  }
}

async function onDelete(id: string) {
  deleteError.value = null
  try {
    await $fetch(`/api/records/${slug}/${id}`, { method: 'DELETE' })
    await refreshRecords()
    toast.success('Registro eliminado', 'El registro se eliminó correctamente.')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el registro'
    toast.error('No se pudo eliminar el registro', deleteError.value)
  }
}
</script>

<template>
  <div class="records-screen" :class="{ 'board-active': viewMode === 'board' }">
    <header class="module-page-header">
      <nav class="module-breadcrumb" aria-label="Migas de pan">
        <NuxtLink to="/">Inicio</NuxtLink>
        <ChevronRight class="h-[13px] w-[13px]" :stroke-width="1.75" />
        <span>{{ meta?.entity?.name || slug }}</span>
      </nav>

      <div class="module-title-row">
        <div class="module-title-copy">
          <div class="flex min-w-0 items-center gap-2.5">
            <h1>{{ meta?.entity?.name || slug }}</h1>
            <span v-if="recordsData" class="record-count">
              {{ recordsData.total }} registro{{ recordsData.total === 1 ? '' : 's' }}
            </span>
            <NuxtLink
              v-if="isAdmin && meta?.entity?.id"
              :to="'/modulos/' + meta.entity.id + '/editar'"
              title="Editar módulo"
              class="module-settings"
            >
              <Settings2 class="h-4 w-4" :stroke-width="1.75" />
            </NuxtLink>
          </div>
          <p>{{ moduleDescription }}</p>
        </div>

        <div class="module-actions">
          <button type="button" class="header-button" :aria-pressed="assignedToMe" @click="assignedToMe = !assignedToMe; page = 1">Asignado a mí</button>
          <div class="relative">
            <button
              type="button"
              class="header-button"
              :disabled="filterableFields.length === 0"
              @click="filterPopoverOpen ? (filterPopoverOpen = false) : openFilterPopover()"
            >
              <Filter class="h-[15px] w-[15px]" :stroke-width="1.75" />
              Filtros
            </button>

            <div v-if="filterPopoverOpen" class="filter-popover">
              <div class="mb-3 flex items-center justify-between">
                <h3 class="text-sm font-bold text-brand-text">Filtrar{{ draftField ? ' por ' + draftField.label : '' }}</h3>
                <button type="button" class="text-brand-text-muted hover:text-brand-text" @click="filterPopoverOpen = false">
                  <X class="h-4 w-4" :stroke-width="1.75" />
                </button>
              </div>

              <label class="mb-1 block text-xs font-semibold text-brand-text-secondary">Campo</label>
              <select
                v-model="draftFieldName"
                class="mb-3 w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                @change="resetDraftField"
              >
                <option v-for="f in filterableFields" :key="f.id" :value="f.name">{{ f.label }}</option>
              </select>

              <label class="mb-1 block text-xs font-semibold text-brand-text-secondary">Comparación</label>
              <select v-model="draftOperator" class="mb-3 w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue">
                <option v-for="operator in draftOperators" :key="operator.value" :value="operator.value">{{ operator.label }}</option>
              </select>

              <label v-if="draftOperatorMeta?.values" class="mb-1 block text-xs font-semibold text-brand-text-secondary">Valor</label>
              <div v-if="draftField?.dataType === 'select' || draftField?.dataType === 'multiselect'" class="mb-4 flex max-h-48 flex-col gap-1 overflow-y-auto">
                <p v-if="draftOptions.length === 0" class="text-xs text-brand-text-muted">Este campo no tiene opciones configuradas.</p>
                <label v-for="opt in draftOptions" :key="opt.value" class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-brand-text hover:bg-brand-bg">
                  <input type="checkbox" :checked="draftValues.includes(opt.value)" class="h-3.5 w-3.5" @change="toggleDraftValue(opt.value)" />
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="colorDotClass(opt.color)" />
                  {{ opt.label }}
                </label>
              </div>
              <select v-else-if="draftField?.dataType === 'boolean'" v-model="draftInput" class="mb-4 w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text">
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
              <div v-else-if="draftOperatorMeta?.values" class="mb-4 flex gap-2">
                <input v-model="draftInput" :type="['number','currency','incremental'].includes(draftField?.dataType ?? '') ? 'number' : ['date','datetime'].includes(draftField?.dataType ?? '') ? 'date' : 'text'" class="w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text" :placeholder="draftField?.dataType === 'relation' ? 'ID del registro relacionado' : 'Valor'" />
                <input v-if="draftOperatorMeta.values === 2" v-model="draftSecondInput" type="date" class="w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text" placeholder="Hasta" />
              </div>

              <div class="flex items-center justify-between">
                <button type="button" class="text-sm font-semibold text-brand-text-secondary hover:text-brand-text" @click="clearFilter">Limpiar</button>
                <button type="button" class="rounded bg-brand-orange px-3.5 py-1.5 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover" @click="applyFilter">
                  Aplicar filtro
                </button>
              </div>
            </div>
          </div>

          <NuxtLink v-if="meta?.permissions?.canCreate" :to="'/registros/' + slug + '/importar'" class="header-button">
            <Upload class="h-[15px] w-[15px]" :stroke-width="1.75" />
            Importar
          </NuxtLink>
          <NuxtLink v-if="meta?.permissions?.canCreate" :to="'/registros/' + slug + '/nuevo'" class="header-button primary">
            <Plus class="h-4 w-4" :stroke-width="2" />
            Crear nuevo
          </NuxtLink>
        </div>
      </div>
    </header>

    <div class="board-toolbar">
      <div class="toolbar-left">
        <label class="record-search">
          <Search class="h-3.5 w-3.5" :stroke-width="1.75" />
          <input v-model="searchDraft" type="search" placeholder="Buscar registros..." />
        </label>

        <button v-if="activeFilterCount" type="button" class="active-filter-chip" @click="clearFilter">
          <Filter class="h-3 w-3" :stroke-width="1.75" />
          {{ activeFilterCount }} filtro{{ activeFilterCount === 1 ? '' : 's' }} activo{{ activeFilterCount === 1 ? '' : 's' }}
          <X class="h-3 w-3" :stroke-width="2" />
        </button>

        <span class="updated-label">
          <RefreshCw class="h-[13px] w-[13px]" :stroke-width="1.75" />
          Actualizado recientemente
        </span>
      </div>

      <div class="toolbar-right">
        <div v-if="boardEnabled || calendarEnabled" class="view-toggle" aria-label="Vista de registros">
          <button type="button" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">
            <List class="h-3.5 w-3.5" :stroke-width="1.75" />
            Tabla
          </button>
          <button v-if="boardEnabled" type="button" :class="{ active: viewMode === 'board' }" @click="viewMode = 'board'">
            <LayoutGrid class="h-3.5 w-3.5" :stroke-width="1.75" />
            Kanban
          </button>
          <button v-if="calendarEnabled" type="button" :class="{ active: viewMode === 'calendar' }" @click="viewMode = 'calendar'">Calendario</button>
        </div>

        <button type="button" class="toolbar-icon-button" title="Actualizar" :disabled="refreshing" @click="refreshCurrentView">
          <RefreshCw class="h-[15px] w-[15px]" :class="{ 'animate-spin': refreshing }" :stroke-width="1.75" />
        </button>

        <div class="relative">
          <button type="button" class="toolbar-icon-button" title="Más acciones" @click="toggleReportMenu">
            <MoreHorizontal class="h-[15px] w-[15px]" :stroke-width="2" />
          </button>

          <div v-if="reportMenuOpen" class="action-menu">
            <NuxtLink v-if="isAdmin" :to="'/registros/' + slug + '/reportes/nuevo'" class="action-menu-item" @click="reportMenuOpen = false">
              <FilePlus class="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" :stroke-width="1.75" />
              <span class="flex min-w-0 flex-col">
                <span class="text-sm font-semibold text-brand-text">Nuevo reporte</span>
                <span class="text-xs text-brand-text-muted">Crear un documento imprimible</span>
              </span>
            </NuxtLink>

            <NuxtLink
              v-if="meta?.entity?.labelConfig?.enabled && recordsData?.data.length"
              :to="labelPrintUrl"
              target="_blank"
              class="action-menu-item"
              @click="reportMenuOpen = false"
            >
              <Printer class="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" :stroke-width="1.75" />
              <span class="flex flex-col">
                <span class="text-sm font-semibold text-brand-text">Imprimir etiquetas</span>
                <span class="text-xs text-brand-text-muted">Usar los registros visibles</span>
              </span>
            </NuxtLink>

            <p v-if="savedReportsLoading" class="px-3.5 py-2 text-xs text-brand-text-muted">Cargando reportes guardados...</p>
            <p v-else-if="savedReportsError" class="px-3.5 py-2 text-xs text-brand-error-text">No se pudieron cargar los reportes guardados.</p>
            <template v-else-if="savedReports.length > 0">
              <p class="border-t border-brand-border-light px-3.5 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Reportes guardados</p>
              <div v-for="report in savedReports" :key="report.id" class="flex items-stretch">
                <NuxtLink
                  :to="'/registros/' + slug + '/reportes/' + report.id + '/imprimir'"
                  class="action-menu-item min-w-0 flex-1"
                  @click="reportMenuOpen = false"
                >
                  <FileText class="mt-0.5 h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-sm font-semibold text-brand-text">{{ report.title }}</span>
                    <span class="text-xs text-brand-text-muted">Editado {{ formatRelativeTime(report.updatedAt) }}</span>
                  </span>
                </NuxtLink>
                <NuxtLink
                  v-if="isAdmin"
                  :to="'/registros/' + slug + '/reportes/' + report.id + '/editar'"
                  class="flex w-10 shrink-0 items-center justify-center text-brand-text-secondary hover:bg-brand-bg hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
                  :aria-label="`Editar reporte ${report.title}`"
                  :title="`Editar ${report.title}`"
                  @click="reportMenuOpen = false"
                ><Pencil class="h-4 w-4" :stroke-width="1.75" /></NuxtLink>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <main class="records-content" :class="{ 'board-content': viewMode === 'board' }">
      <p v-if="metaPending || (viewMode === 'table' && recordsPending) || (viewMode === 'board' && boardPending) || (viewMode === 'calendar' && calendarPending && !calendarData)" class="content-message">Cargando...</p>
      <p v-else-if="metaError" class="content-message text-brand-error-text">
        {{ metaError.statusCode === 403 && String(metaError.statusMessage || '').includes('desactivado') ? 'Este módulo está desactivado.' : 'No se pudo cargar la definición de esta entidad.' }}
      </p>
      <p v-else-if="(viewMode === 'table' && recordsError) || (viewMode === 'board' && boardError) || (viewMode === 'calendar' && calendarError)" class="content-message text-brand-error-text">No se pudieron cargar los registros.</p>

      <template v-else-if="meta">
        <p v-if="deleteError" class="content-message text-brand-error-text">{{ deleteError }}</p>
        <p v-if="viewMode !== 'calendar' && meta.fields.filter((f) => f.name !== 'id').length === 0" class="content-message">Esta entidad todavía no tiene campos configurados.</p>
        <p v-else-if="viewMode === 'table' && visibleFields.length === 0" class="content-message">
          Todas las columnas están ocultas en el diseño del listado de este módulo.
        </p>
        <RecordKanbanBoard
          v-else-if="viewMode === 'board' && boardData"
          :entity-slug="slug"
          :config="boardData.config"
          :fields="meta.fields"
          :columns="boardData.columns"
          :relation-labels="boardData.relationLabels"
          :can-update="meta.permissions.canUpdate"
          :workflow-config="meta.entity.workflowConfig"
          :user-role-id="user?.roleId"
          :search="appliedSearch"
          :filter-field="appliedFilterField"
          :filter-values="appliedFilterValues"
          :filter-operator="appliedFilterOperator"
          @updated="reconcileBoardRecord"
        />
        <RecordCalendar
          v-else-if="viewMode === 'calendar' && calendarData && meta.calendarConfig"
          :entity-slug="slug"
          :entity-name="meta.entity.name"
          :config="calendarData.config"
          :fields="meta.fields"
          :events="calendarData.events"
          :timezone="calendarData.timezone"
          :pending="calendarPending"
          :can-update="meta.permissions.canUpdate"
          :assigned-to-me="assignedToMe"
          @range-change="onCalendarRangeChange"
          @create-record="onCalendarCreate"
          @open-record="onCalendarOpen"
          @updated="onCalendarUpdated"
        />
        <div v-else-if="viewMode === 'table' && recordsData" class="table-wrap">
          <DynamicTable
            :entity-slug="slug"
            :fields="visibleFields"
            :rows="recordsData.data"
            :page="recordsData.page"
            :page-size="recordsData.pageSize"
            :total="recordsData.total"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            :permissions="meta.permissions"
            :relation-labels="recordsData.relationLabels"
            :actions-sticky="true"
            @update:page="page = $event"
            @update:sort="onSort"
            @delete="onDelete"
            @duplicate="onDuplicate"
          />
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.records-screen{display:flex;height:100%;min-height:0;min-width:0;flex-direction:column;overflow:hidden;background:rgb(var(--brand-bg))}
.module-page-header{height:119px;flex:0 0 119px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-surface));padding:20px 28px}
.module-breadcrumb{display:flex;height:16px;align-items:center;gap:4px;font-size:13px;font-weight:500;color:rgb(var(--brand-text-muted))}
.module-breadcrumb a{color:rgb(var(--brand-text-secondary))}.module-breadcrumb a:hover{color:rgb(var(--brand-blue))}.module-breadcrumb span{font-weight:700;color:rgb(var(--brand-text))}
.module-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-top:14px}
.module-title-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.module-title-copy h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:24px;font-weight:700;line-height:29px;color:rgb(var(--brand-text))}.module-title-copy>p{font-size:13px;line-height:16px;color:rgb(var(--brand-text-secondary))}
.record-count{flex:none;border-radius:999px;background:rgb(var(--brand-neutral-bg));padding:3px 10px;font-size:12px;font-weight:700;line-height:15px;color:rgb(var(--brand-text-secondary))}
.module-settings{display:flex;height:28px;width:28px;flex:none;align-items:center;justify-content:center;border-radius:4px;color:rgb(var(--brand-text-secondary))}.module-settings:hover{background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-blue))}
.module-actions{display:flex;align-items:center;gap:10px}.header-button{display:flex;height:35px;align-items:center;gap:6px;border:1px solid rgb(var(--brand-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 14px;font-size:14px;font-weight:600;color:rgb(var(--brand-text));white-space:nowrap}.header-button:hover{background:rgb(var(--brand-bg))}.header-button:disabled{cursor:not-allowed;opacity:.45}.header-button.primary{border-color:rgb(var(--brand-orange));background:rgb(var(--brand-orange));padding:0 16px;color:rgb(var(--brand-primary-fg))}.header-button.primary:hover{background:rgb(var(--brand-orange-hover))}
.filter-popover{position:absolute;right:0;top:calc(100% + 6px);z-index:40;width:320px;border:1px solid rgb(var(--brand-border-light));border-radius:8px;background:rgb(var(--brand-surface));padding:16px;box-shadow:0 8px 24px rgb(var(--brand-shadow) / .14)}
.board-toolbar{display:flex;height:54px;flex:0 0 54px;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-surface));padding:10px 28px}
.toolbar-left,.toolbar-right{display:flex;min-width:0;align-items:center;gap:10px}.toolbar-left{flex:1}.toolbar-right{flex:none}
.record-search{display:flex;height:30px;width:220px;flex:none;align-items:center;gap:6px;border:1px solid rgb(var(--brand-border-light));border-radius:4px;background:rgb(var(--brand-bg));padding:0 10px;color:rgb(var(--brand-text-muted))}.record-search:focus-within{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}.record-search input{min-width:0;flex:1;border:0;background:transparent;font-size:13px;color:rgb(var(--brand-text));outline:none}.record-search input::placeholder{color:rgb(var(--brand-text-muted))}.record-search input::-webkit-search-cancel-button{display:none}
.active-filter-chip{display:flex;height:25px;align-items:center;gap:6px;border-radius:999px;background:rgb(var(--brand-blue-bg));padding:0 10px;font-size:12px;font-weight:600;color:rgb(var(--brand-blue));white-space:nowrap}.active-filter-chip:hover{background:rgb(var(--brand-filter-hover))}
.updated-label{display:flex;min-width:0;align-items:center;gap:5px;font-size:12px;font-weight:500;color:rgb(var(--brand-text-muted));white-space:nowrap}
.view-toggle{display:flex;height:34px;align-items:center;gap:2px;border-radius:4px;background:rgb(var(--brand-neutral-bg));padding:3px}.view-toggle button{display:flex;height:28px;align-items:center;gap:6px;border-radius:4px;padding:0 12px;font-size:13px;font-weight:600;color:rgb(var(--brand-text-secondary))}.view-toggle button.active{background:rgb(var(--brand-surface));color:rgb(var(--brand-blue));box-shadow:0 1px 2px rgb(var(--brand-shadow) / .06)}
.toolbar-icon-button{display:flex;height:32px;width:32px;align-items:center;justify-content:center;border:1px solid rgb(var(--brand-border-light));border-radius:4px;background:rgb(var(--brand-surface));color:rgb(var(--brand-text-secondary))}.toolbar-icon-button:hover{background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.toolbar-icon-button:disabled{cursor:wait;opacity:.55}
.action-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:40;width:320px;overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:8px;background:rgb(var(--brand-surface));padding:6px 0;box-shadow:0 8px 24px rgb(var(--brand-shadow) / .14)}.action-menu-item{display:flex;gap:10px;padding:10px 14px}.action-menu-item:hover{background:rgb(var(--brand-bg))}
.records-content{min-height:0;min-width:0;flex:1;overflow:auto;padding:20px 28px 28px}.records-content.board-content{overflow:hidden;padding:20px}.content-message{font-size:13px;color:rgb(var(--brand-text-muted))}.table-wrap{min-width:0}
@media(max-width:900px){.module-page-header{height:auto;min-height:119px;flex-basis:auto}.module-title-row{align-items:flex-end}.module-actions{gap:6px}.header-button{padding:0 10px}.updated-label{display:none}}
@media(max-width:720px){.records-screen{overflow:auto}.module-page-header{padding:16px}.module-title-row{flex-direction:column;align-items:stretch;gap:14px}.module-actions{display:grid;grid-template-columns:1fr 1fr}.module-actions .primary{grid-column:1/-1}.header-button{justify-content:center}.board-toolbar{height:auto;min-height:108px;flex:none;align-items:stretch;flex-direction:column;padding:10px 16px}.toolbar-left,.toolbar-right{width:100%}.record-search{width:100%}.toolbar-right{justify-content:flex-end}.records-content,.records-content.board-content{min-height:560px;padding:12px}.module-title-copy h1{font-size:22px}}
</style>

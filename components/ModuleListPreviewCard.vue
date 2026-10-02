<script setup lang="ts">
// HU-ERD-75: "Vista previa en vivo" del paso "Diseño del listado" (Screen/Table
// Builder del .pen). Reusa DynamicTable.vue - el MISMO componente que renderiza
// el listado real (pages/registros/:entity/index.vue) - mismo principio
// "preview = resultado real" ya establecido en ModulePreviewCard.vue (ERD-70)
// y RecordDetailView.vue (ERD-74): nunca una tabla de mockup reimplementada
// aparte. A diferencia de RecordDetailView (que soporta preview Y real en un
// solo componente porque la ficha real vive en su propia pagina), acá el
// listado real ya tiene su propia pagina con su propia toolbar/paginación
// real - este componente es solo el ala de "vista previa" del configurador,
// pero delega el render de filas/columnas a DynamicTable.vue igual.
//
// El orden que el usuario prueba haciendo clic en un encabezado acá es
// exploratorio (no se guarda) - el campo real "Orden por defecto" se
// configura en ModuleListLayoutCard.vue; si cambia ahí, la vista previa se
// resincroniza sola (watch de props.listLayout.defaultSort).
import type { BoardConfig, CalendarConfig, EntityFieldMeta, ListLayout } from '~/composables/useEntityFields'
import type { ModuleListingTab } from '~/utils/moduleListingTabs'

const props = defineProps<{
  entitySlug: string
  entityName: string
  fields: EntityFieldMeta[]
  listLayout: ListLayout
  activeView: ModuleListingTab
  boardConfig: BoardConfig
  calendarConfig: CalendarConfig
}>()

interface PreviewRecord { id: string; customData: Record<string, unknown> }
interface PreviewRecordsResponse { data: PreviewRecord[]; total: number; relationLabels: Record<string, Record<string, string>> }

const previewFields = computed<EntityFieldMeta[]>(() =>
  props.listLayout.columns
    .filter((c) => c.visible)
    .map((c) => props.fields.find((f) => f.name === c.name))
    .filter((f): f is EntityFieldMeta => !!f)
)

const sortBy = ref(props.listLayout.defaultSort?.field ?? 'createdAt')
const sortDir = ref<'asc' | 'desc'>(props.listLayout.defaultSort?.dir ?? 'desc')

watch(
  () => props.listLayout.defaultSort,
  (sort) => {
    sortBy.value = sort?.field ?? 'createdAt'
    sortDir.value = sort?.dir ?? 'desc'
  }
)

const rows = ref<PreviewRecord[]>([])
const total = ref(0)
const loading = ref(false)
const relationLabels = ref<Record<string, Record<string, string>>>({})
const boardStatuses = computed(() => {
  const field = props.fields.find((item) => item.name === props.boardConfig.statusField)
  const options = Array.isArray(field?.validationRules?.options) ? field.validationRules.options as Array<{ value: string; label: string }> : []
  return options
})
const calendarMonth = new Date()
const calendarCells = computed(() => {
  const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const offset = first.getDay()
  const lastDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate()
  const totalCells = Math.ceil((offset + lastDate) / 7) * 7
  return Array.from({ length: totalCells }, (_, index) => {
    const date = index - offset + 1
    return date > 0 && date <= lastDate ? date : null
  })
})

function recordValue(record: PreviewRecord, fieldName: string | null): string {
  if (!fieldName) return ''
  const value = record.customData[fieldName]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function boardRecords(status: string) {
  return rows.value.filter((record) => recordValue(record, props.boardConfig.statusField) === status).slice(0, 2)
}

function calendarRecords(day: number) {
  const field = props.calendarConfig.startDateField
  if (!field) return []
  const datePrefix = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return rows.value.filter((record) => recordValue(record, field).slice(0, 10) === datePrefix).slice(0, 2)
}

function recordTitle(record: PreviewRecord, configuredField: string | null): string {
  const title = recordValue(record, configuredField)
  return title || recordValue(record, props.fields.find((field) => field.dataType === 'text')?.name ?? null) || `Registro ${record.id.slice(0, 6)}`
}

async function load() {
  if (!props.entitySlug) return
  loading.value = true
  try {
    const res = await $fetch<PreviewRecordsResponse>(`/api/records/${props.entitySlug}`, {
      query: { page: 1, pageSize: 5, sortBy: sortBy.value, sortDir: sortDir.value }
    })
    rows.value = res.data
    total.value = res.total
    relationLabels.value = res.relationLabels
  } finally {
    loading.value = false
  }
}

watch([() => props.entitySlug, sortBy, sortDir], load, { immediate: true })

function onSort(value: { sortBy: string; sortDir: 'asc' | 'desc' }) {
  sortBy.value = value.sortBy
  sortDir.value = value.sortDir
}
</script>

<template>
  <div class="flex min-w-0 flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
    <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
      <h2 class="text-[15px] font-bold text-brand-text">{{ activeView === 'table' ? 'Vista previa en vivo' : activeView === 'board' ? 'Vista previa del tablero' : 'Vista previa del calendario' }}</h2>
      <p class="text-sm text-brand-text-secondary">Así se verá el listado de {{ entityName || 'este módulo' }}</p>
    </div>

    <div v-if="activeView === 'table'" class="min-w-0 p-5">
      <p v-if="previewFields.length === 0" class="text-sm text-brand-text-muted">Ninguna columna está marcada como visible todavía.</p>
      <DynamicTable
        v-else
        :entity-slug="entitySlug"
        :fields="previewFields"
        :rows="rows"
        :page="1"
        :page-size="5"
        :total="total"
        :sort-by="sortBy"
        :sort-dir="sortDir"
        :permissions="{ canRead: true, canCreate: false, canUpdate: false, canDelete: false }"
        :relation-labels="relationLabels"
        @update:sort="onSort"
      />
    </div>

    <div v-else-if="activeView === 'board'" class="flex min-w-0 flex-col gap-3 p-5">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-bold text-brand-text">Tablero por {{ fields.find((field) => field.name === boardConfig.statusField)?.label || 'estado' }}</h3>
        <span class="text-xs text-brand-text-muted">{{ total }} registros</span>
      </div>
      <div v-if="!boardConfig.enabled" class="rounded bg-brand-bg p-4 text-sm text-brand-text-muted">Activa Kanban para ver el tablero.</div>
      <div v-else-if="boardStatuses.length === 0" class="rounded bg-brand-warning-bg p-4 text-sm text-brand-warning-text">Elige un campo de Selección para mostrar las columnas.</div>
      <div v-else class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <section v-for="status in boardStatuses" :key="status.value" class="min-w-0 rounded border border-brand-border-light bg-brand-bg p-2.5">
          <h4 class="truncate text-xs font-bold text-brand-text">{{ status.label }}</h4>
          <div class="mt-2 flex flex-col gap-2">
            <article v-for="record in boardRecords(status.value)" :key="record.id" class="rounded border border-brand-border-light bg-brand-surface p-2.5">
              <p class="truncate text-xs font-semibold text-brand-text">{{ recordTitle(record, boardConfig.titleField) }}</p>
              <p v-for="secondary in boardConfig.secondaryFields.slice(0, 3)" :key="secondary" class="mt-1 truncate text-[11px] text-brand-text-muted">{{ recordValue(record, secondary) }}</p>
            </article>
            <p v-if="boardRecords(status.value).length === 0" class="py-3 text-center text-[11px] text-brand-text-muted">Sin registros</p>
          </div>
        </section>
      </div>
    </div>

    <div v-else class="flex min-w-0 flex-col gap-3 p-5">
      <div class="flex items-center justify-between gap-2 text-xs text-brand-text-secondary">
        <span class="font-semibold">Vista inicial: {{ calendarConfig.defaultView === 'day' ? 'Día' : calendarConfig.defaultView === 'week' ? 'Semana' : 'Mes' }}</span>
        <span class="truncate">{{ fields.find((field) => field.name === calendarConfig.startDateField)?.label || 'Selecciona una fecha' }}</span>
      </div>
      <p v-if="!calendarConfig.enabled" class="rounded bg-brand-bg p-4 text-sm text-brand-text-muted">Activa Calendario para ver la agenda.</p>
      <p v-else-if="!calendarConfig.startDateField" class="rounded bg-brand-warning-bg p-4 text-sm text-brand-warning-text">Elige el campo de fecha para mostrar la agenda.</p>
      <div v-else class="overflow-hidden rounded border border-brand-border-light">
        <div class="grid grid-cols-7 border-b border-brand-border-light bg-brand-bg text-center text-[10px] font-semibold text-brand-text-secondary">
          <span v-for="weekday in ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']" :key="weekday" class="py-2">{{ weekday }}</span>
        </div>
        <div class="grid grid-cols-7">
          <div v-for="(day, index) in calendarCells" :key="index" class="min-h-[66px] min-w-0 border-b border-r border-brand-border-light p-1.5">
            <span v-if="day" class="text-[10px] text-brand-text-muted">{{ day }}</span>
            <div v-if="day" class="mt-1 flex min-w-0 flex-col gap-1">
              <span v-for="record in calendarRecords(day)" :key="record.id" class="truncate rounded bg-brand-blue-bg px-1 py-0.5 text-[9px] font-medium text-brand-blue">{{ recordTitle(record, calendarConfig.titleField) }}</span>
            </div>
          </div>
        </div>
      </div>
      <p v-if="calendarConfig.enabled" class="rounded bg-brand-blue-bg px-3 py-2 text-xs text-brand-text-secondary">Con Calendario activo, el listado se abre en Calendario.</p>
    </div>
  </div>
</template>

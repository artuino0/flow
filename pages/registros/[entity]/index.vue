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
import { FileBarChart2, FilePlus, FileText, Filter, Plus, Settings2, Upload, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import { formatRelativeTime } from '~/utils/relativeTime'
import { isListFilterable, listFilterOperators, type ListFilterOperator } from '~/utils/listFilters'

definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string

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

const appliedFilterFieldMeta = computed(() => filterableFields.value.find((f) => f.name === appliedFilterField.value) ?? null)
const appliedFilterLabels = computed(() => {
  const options = Array.isArray(appliedFilterFieldMeta.value?.validationRules?.options)
    ? (appliedFilterFieldMeta.value!.validationRules.options as Array<{ value: string; label: string }>)
    : []
  return appliedFilterValues.value.map((v) => options.find((o) => o.value === v)?.label ?? v)
})
const appliedFilterOperatorLabel = computed(() => listFilterOperators(appliedFilterFieldMeta.value?.dataType ?? 'text').find((op) => op.value === appliedFilterOperator.value)?.label ?? 'Es igual a')

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
// tocarlo lleva directo a la Vista previa impresión (reimprimir con los datos
// vigentes, ver comentario largo sobre esto en server/db/schema.ts) en vez de
// reabrir el Diseñador - "editar" esa plantilla queda como una accion
// secundaria disponible DESDE la propia Vista previa (ERD-88 #293), no desde
// este menu de entrada (el mock no muestra ningun icono de edición en la fila,
// solo el titulo + "Editado hace X").
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
  key: () => `records-${slug}-${page.value}-${sortBy.value}-${sortDir.value}-${appliedFilterField.value}-${appliedFilterOperator.value}-${appliedFilterValues.value.join(',')}`,
  query: computed(() => ({
    page: page.value,
    pageSize: 20,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
    filterField: appliedFilterField.value ?? undefined,
    filterValues: appliedFilterValues.value.length > 0 ? appliedFilterValues.value.join(',') : undefined,
    filterOperator: appliedFilterField.value ? appliedFilterOperator.value : undefined
  })),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
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
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <h1 class="text-[22px] font-bold text-brand-text">{{ meta?.entity?.name || slug }}</h1>
        <span
          v-if="recordsData"
          class="rounded-full bg-brand-neutral-bg px-2.5 py-0.5 text-xs font-semibold text-brand-neutral-text"
        >
          {{ recordsData.total }} registro{{ recordsData.total === 1 ? '' : 's' }}
        </span>
        <NuxtLink
          v-if="isAdmin && meta?.entity?.id"
          :to="`/modulos/${meta.entity.id}/editar`"
          title="Editar módulo"
          class="flex h-7 w-7 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg hover:text-brand-blue"
        >
          <Settings2 class="h-4 w-4" :stroke-width="1.75" />
        </NuxtLink>
      </div>
      <div class="flex items-center gap-2.5">
        <div v-if="filterableFields.length > 0" class="relative">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded border border-brand-border-light px-3.5 py-2 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg"
            @click="filterPopoverOpen ? (filterPopoverOpen = false) : openFilterPopover()"
          >
            <Filter class="h-4 w-4" :stroke-width="1.75" />
            Filtros
          </button>

          <!-- HU-ERD-73: panel "Filtrar por <Campo>" - campo + lista de
               opciones configuradas (color + etiqueta, sin conteo por valor:
               eso pediria una query agregada extra por opcion, no forma parte
               del criterio de aceptacion de esta HU). -->
          <div v-if="filterPopoverOpen" class="absolute right-0 z-20 mt-1.5 w-80 rounded-lg border border-brand-border-light bg-brand-surface p-4 shadow-lg">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-sm font-bold text-brand-text">Filtrar{{ draftField ? ` por ${draftField.label}` : '' }}</h3>
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
              <label
                v-for="opt in draftOptions"
                :key="opt.value"
                class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-brand-text hover:bg-brand-bg"
              >
                <input type="checkbox" :checked="draftValues.includes(opt.value)" class="h-3.5 w-3.5" @change="toggleDraftValue(opt.value)" />
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="colorDotClass(opt.color)" />
                {{ opt.label }}
              </label>
            </div>
            <select v-else-if="draftField?.dataType === 'boolean'" v-model="draftInput" class="mb-4 w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text">
              <option value="true">Sí</option><option value="false">No</option>
            </select>
            <div v-else-if="draftOperatorMeta?.values" class="mb-4 flex gap-2">
              <input v-model="draftInput" :type="['number','currency','incremental'].includes(draftField?.dataType ?? '') ? 'number' : ['date','datetime'].includes(draftField?.dataType ?? '') ? 'date' : 'text'" class="w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text" :placeholder="draftField?.dataType === 'relation' ? 'ID del registro relacionado' : 'Valor'" />
              <input v-if="draftOperatorMeta.values === 2" v-model="draftSecondInput" type="date" class="w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text" placeholder="Hasta" />
            </div>

            <div class="flex items-center justify-between">
              <button type="button" class="text-sm font-semibold text-brand-text-secondary hover:text-brand-text" @click="clearFilter">Limpiar</button>
              <button type="button" class="rounded bg-brand-orange px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-orange-hover" @click="applyFilter">
                Aplicar filtro
              </button>
            </div>
          </div>
        </div>
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover"
            @click="toggleReportMenu"
          >
            <FileBarChart2 class="h-4 w-4" :stroke-width="1.75" />
            Generar reporte
          </button>

          <div v-if="reportMenuOpen" class="absolute right-0 z-20 mt-1.5 w-80 rounded-lg border border-brand-border-light bg-brand-surface py-1.5 shadow-lg">
            <NuxtLink
              :to="`/registros/${slug}/reportes/nuevo`"
              class="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-brand-bg"
              @click="reportMenuOpen = false"
            >
              <FilePlus class="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" :stroke-width="1.75" />
              <span class="flex flex-col">
                <span class="text-sm font-semibold text-brand-text">Nuevo reporte</span>
                <span class="text-xs text-brand-text-muted">Empezar un documento en blanco</span>
              </span>
            </NuxtLink>

            <p v-if="savedReportsLoading" class="px-3.5 py-2 text-xs text-brand-text-muted">Cargando reportes guardados...</p>
            <p v-else-if="savedReportsError" class="px-3.5 py-2 text-xs text-brand-error-text">No se pudieron cargar los reportes guardados.</p>

            <template v-else-if="savedReports.length > 0">
              <p class="mt-1 px-3.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Reportes guardados</p>
              <NuxtLink
                v-for="report in savedReports"
                :key="report.id"
                :to="`/registros/${slug}/reportes/${report.id}/imprimir`"
                class="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-brand-bg"
                @click="reportMenuOpen = false"
              >
                <FileText class="mt-0.5 h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
                <span class="flex flex-col">
                  <span class="text-sm font-semibold text-brand-text">{{ report.title }}</span>
                  <span class="text-xs text-brand-text-muted">Editado {{ formatRelativeTime(report.updatedAt) }}</span>
                </span>
              </NuxtLink>
            </template>
          </div>
        </div>
        <NuxtLink
          v-if="meta?.permissions?.canCreate"
          :to="`/registros/${slug}/importar`"
          class="flex items-center gap-1.5 rounded border border-brand-border-light px-3.5 py-2 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg"
        >
          <Upload class="h-4 w-4" :stroke-width="1.75" />
          Importar
        </NuxtLink>
        <NuxtLink
          v-if="meta?.permissions?.canCreate"
          :to="`/registros/${slug}/nuevo`"
          class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover"
        >
          <Plus class="h-4 w-4" :stroke-width="2" />
          Crear nuevo
        </NuxtLink>
      </div>
    </div>

    <div v-if="appliedFilterField && appliedFilterFieldMeta" class="flex items-center gap-2">
      <span class="flex items-center gap-1.5 rounded-full bg-brand-neutral-bg px-3 py-1 text-xs font-semibold text-brand-neutral-text">
        {{ appliedFilterFieldMeta.label }}: {{ appliedFilterLabels.join(', ') }}
        <X class="h-3 w-3 cursor-pointer" @click="clearFilter" />
      </span>
    </div>

    <p v-if="metaPending || recordsPending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="metaError" class="text-sm text-brand-error-text">
      {{ metaError.statusCode === 403 && String(metaError.statusMessage || '').includes('desactivado') ? 'Este módulo está desactivado.' : 'No se pudo cargar la definición de esta entidad.' }}
    </p>
    <p v-else-if="recordsError" class="text-sm text-brand-error-text">No se pudieron cargar los registros.</p>

    <template v-else-if="meta && recordsData">
      <p v-if="deleteError" class="text-sm text-brand-error-text">{{ deleteError }}</p>
      <p v-if="meta.fields.filter((f) => f.name !== 'id').length === 0" class="text-sm text-brand-text-muted">Esta entidad todavia no tiene campos configurados.</p>
      <p v-else-if="visibleFields.length === 0" class="text-sm text-brand-text-muted">
        Todas las columnas están ocultas en el diseño del listado de este módulo.
      </p>
      <DynamicTable
        v-else
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
      />
    </template>
  </div>
</template>

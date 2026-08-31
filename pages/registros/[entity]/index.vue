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
import { Filter, Plus, X } from '@lucide/vue'

definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string

const { data: meta, pending: metaPending, error: metaError } = await useEntityFields(slug)

const page = ref(1)
const sortBy = ref('createdAt')
const sortDir = ref<'asc' | 'desc'>('desc')

// HU-ERD-73: panel de Filtros (Screen/List Pedidos - Filtro Select del .pen)
// - un solo filtro activo a la vez (mismo alcance que el backend, ver el
// comentario en server/api/records/[entity]/index.get.ts), solo sobre
// campos Select/Multiselect (los unicos con un conjunto fijo de valores
// conocidos - un filtro "es alguno de" sobre texto libre no tiene sentido
// aca). Las etiquetas y colores salen siempre de field.validationRules.options,
// nunca hardcodeados (criterio de aceptacion explicito de la HU).
const filterableFields = computed(() => (meta.value?.fields ?? []).filter((f) => f.dataType === 'select' || f.dataType === 'multiselect'))

const appliedFilterField = ref<string | null>(null)
const appliedFilterValues = ref<string[]>([])

const filterPopoverOpen = ref(false)
const draftFieldName = ref<string | null>(null)
const draftValues = ref<string[]>([])

const draftField = computed(() => filterableFields.value.find((f) => f.name === draftFieldName.value) ?? null)
const draftOptions = computed<Array<{ value: string; label: string; color?: string }>>(() => {
  const raw = draftField.value?.validationRules?.options
  return Array.isArray(raw) ? (raw as Array<{ value: string; label: string; color?: string }>) : []
})

function openFilterPopover() {
  draftFieldName.value = appliedFilterField.value ?? filterableFields.value[0]?.name ?? null
  draftValues.value = [...appliedFilterValues.value]
  filterPopoverOpen.value = true
}

function toggleDraftValue(value: string) {
  draftValues.value = draftValues.value.includes(value)
    ? draftValues.value.filter((v) => v !== value)
    : [...draftValues.value, value]
}

function applyFilter() {
  appliedFilterField.value = draftValues.value.length > 0 ? draftFieldName.value : null
  appliedFilterValues.value = draftValues.value.length > 0 ? [...draftValues.value] : []
  filterPopoverOpen.value = false
  page.value = 1
}

function clearFilter() {
  appliedFilterField.value = null
  appliedFilterValues.value = []
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

interface RecordsResponse {
  data: { id: string; customData: Record<string, unknown> }[]
  page: number
  pageSize: number
  total: number
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
  key: () => `records-${slug}-${page.value}-${sortBy.value}-${sortDir.value}-${appliedFilterField.value}-${appliedFilterValues.value.join(',')}`,
  query: computed(() => ({
    page: page.value,
    pageSize: 20,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
    filterField: appliedFilterField.value ?? undefined,
    filterValues: appliedFilterValues.value.length > 0 ? appliedFilterValues.value.join(',') : undefined
  })),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

function onSort(value: { sortBy: string; sortDir: 'asc' | 'desc' }) {
  sortBy.value = value.sortBy
  sortDir.value = value.sortDir
  page.value = 1
}

const deleteError = ref<string | null>(null)

async function onDelete(id: string) {
  deleteError.value = null
  try {
    await $fetch(`/api/records/${slug}/${id}`, { method: 'DELETE' })
    await refreshRecords()
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el registro'
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
              @change="draftValues = []"
            >
              <option v-for="f in filterableFields" :key="f.id" :value="f.name">{{ f.label }}</option>
            </select>

            <label class="mb-1 block text-xs font-semibold text-brand-text-secondary">Es alguno de</label>
            <div class="mb-4 flex max-h-48 flex-col gap-1 overflow-y-auto">
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

            <div class="flex items-center justify-between">
              <button type="button" class="text-sm font-semibold text-brand-text-secondary hover:text-brand-text" @click="clearFilter">Limpiar</button>
              <button type="button" class="rounded bg-brand-orange px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-orange-hover" @click="applyFilter">
                Aplicar filtro
              </button>
            </div>
          </div>
        </div>
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
    <p v-else-if="metaError" class="text-sm text-brand-error-text">No se pudo cargar la definicion de esta entidad.</p>
    <p v-else-if="recordsError" class="text-sm text-brand-error-text">No se pudieron cargar los registros.</p>

    <template v-else-if="meta && recordsData">
      <p v-if="deleteError" class="text-sm text-brand-error-text">{{ deleteError }}</p>
      <p v-if="meta.fields.length === 0" class="text-sm text-brand-text-muted">Esta entidad todavia no tiene campos configurados.</p>
      <DynamicTable
        v-else
        :entity-slug="slug"
        :fields="meta.fields"
        :rows="recordsData.data"
        :page="recordsData.page"
        :page-size="recordsData.pageSize"
        :total="recordsData.total"
        :sort-by="sortBy"
        :sort-dir="sortDir"
        :permissions="meta.permissions"
        @update:page="page = $event"
        @update:sort="onSort"
        @delete="onDelete"
      />
    </template>
  </div>
</template>

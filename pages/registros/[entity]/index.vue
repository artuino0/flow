<script setup lang="ts">
// HU-ERD-24: pagina generica de listado para cualquier entidad - arma la
// tabla a partir de GET /api/entities/:slug/fields (columnas + permisos) y
// GET /api/records/:slug (filas, paginado y ordenado). Reemplazable mas
// adelante por las pantallas de modulo especificas (ERD-32) sin cambiar el motor.
//
// Diseno Pencil: toolbar (titulo + badge de conteo + boton "Crear nuevo") y
// tabla igual que Screen/List Clientes del .pen. Se omiten el buscador y los
// chips de filtro del diseno: el backend (GET /api/records/:slug) todavia no
// soporta busqueda ni filtros por campo, agregar los controles sin que hagan
// nada seria enganoso.
import { Plus } from '@lucide/vue'

definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string

const { data: meta, pending: metaPending, error: metaError } = await useEntityFields(slug)

const page = ref(1)
const sortBy = ref('createdAt')
const sortDir = ref<'asc' | 'desc'>('desc')

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
  key: () => `records-${slug}-${page.value}-${sortBy.value}-${sortDir.value}`,
  query: computed(() => ({ page: page.value, pageSize: 20, sortBy: sortBy.value, sortDir: sortDir.value })),
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
      <NuxtLink
        v-if="meta?.permissions?.canCreate"
        :to="`/registros/${slug}/nuevo`"
        class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover"
      >
        <Plus class="h-4 w-4" :stroke-width="2" />
        Crear nuevo
      </NuxtLink>
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

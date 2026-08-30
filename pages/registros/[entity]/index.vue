<script setup lang="ts">
// HU-ERD-24: pagina generica de listado para cualquier entidad - arma la
// tabla a partir de GET /api/entities/:slug/fields (columnas + permisos) y
// GET /api/records/:slug (filas, paginado y ordenado). Reemplazable mas
// adelante por las pantallas de modulo especificas (ERD-32) sin cambiar el motor.
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

const {
  data: recordsData,
  pending: recordsPending,
  error: recordsError,
  refresh: refreshRecords
} = await useFetch<RecordsResponse>(`/api/records/${slug}`, {
  key: () => `records-${slug}-${page.value}-${sortBy.value}-${sortDir.value}`,
  query: computed(() => ({ page: page.value, pageSize: 20, sortBy: sortBy.value, sortDir: sortDir.value }))
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
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">
        {{ meta?.entity?.name || slug }}
      </h1>
      <NuxtLink
        v-if="meta?.permissions?.canCreate"
        :to="`/registros/${slug}/nuevo`"
        class="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
      >
        Nuevo
      </NuxtLink>
    </div>

    <p v-if="metaPending || recordsPending" class="text-sm text-gray-500">Cargando...</p>
    <p v-else-if="metaError" class="text-sm text-red-600">No se pudo cargar la definicion de esta entidad.</p>
    <p v-else-if="recordsError" class="text-sm text-red-600">No se pudieron cargar los registros.</p>

    <template v-else-if="meta && recordsData">
      <p v-if="deleteError" class="text-sm text-red-600">{{ deleteError }}</p>
      <p v-if="meta.fields.length === 0" class="text-sm text-gray-500">Esta entidad todavia no tiene campos configurados.</p>
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

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
import type { EntityFieldMeta, ListLayout } from '~/composables/useEntityFields'

const props = defineProps<{
  entitySlug: string
  entityName: string
  fields: EntityFieldMeta[]
  listLayout: ListLayout
}>()

interface PreviewRecord { id: string; customData: Record<string, unknown> }
interface PreviewRecordsResponse { data: PreviewRecord[]; total: number }

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

async function load() {
  if (!props.entitySlug) return
  loading.value = true
  try {
    const res = await $fetch<PreviewRecordsResponse>(`/api/records/${props.entitySlug}`, {
      query: { page: 1, pageSize: 5, sortBy: sortBy.value, sortDir: sortDir.value }
    })
    rows.value = res.data
    total.value = res.total
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
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
      <h2 class="text-[15px] font-bold text-brand-text">Vista previa en vivo</h2>
      <p class="text-sm text-brand-text-secondary">Así se verá el listado de {{ entityName || 'este módulo' }}</p>
    </div>

    <div class="p-5">
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
        @update:sort="onSort"
      />
    </div>
  </div>
</template>

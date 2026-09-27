<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
// HU-ERD-74: ficha de detalle de solo lectura de un registro (Screen/Detalle
// Pedido del .pen, investigado en HU-ERD-72) - hasta esta HU no existia una
// vista de detalle separada del formulario de edicion (ver el "no hay
// pantalla de detalle nueva" de ERD-72, que era una decision acotada a UN
// tipo de campo - esta HU si es la que pide, explicitamente, configurar "la
// ficha de un registro", asi que corresponde construirla de verdad aca).
// Reusa RecordDetailView.vue (el MISMO componente que la vista previa del
// configurador en pages/modulos/[id]/editar.vue) - preview y resultado real
// nunca pueden divergir en forma, porque son literalmente el mismo componente.
definePageMeta({ layout: 'default', fullBleed: true })

const route = useRoute()
const router = useRouter()
const slug = route.params.entity as string
const id = route.params.id as string
const { user } = useAuth()

const { data, pending, error: fetchError } = await useEntityFields(slug)

interface RecordRow {
  id: string
  customData: Record<string, unknown>
  createdAt?: string
  // Reportado por el usuario (2026-09-03): etiquetas de propiedades relation
  // ya resueltas server-side (ver server/utils/relationLabels.ts).
  relationLabels: Record<string, Record<string, string>>
}

// HU-ERD-32: mismo fix de forwarding de cookie en SSR ya establecido en el
// resto de pages/registros/:entity/*.
const { data: record, pending: recordPending, error: recordError, refresh: refreshRecord } = await useFetch<RecordRow>(
  `/api/records/${slug}/${id}`,
  { key: `record-detail-${slug}-${id}`, headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined }
)

const breadcrumbLabel = computed(() => {
  if (!data.value || !record.value) return 'Detalle'
  return labelForRecord(data.value.fields, record.value.customData, record.value.id, data.value.entity.labelField)
})

function onDeleted() {
  router.push(`/registros/${slug}`)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-brand-bg">
    <nav class="flex h-[55px] shrink-0 items-center gap-1.5 border-b border-brand-border-light bg-white px-7 text-[13px]" aria-label="Ruta del registro">
      <NuxtLink to="/" class="text-brand-text-secondary hover:text-brand-blue">Inicio</NuxtLink>
      <ChevronRight class="h-3.5 w-3.5 text-brand-text-muted" :stroke-width="1.75" />
      <NuxtLink :to="`/registros/${slug}`" class="text-brand-text-secondary hover:text-brand-blue">{{ data?.entity?.name || slug }}</NuxtLink>
      <ChevronRight class="h-3.5 w-3.5 text-brand-text-muted" :stroke-width="1.75" />
      <span class="min-w-0 truncate font-bold text-brand-text">{{ breadcrumbLabel }}</span>
    </nav>

    <div class="min-h-0 flex-1 overflow-auto p-7">
      <div v-if="route.query.duplicatedFrom" class="mb-4 rounded border border-brand-blue bg-brand-blue-bg px-4 py-3 text-sm font-semibold text-brand-blue" role="status">
        Registro duplicado. Esta es la copia; el original sigue disponible.
        <NuxtLink :to="`/registros/${slug}/${route.query.duplicatedFrom}`" class="ml-1 underline">Ver original</NuxtLink>
      </div>
      <p v-if="(pending || recordPending) && !record" class="text-sm text-brand-text-muted">Cargando...</p>
      <p v-else-if="fetchError" class="text-sm text-brand-error-text">No se pudo cargar la definición de esta entidad.</p>
      <p v-else-if="recordError" class="text-sm text-brand-error-text">
        {{ recordError.statusCode === 404 ? 'Este registro no existe.' : 'No se pudo cargar el registro.' }}
      </p>

      <RecordDetailView
        v-else-if="data && record"
        :entity-slug="slug"
        :entity-name="data.entity.name"
        :fields="data.fields"
        :layout="data.detailLayout"
        :inverse-relations="data.inverseRelations"
        :record="record"
        :can-update="data.permissions.canUpdate"
        :can-create="data.permissions.canCreate"
        :can-delete="data.permissions.canDelete"
        :label-field="data.entity.labelField"
        :workflow-config="data.entity.workflowConfig"
        :user-role-id="user?.roleId"
        :start-in-edit="route.query.mode === 'edit'"
        :initial-pane="route.query.tab === 'activity' ? 'activity' : 'associations'"
        :initial-activity-id="typeof route.query.activityId === 'string' ? route.query.activityId : undefined"
        @deleted="onDeleted"
        @changed="refreshRecord()"
      />
    </div>
  </div>
</template>



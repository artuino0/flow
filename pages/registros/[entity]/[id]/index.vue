<script setup lang="ts">
// HU-ERD-74: ficha de detalle de solo lectura de un registro (Screen/Detalle
// Pedido del .pen, investigado en HU-ERD-72) - hasta esta HU no existia una
// vista de detalle separada del formulario de edicion (ver el "no hay
// pantalla de detalle nueva" de ERD-72, que era una decision acotada a UN
// tipo de campo - esta HU si es la que pide, explicitamente, configurar "la
// ficha de un registro", asi que corresponde construirla de verdad aca).
// Reusa RecordDetailView.vue (el MISMO componente que la vista previa del
// configurador en pages/modulos/[id]/editar.vue) - preview y resultado real
// nunca pueden divergir en forma, porque son literalmente el mismo componente.
definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
const slug = route.params.entity as string
const id = route.params.id as string

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
const { data: record, pending: recordPending, error: recordError } = await useFetch<RecordRow>(
  `/api/records/${slug}/${id}`,
  { key: `record-detail-${slug}-${id}`, headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined }
)

function onDeleted() {
  router.push(`/registros/${slug}`)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <NuxtLink :to="`/registros/${slug}`" class="text-brand-text-secondary hover:underline">{{ data?.entity?.name || slug }}</NuxtLink>
      <span class="text-brand-text-muted">/</span>
      <span class="font-bold text-brand-text">Detalle</span>
    </div>

    <p v-if="pending || recordPending" class="text-sm text-brand-text-muted">Cargando...</p>
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
      :can-delete="data.permissions.canDelete"
      :label-field="data.entity.labelField"
      @deleted="onDeleted"
    />
  </div>
</template>

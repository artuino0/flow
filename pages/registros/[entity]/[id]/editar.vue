<script setup lang="ts">
// HU-ERD-23: pagina generica de edicion, simetrica a nuevo.vue - precarga
// customData del registro (GET /api/records/:slug/:id) y actualiza via PUT.
//
// Rediseño (2026-09-04): mismo cambio y mismo motivo que nuevo.vue (ver el
// comentario largo ahi) - breadcrumb + titulo/subtitulo, tarjeta
// "Informacion general" + una tarjeta por Campo Tabla, fiel a Screen/Form
// Pedido (Campo Tabla) del .pen.
definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string
const id = route.params.id as string

const { data, pending, error: fetchError } = await useEntityFields(slug)

interface RecordRow {
  id: string
  customData: Record<string, unknown>
}

// HU-ERD-32: mismo fix de forwarding de cookie en SSR que useEntityFields.ts.
const { data: record, pending: recordPending, error: recordError } = await useFetch<RecordRow>(
  `/api/records/${slug}/${id}`,
  { key: `record-${slug}-${id}`, headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined }
)

const generalFields = computed(() => (data.value?.fields ?? []).filter((f) => f.dataType !== 'tabla'))
const visibleGeneralFields = computed(() => generalFields.value.filter((f) => f.name !== 'id' && f.dataType !== 'incremental'))
const tablaFields = computed(() => (data.value?.fields ?? []).filter((f) => f.dataType === 'tabla'))

const formValues = ref<Record<string, unknown>>({})
watchEffect(() => {
  if (record.value) formValues.value = { ...record.value.customData }
})

const generalFormRef = ref<{ validateAll: () => boolean } | null>(null)
const tablaFormRefs = ref<Array<{ validateAll: () => boolean } | null>>([])
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submitted = ref(false)

function validateAll(): boolean {
  const refs = [generalFormRef.value, ...tablaFormRefs.value].filter((r): r is { validateAll: () => boolean } => Boolean(r))
  const results = refs.map((r) => r.validateAll())
  return results.every(Boolean)
}

async function onSubmit() {
  submitError.value = null
  submitted.value = false
  if (!validateAll()) return

  submitting.value = true
  try {
    await $fetch(`/api/records/${slug}/${id}`, {
      method: 'PUT',
      body: { customData: formValues.value }
    })
    submitted.value = true
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || 'No se pudo actualizar el registro'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <NuxtLink :to="`/registros/${slug}`" class="text-brand-text-secondary hover:underline">{{ data?.entity?.name || slug }}</NuxtLink>
      <span class="text-brand-text-muted">/</span>
      <span class="font-bold text-brand-text">Editar</span>
    </div>

    <p v-if="pending || recordPending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError || recordError" class="text-sm text-brand-error-text">
      No se pudo cargar el registro o la definicion de esta entidad.
    </p>

    <template v-else-if="data && record">
      <div class="flex flex-col gap-1">
        <h1 class="text-[22px] font-bold text-brand-text">Editar {{ data.entity.name }}</h1>
        <p class="text-sm text-brand-text-secondary">Actualiza los campos de este registro.</p>
      </div>

      <form class="flex flex-col gap-5" @submit.prevent="onSubmit">
        <div v-if="visibleGeneralFields.length > 0" class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Información general</h2>
          </div>
          <div class="p-5">
            <DynamicForm ref="generalFormRef" v-model="formValues" :fields="generalFields" :entity-id="data.entity.id" :disabled="submitting" />
          </div>
        </div>

        <div
          v-for="field in tablaFields"
          :key="field.id"
          class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]"
        >
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">{{ field.label }}</h2>
            <p class="mt-0.5 text-xs text-brand-text-muted">Agrega las filas que necesites.</p>
          </div>
          <div class="p-5">
            <DynamicForm ref="tablaFormRefs" v-model="formValues" :fields="[field]" :entity-id="data.entity.id" :disabled="submitting" hide-labels />
          </div>
        </div>

        <p v-if="submitError" class="text-sm text-brand-error-text">{{ submitError }}</p>
        <p v-if="submitted" class="text-sm text-brand-success-text">Cambios guardados correctamente.</p>

        <div class="flex justify-end gap-2">
          <NuxtLink
            :to="`/registros/${slug}`"
            class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
          >
            Volver al listado
          </NuxtLink>
          <button
            type="submit"
            :disabled="submitting"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ submitting ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

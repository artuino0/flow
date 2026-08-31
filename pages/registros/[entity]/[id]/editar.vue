<script setup lang="ts">
// HU-ERD-23: pagina generica de edicion, simetrica a nuevo.vue - precarga
// customData del registro (GET /api/records/:slug/:id) y actualiza via PUT.
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

const formValues = ref<Record<string, unknown>>({})
watchEffect(() => {
  if (record.value) formValues.value = { ...record.value.customData }
})

const formRef = ref<{ validateAll: () => boolean } | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submitted = ref(false)

async function onSubmit() {
  submitError.value = null
  submitted.value = false
  if (!formRef.value?.validateAll()) return

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
  <div class="mx-auto max-w-xl rounded-lg border border-brand-border-light bg-brand-surface p-6 shadow-[0_1px_3px_0_#33475B14]">
    <h1 class="text-lg font-bold text-brand-text">
      Editar registro{{ data?.entity?.name ? ` - ${data.entity.name}` : '' }}
    </h1>

    <p v-if="pending || recordPending" class="mt-4 text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError || recordError" class="mt-4 text-sm text-brand-error-text">
      No se pudo cargar el registro o la definicion de esta entidad.
    </p>

    <template v-else-if="data && record">
      <form class="mt-4 flex flex-col gap-4" @submit.prevent="onSubmit">
        <DynamicForm ref="formRef" v-model="formValues" :fields="data.fields" :disabled="submitting" />

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

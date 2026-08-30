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
  <div class="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    <h1 class="text-lg font-semibold text-gray-900">
      Editar registro{{ data?.entity?.name ? ` - ${data.entity.name}` : '' }}
    </h1>

    <p v-if="pending || recordPending" class="mt-4 text-sm text-gray-500">Cargando...</p>
    <p v-else-if="fetchError || recordError" class="mt-4 text-sm text-red-600">
      No se pudo cargar el registro o la definicion de esta entidad.
    </p>

    <template v-else-if="data && record">
      <form class="mt-4 flex flex-col gap-4" @submit.prevent="onSubmit">
        <DynamicForm ref="formRef" v-model="formValues" :fields="data.fields" :disabled="submitting" />

        <p v-if="submitError" class="text-sm text-red-600">{{ submitError }}</p>
        <p v-if="submitted" class="text-sm text-green-700">Cambios guardados correctamente.</p>

        <div class="flex justify-end gap-2">
          <NuxtLink :to="`/registros/${slug}`" class="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            Volver al listado
          </NuxtLink>
          <button
            type="submit"
            :disabled="submitting"
            class="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {{ submitting ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

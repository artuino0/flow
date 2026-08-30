<script setup lang="ts">
// HU-ERD-23: pagina generica de alta de registro para cualquier entidad -
// arma el formulario a partir de GET /api/entities/:slug/fields (DynamicForm)
// y crea el registro via POST /api/records/:slug. Reemplazable mas adelante
// por las pantallas de modulo especificas (ERD-32) sin cambiar el motor.
definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string

const { data, pending, error: fetchError } = await useEntityFields(slug)

const formValues = ref<Record<string, unknown>>({})
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
    await $fetch(`/api/records/${slug}`, {
      method: 'POST',
      body: { customData: formValues.value }
    })
    formValues.value = {}
    submitted.value = true
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || 'No se pudo crear el registro'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    <h1 class="text-lg font-semibold text-gray-900">
      Nuevo registro{{ data?.entity?.name ? ` - ${data.entity.name}` : '' }}
    </h1>

    <p v-if="pending" class="mt-4 text-sm text-gray-500">Cargando formulario...</p>
    <p v-else-if="fetchError" class="mt-4 text-sm text-red-600">No se pudo cargar la definicion de esta entidad.</p>

    <template v-else-if="data">
      <p v-if="data.fields.length === 0" class="mt-4 text-sm text-gray-500">
        Esta entidad todavia no tiene campos configurados.
      </p>

      <form v-else class="mt-4 flex flex-col gap-4" @submit.prevent="onSubmit">
        <DynamicForm ref="formRef" v-model="formValues" :fields="data.fields" :disabled="submitting" />

        <p v-if="submitError" class="text-sm text-red-600">{{ submitError }}</p>
        <p v-if="submitted" class="text-sm text-green-700">Registro creado correctamente.</p>

        <div class="flex justify-end gap-2">
          <button
            type="submit"
            :disabled="submitting"
            class="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {{ submitting ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

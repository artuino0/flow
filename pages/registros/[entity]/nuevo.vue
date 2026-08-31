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

async function onSubmit() {
  submitError.value = null
  if (!formRef.value?.validateAll()) return

  submitting.value = true
  try {
    await $fetch(`/api/records/${slug}`, {
      method: 'POST',
      body: { customData: formValues.value }
    })
    await navigateTo(`/registros/${slug}`)
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || 'No se pudo crear el registro'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl rounded-lg border border-brand-border-light bg-brand-surface p-6 shadow-[0_1px_3px_0_#33475B14]">
    <h1 class="text-lg font-bold text-brand-text">
      Nuevo registro{{ data?.entity?.name ? ` - ${data.entity.name}` : '' }}
    </h1>

    <p v-if="pending" class="mt-4 text-sm text-brand-text-muted">Cargando formulario...</p>
    <p v-else-if="fetchError" class="mt-4 text-sm text-brand-error-text">No se pudo cargar la definicion de esta entidad.</p>

    <template v-else-if="data">
      <p v-if="data.fields.length === 0" class="mt-4 text-sm text-brand-text-muted">
        Esta entidad todavia no tiene campos configurados.
      </p>

      <form v-else class="mt-4 flex flex-col gap-4" @submit.prevent="onSubmit">
        <DynamicForm ref="formRef" v-model="formValues" :fields="data.fields" :disabled="submitting" />

        <p v-if="submitError" class="text-sm text-brand-error-text">{{ submitError }}</p>

        <div class="flex justify-end gap-2">
          <NuxtLink
            :to="`/registros/${slug}`"
            class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
          >
            Cancelar
          </NuxtLink>
          <button
            type="submit"
            :disabled="submitting"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ submitting ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

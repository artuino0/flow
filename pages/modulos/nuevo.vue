<script setup lang="ts">
// HU-ERD-69: alta de un modulo (entity). Pagina dedicada, no un panel dentro
// del listado (pages/modulos/index.vue) - el diseno de Screen/Listado
// Modulos en el .pen no trae ningun formulario inline, solo un boton "Crear
// modulo" que navega. Este formulario es deliberadamente minimo (nombre +
// slug + descripcion, contra POST /api/entities de HU-ERD-66) - el asistente
// completo con vista previa en vivo y elegir campos es HU-ERD-70, todavia
// sin implementar; esto ya deja un modulo utilizable de punta a punta.
definePageMeta({ layout: 'default' })

const router = useRouter()

const name = ref('')
const slug = ref('')
const description = ref('')
const error = ref<string | null>(null)
const saving = ref(false)

async function onSubmit() {
  error.value = null
  saving.value = true
  try {
    await $fetch('/api/entities', {
      method: 'POST',
      body: { name: name.value, slug: slug.value, description: description.value || null }
    })
    await router.push('/modulos')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'No se pudo crear el modulo'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <h1 class="text-[22px] font-bold text-brand-text">Crear módulo</h1>
      <NuxtLink to="/modulos" class="text-sm font-semibold text-brand-text-secondary hover:underline">Volver al listado</NuxtLink>
    </div>

    <div class="flex max-w-lg flex-col gap-4 rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
      <div class="flex flex-col gap-1.5">
        <label for="modulo-name" class="text-[13px] font-semibold text-brand-text">Nombre <span class="text-brand-error-text">*</span></label>
        <input
          id="modulo-name"
          v-model="name"
          type="text"
          required
          class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="modulo-slug" class="text-[13px] font-semibold text-brand-text">Slug <span class="text-brand-error-text">*</span></label>
        <input
          id="modulo-slug"
          v-model="slug"
          type="text"
          required
          placeholder="ej. proyectos"
          class="w-full rounded border border-brand-border px-3 py-[9px] font-mono text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
        <p class="text-xs text-brand-text-muted">Solo minúsculas, números y guiones. No se puede cambiar después de creado.</p>
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="modulo-description" class="text-[13px] font-semibold text-brand-text">Descripción</label>
        <textarea
          id="modulo-description"
          v-model="description"
          rows="2"
          class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>

      <p v-if="error" class="text-sm text-brand-error-text">{{ error }}</p>

      <div>
        <button
          type="button"
          :disabled="saving || !name || !slug"
          class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onSubmit"
        >
          {{ saving ? 'Creando...' : 'Crear módulo' }}
        </button>
      </div>
    </div>
  </div>
</template>

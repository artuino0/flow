<script setup lang="ts">
// HU-ERD-69: edicion de un modulo (entity) - pagina dedicada, mismo patron
// que pages/roles/[id].vue (edicion en pagina propia, no en un panel del
// listado). El slug es inmutable aca a proposito (ya se usa en URLs
// /registros/:slug y en GET /api/entities/:slug/fields, HU-ERD-23) - mismo
// criterio que PUT /api/entities/:id (HU-ERD-66), que ya lo excluye del body.
definePageMeta({ layout: 'default' })

interface ModuleDetail {
  id: string
  slug: string
  name: string
  description: string | null
}

const route = useRoute()
const router = useRouter()
const moduleId = route.params.id as string

// No existe GET /api/entities/:id puntual - se resuelve del listado ya
// existente (GET /api/entities, HU-ERD-69) en vez de sumar otro endpoint
// solo para esto.
const { data, pending, error: fetchError } = await useFetch<{ entities: ModuleDetail[] }>('/api/entities', {
  key: 'modulos-list',
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const currentModule = computed(() => data.value?.entities.find((m) => m.id === moduleId) ?? null)

const name = ref('')
const description = ref('')
watchEffect(() => {
  if (currentModule.value) {
    name.value = currentModule.value.name
    description.value = currentModule.value.description ?? ''
  }
})

const saveError = ref<string | null>(null)
const saving = ref(false)
const saved = ref(false)

async function onSave() {
  saveError.value = null
  saved.value = false
  saving.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, {
      method: 'PUT',
      body: { name: name.value, description: description.value || null }
    })
    saved.value = true
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo guardar el módulo'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <h1 class="text-[22px] font-bold text-brand-text">
        Editar módulo{{ currentModule ? ` - ${currentModule.name}` : '' }}
      </h1>
      <NuxtLink to="/modulos" class="text-sm font-semibold text-brand-text-secondary hover:underline">Volver al listado</NuxtLink>
    </div>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar el módulo{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>
    <p v-else-if="!currentModule" class="text-sm text-brand-error-text">Este módulo no existe.</p>

    <div v-else class="flex max-w-lg flex-col gap-4 rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
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
        <label for="modulo-slug" class="text-[13px] font-semibold text-brand-text">Slug</label>
        <input
          id="modulo-slug"
          :value="currentModule.slug"
          type="text"
          disabled
          class="w-full rounded border border-brand-border bg-brand-bg px-3 py-[9px] font-mono text-sm text-brand-text-muted"
        />
        <p class="text-xs text-brand-text-muted">El slug no se puede cambiar una vez creado el módulo.</p>
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

      <p v-if="saveError" class="text-sm text-brand-error-text">{{ saveError }}</p>
      <p v-if="saved" class="text-sm text-brand-success-text">Módulo guardado correctamente.</p>

      <div class="flex items-center gap-3">
        <button
          type="button"
          :disabled="saving || !name"
          class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onSave"
        >
          {{ saving ? 'Guardando...' : 'Guardar cambios' }}
        </button>
        <button type="button" class="text-sm font-semibold text-brand-text-secondary hover:underline" @click="router.push('/modulos')">
          Cancelar
        </button>
      </div>
    </div>
  </div>
</template>

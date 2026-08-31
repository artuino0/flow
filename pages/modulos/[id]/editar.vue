<script setup lang="ts">
// HU-ERD-69/HU-ERD-70: edicion de un modulo (entity) - pagina dedicada, mismo
// patron que pages/roles/[id].vue. El slug es inmutable a proposito (ya se
// usa en URLs /registros/:slug y en GET /api/entities/:slug/fields).
//
// HU-ERD-70 extiende esta pagina para administrar los campos del modulo
// reusando EXACTAMENTE los mismos componentes que el paso 2 del asistente
// de creacion (pages/modulos/nuevo.vue) - criterio de aceptacion explicito
// de la HU: "editar un modulo existente reusa el mismo componente".
import { Blocks } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

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

// Campos del modulo (HU-ERD-70) - mismos componentes ModuleFieldsCard /
// ModulePreviewCard que pages/modulos/nuevo.vue, cargados via el slug real
// del modulo (GET /api/entities/:slug/fields, HU-ERD-23/67). Se usa useFetch
// (no un $fetch suelto en un watch) para que la cookie se reenvie en SSR
// igual que en el fetch del modulo de arriba - un $fetch sin headers durante
// SSR no lleva la cookie de sesion y el endpoint responde 401.
const { data: fieldsData, refresh: refreshFields } = await useFetch<{ fields: EntityFieldMeta[] }>(
  () => `/api/entities/${currentModule.value?.slug ?? ''}/fields`,
  {
    key: 'modulo-fields',
    immediate: !!currentModule.value,
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  }
)
const fields = computed(() => fieldsData.value?.fields ?? [])
async function loadFields() {
  await refreshFields()
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

    <template v-else>
      <div class="flex items-center gap-3">
        <div class="flex h-[38px] w-[38px] items-center justify-center rounded bg-brand-blue-bg">
          <Blocks class="h-[19px] w-[19px] text-brand-blue" :stroke-width="1.75" />
        </div>
        <div class="flex flex-col">
          <span class="text-[15px] font-bold text-brand-text">{{ currentModule.name }}</span>
          <span class="rounded-full bg-brand-neutral-bg px-2 py-0.5 font-mono text-xs text-brand-text-secondary">/{{ currentModule.slug }}</span>
        </div>
      </div>

      <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
        <div class="border-b border-brand-border-light p-5">
          <h2 class="text-[15px] font-bold text-brand-text">Información básica</h2>
        </div>
        <div class="flex flex-col gap-4 p-5">
          <div class="flex flex-col gap-1.5">
            <label for="modulo-name" class="text-[13px] font-semibold text-brand-text">Nombre <span class="text-brand-error-text">*</span></label>
            <input
              id="modulo-name"
              v-model="name"
              type="text"
              required
              class="w-full max-w-md rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="modulo-slug" class="text-[13px] font-semibold text-brand-text">Slug</label>
            <input
              id="modulo-slug"
              :value="currentModule.slug"
              type="text"
              disabled
              class="w-full max-w-md rounded border border-brand-border bg-brand-bg px-3 py-[9px] font-mono text-sm text-brand-text-muted"
            />
            <p class="text-xs text-brand-text-muted">El slug no se puede cambiar una vez creado el módulo.</p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="modulo-description" class="text-[13px] font-semibold text-brand-text">Descripción</label>
            <textarea
              id="modulo-description"
              v-model="description"
              rows="2"
              class="w-full max-w-md rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
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

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <ModuleFieldsCard :entity-id="currentModule.id" :fields="fields" @changed="loadFields" />
        <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" />
      </div>
    </template>
  </div>
</template>

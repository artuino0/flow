<script setup lang="ts">
// HU-ERD-70: asistente "Crear módulo" - wizard de 2 pasos, siguiendo
// Screen/Crear Módulo Paso1 + Screen/Editor de Campos del .pen (revisado con
// las herramientas de Pencil, no inferido). Paso 1 (informacion basica) crea
// el modulo de verdad contra POST /api/entities (HU-ERD-66) al hacer clic en
// "Continuar" - no hay un modo "borrador" en el backend, asi que el modulo ya
// queda persistido a partir de ahi (con 0 campos hasta que se agreguen en el
// paso 2). Paso 2 (campos) administra entity_fields en tiempo real contra los
// endpoints de HU-ERD-67 via components/ModuleFieldsCard.vue - cada campo
// agregado/editado/borrado ahi ya es un cambio real, no algo que se "guarda"
// recien al terminar el asistente. "Cancelar" en el paso 2 (y "Guardar
// módulo"/salir sin agregar campos) deja el modulo ya creado, posiblemente
// vacio - se puede borrar despues desde /modulos si no se quiere, igual que
// cualquier otro modulo sin registros.
import { ArrowRight, Blocks, Check, ChevronRight } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

definePageMeta({ layout: 'default' })

const router = useRouter()

const step = ref<'basica' | 'campos'>('basica')

const name = ref('')
const slug = ref('')
const description = ref('')
const slugTouched = ref(false)
const createError = ref<string | null>(null)
const creating = ref(false)

// Autogenera el slug desde el nombre hasta que el usuario lo edite a mano -
// criterio de aceptacion HU-ERD-70 ("el slug se genera automaticamente desde
// el nombre, editable antes de guardar").
const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g')
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
watch(name, (value) => {
  if (!slugTouched.value) slug.value = slugify(value)
})
function onSlugInput(value: string) {
  slugTouched.value = true
  slug.value = value
}

const entityId = ref<string | null>(null)
const fields = ref<EntityFieldMeta[]>([])

async function loadFields() {
  if (!slug.value) return
  const res = await $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${slug.value}/fields`)
  fields.value = res.fields
}

async function onContinue() {
  createError.value = null
  creating.value = true
  try {
    const entity = await $fetch<{ id: string; slug: string }>('/api/entities', {
      method: 'POST',
      body: { name: name.value, slug: slug.value, description: description.value || null }
    })
    entityId.value = entity.id
    step.value = 'campos'
    await loadFields()
  } catch (err: any) {
    createError.value = err?.data?.statusMessage || 'No se pudo crear el módulo'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <NuxtLink to="/modulos" class="text-brand-text-secondary hover:underline">Módulos</NuxtLink>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <span class="font-bold text-brand-text">{{ step === 'basica' ? 'Nuevo módulo' : 'Campos' }}</span>
    </div>

    <template v-if="step === 'basica'">
      <div class="flex flex-col gap-1">
        <h1 class="text-[22px] font-bold text-brand-text">Nuevo módulo</h1>
        <p class="text-sm text-brand-text-secondary">Define el nombre del módulo. Después vas a poder agregar sus campos.</p>
      </div>

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-orange text-[13px] font-bold text-white">1</span>
          <span class="text-sm font-bold text-brand-text">Información básica</span>
        </div>
        <div class="h-px flex-1 max-w-[120px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">2</span>
          <span class="text-sm font-semibold text-brand-text-muted">Campos</span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Información básica</h2>
          </div>

          <div class="flex flex-col gap-4 p-5">
            <div class="flex flex-col gap-1.5">
              <label for="modulo-name" class="text-[13px] font-semibold text-brand-text">Nombre del módulo</label>
              <input
                id="modulo-name"
                v-model="name"
                type="text"
                class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
              <p class="text-xs text-brand-text-muted">Así se mostrará en el menú lateral y en los listados.</p>
            </div>

            <div class="flex flex-col gap-1.5">
              <label for="modulo-slug" class="text-[13px] font-semibold text-brand-text">Slug (identificador único)</label>
              <div class="flex w-full items-center rounded border border-brand-border px-3 py-[9px] focus-within:border-brand-blue focus-within:ring-1 focus-within:ring-brand-blue">
                <span class="font-mono text-sm text-brand-text-muted">/registros/</span>
                <input
                  id="modulo-slug"
                  type="text"
                  :value="slug"
                  class="w-full font-mono text-sm font-semibold text-brand-text focus:outline-none"
                  @input="onSlugInput(($event.target as HTMLInputElement).value)"
                />
              </div>
              <p class="text-xs text-brand-text-muted">Se autogenera desde el nombre. Puedes editarlo; se usa en la URL del módulo.</p>
            </div>

            <div class="flex flex-col gap-1.5">
              <label for="modulo-description" class="text-[13px] font-semibold text-brand-text">Descripción</label>
              <textarea
                id="modulo-description"
                v-model="description"
                rows="2"
                class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
              <p class="text-xs text-brand-text-muted">Opcional. Ayuda a otros usuarios a entender para qué sirve este módulo.</p>
            </div>
          </div>

          <p v-if="createError" class="mx-5 mb-2 text-sm text-brand-error-text">{{ createError }}</p>

          <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
            <NuxtLink to="/modulos" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
            <button
              type="button"
              :disabled="!name || !slug || creating"
              class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              @click="onContinue"
            >
              {{ creating ? 'Creando...' : 'Continuar' }}
              <ArrowRight class="h-4 w-4" :stroke-width="1.75" />
            </button>
          </div>
        </div>

        <ModulePreviewCard :module-name="name" :module-description="description" :fields="[]" />
      </div>
    </template>

    <template v-else-if="entityId">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-[38px] w-[38px] items-center justify-center rounded bg-brand-blue-bg">
            <Blocks class="h-[19px] w-[19px] text-brand-blue" :stroke-width="1.75" />
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-2">
              <span class="text-[15px] font-bold text-brand-text">{{ name }}</span>
              <span class="rounded-full bg-brand-neutral-bg px-2 py-0.5 font-mono text-xs text-brand-text-secondary">/{{ slug }}</span>
            </div>
            <p class="text-sm text-brand-text-secondary">Configura los campos que va a tener este módulo</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <NuxtLink to="/modulos" class="rounded border border-brand-border px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover"
            @click="router.push('/modulos')"
          >
            <Check class="h-4 w-4" :stroke-width="1.75" />
            Guardar módulo
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-success-text text-white">
            <Check class="h-3.5 w-3.5" :stroke-width="2.5" />
          </span>
          <span class="text-sm font-bold text-brand-text">Información básica</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-orange text-[13px] font-bold text-white">2</span>
          <span class="text-sm font-bold text-brand-text">Campos</span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <ModuleFieldsCard :entity-id="entityId" :fields="fields" @changed="loadFields" />
        <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" />
      </div>
    </template>
  </div>
</template>

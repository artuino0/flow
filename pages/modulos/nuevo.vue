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
import type { DetailLayout, EntityFieldMeta, InverseRelation, ListLayout } from '~/composables/useEntityFields'

definePageMeta({ layout: 'default' })

const router = useRouter()

// HU-ERD-74/75: asistente de 4 pasos (Screen/Diseño del Detalle + Screen/Table
// Builder del .pen). "Guardar diseño" del paso 3 ("Diseño del detalle") ya no
// termina el asistente - avanza al paso 4 ("Diseño del listado"), que es el
// que ahora cierra el flujo.
const step = ref<'basica' | 'campos' | 'detalle' | 'listado'>('basica')

const name = ref('')
const slug = ref('')
const description = ref('')
const slugTouched = ref(false)
const createError = ref<string | null>(null)
const creating = ref(false)

// Autogenera el slug desde el nombre hasta que el usuario lo edite a mano -
// criterio de aceptacion HU-ERD-70 ("el slug se genera automaticamente desde
// el nombre, editable antes de guardar"). slugify() vive en utils/slugify.ts
// (auto-importado) - reusado tal cual en HU-ERD-71 para el value autogenerado
// de las opciones de Select/Multiselect y el name de columnas de Tabla.
watch(name, (value) => {
  if (!slugTouched.value) slug.value = slugify(value)
})
function onSlugInput(value: string) {
  slugTouched.value = true
  slug.value = value
}

const entityId = ref<string | null>(null)
const fields = ref<EntityFieldMeta[]>([])
const inverseRelations = ref<InverseRelation[]>([])
const detailLayout = ref<DetailLayout>({ properties: [], relations: [], showActivity: false })
const listLayout = ref<ListLayout>({ columns: [], filterFields: [], defaultSort: null })

async function loadFields() {
  if (!slug.value) return
  const res = await $fetch<{
    fields: EntityFieldMeta[]
    inverseRelations: InverseRelation[]
    detailLayout: DetailLayout
    listLayout: ListLayout
  }>(`/api/entities/${slug.value}/fields`)
  fields.value = res.fields
  inverseRelations.value = res.inverseRelations
  detailLayout.value = res.detailLayout
  listLayout.value = res.listLayout
}

const savingDetailLayout = ref(false)
const detailLayoutError = ref<string | null>(null)
async function onSaveDetailLayout() {
  if (!entityId.value) return
  detailLayoutError.value = null
  savingDetailLayout.value = true
  try {
    await $fetch(`/api/entities/${entityId.value}`, { method: 'PUT', body: { detailLayout: detailLayout.value } })
    step.value = 'listado'
  } catch (err: any) {
    detailLayoutError.value = err?.data?.statusMessage || 'No se pudo guardar el diseño del detalle'
  } finally {
    savingDetailLayout.value = false
  }
}

// HU-ERD-75: cuarto y ultimo paso del asistente - "Guardar diseño" acá si
// termina el flujo (vuelve a /modulos, como hacia el paso 3 antes de esta HU).
const savingListLayout = ref(false)
const listLayoutError = ref<string | null>(null)
async function onSaveListLayout() {
  if (!entityId.value) return
  listLayoutError.value = null
  savingListLayout.value = true
  try {
    await $fetch(`/api/entities/${entityId.value}`, { method: 'PUT', body: { listLayout: listLayout.value } })
    router.push('/modulos')
  } catch (err: any) {
    listLayoutError.value = err?.data?.statusMessage || 'No se pudo guardar el diseño del listado'
  } finally {
    savingListLayout.value = false
  }
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
      <span class="font-bold text-brand-text">
        {{ step === 'basica' ? 'Nuevo módulo' : step === 'campos' ? 'Campos' : step === 'detalle' ? 'Diseño del detalle' : 'Diseño del listado' }}
      </span>
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
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">2</span>
          <span class="text-sm font-semibold text-brand-text-muted">Campos</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">3</span>
          <span class="text-sm font-semibold text-brand-text-muted">Diseño del detalle</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">4</span>
          <span class="text-sm font-semibold text-brand-text-muted">Diseño del listado</span>
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

    <template v-else-if="step === 'campos' && entityId">
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
            @click="step = 'detalle'"
          >
            Continuar
            <ArrowRight class="h-4 w-4" :stroke-width="1.75" />
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
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">3</span>
          <span class="text-sm font-semibold text-brand-text-muted">Diseño del detalle</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">4</span>
          <span class="text-sm font-semibold text-brand-text-muted">Diseño del listado</span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <ModuleFieldsCard :entity-id="entityId" :entity-name="name" :fields="fields" @changed="loadFields" />
        <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" :entity-id="entityId ?? undefined" />
      </div>
    </template>

    <!-- HU-ERD-74: paso 3, "Diseño del detalle" - ver components/ModuleDetailLayoutCard.vue
         (configurador) y components/RecordDetailView.vue (vista previa, el
         MISMO componente que renderiza la ficha real de un registro). -->
    <template v-else-if="step === 'detalle' && entityId">
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
            <p class="text-sm text-brand-text-secondary">Configurá qué información aparece en la ficha de un registro y en qué orden</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <NuxtLink to="/modulos" class="rounded border border-brand-border px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
          <button
            type="button"
            :disabled="savingDetailLayout"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSaveDetailLayout"
          >
            <Check class="h-4 w-4" :stroke-width="1.75" />
            {{ savingDetailLayout ? 'Guardando...' : 'Guardar diseño' }}
          </button>
        </div>
      </div>

      <p v-if="detailLayoutError" class="text-sm text-brand-error-text">{{ detailLayoutError }}</p>

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-success-text text-white">
            <Check class="h-3.5 w-3.5" :stroke-width="2.5" />
          </span>
          <span class="text-sm font-bold text-brand-text">Información básica</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-success-text text-white">
            <Check class="h-3.5 w-3.5" :stroke-width="2.5" />
          </span>
          <span class="text-sm font-bold text-brand-text">Campos</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-orange text-[13px] font-bold text-white">3</span>
          <span class="text-sm font-bold text-brand-text">Diseño del detalle</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-brand-border text-[13px] font-bold text-brand-text-muted">4</span>
          <span class="text-sm font-semibold text-brand-text-muted">Diseño del listado</span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <ModuleDetailLayoutCard v-model="detailLayout" :fields="fields" :inverse-relations="inverseRelations" />
        <RecordDetailView :entity-slug="slug" :entity-name="name" :fields="fields" :layout="detailLayout" :inverse-relations="inverseRelations" :record="null" />
      </div>
    </template>

    <!-- HU-ERD-75: paso 4, "Diseño del listado" (Table Builder) - ver
         components/ModuleListLayoutCard.vue (configurador) y
         components/ModuleListPreviewCard.vue (vista previa, reusa
         DynamicTable.vue, el MISMO componente del listado real). -->
    <template v-else-if="step === 'listado' && entityId">
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
            <p class="text-sm text-brand-text-secondary">Configurá qué columnas se muestran en el listado, qué filtros están disponibles y el orden por defecto</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <NuxtLink to="/modulos" class="rounded border border-brand-border px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
          <button
            type="button"
            :disabled="savingListLayout"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSaveListLayout"
          >
            <Check class="h-4 w-4" :stroke-width="1.75" />
            {{ savingListLayout ? 'Guardando...' : 'Guardar diseño' }}
          </button>
        </div>
      </div>

      <p v-if="listLayoutError" class="text-sm text-brand-error-text">{{ listLayoutError }}</p>

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-success-text text-white">
            <Check class="h-3.5 w-3.5" :stroke-width="2.5" />
          </span>
          <span class="text-sm font-bold text-brand-text">Información básica</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-success-text text-white">
            <Check class="h-3.5 w-3.5" :stroke-width="2.5" />
          </span>
          <span class="text-sm font-bold text-brand-text">Campos</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-success-text text-white">
            <Check class="h-3.5 w-3.5" :stroke-width="2.5" />
          </span>
          <span class="text-sm font-bold text-brand-text">Diseño del detalle</span>
        </div>
        <div class="h-px flex-1 max-w-[80px] bg-brand-border" />
        <div class="flex items-center gap-2">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-orange text-[13px] font-bold text-white">4</span>
          <span class="text-sm font-bold text-brand-text">Diseño del listado</span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <ModuleListLayoutCard v-model="listLayout" :fields="fields" />
        <ModuleListPreviewCard :entity-slug="slug" :entity-name="name" :fields="fields" :list-layout="listLayout" />
      </div>
    </template>
  </div>
</template>

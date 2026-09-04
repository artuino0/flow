<script setup lang="ts">
// ERD-86: asistente de 4 pasos, extraido de pages/modulos/nuevo.vue (HU-ERD-70/74/75)
// para poder reusarlo tal cual desde pages/catalogos/nuevo.vue (nueva) - un
// catalogo (moduleKind='dimension') es un modulo igual que cualquier otro
// (mismos campos/diseño de detalle/diseño de listado), la UNICA diferencia
// real es el campo interno moduleKind que se manda al crear (ver comentario
// largo en server/db/schema.ts) y a donde vuelve el flujo al cancelar/terminar.
// Sin mock propio en el .pen para "Catálogos" (confirmado listando los
// Screen/* existentes) - se reusa el mismo diseño de Screen/Crear Módulo
// Paso1 de punta a punta via este componente, en vez de inferir un layout
// nuevo, porque es la MISMA pantalla en los dos puntos de entrada.
import { ArrowRight, Blocks, Check, ChevronRight } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, InverseRelation, ListLayout } from '~/composables/useEntityFields'
import type { ModuleKind } from '~/server/utils/moduleEntities'

const props = defineProps<{
  // '/modulos' o '/catalogos' - a donde vuelven Cancelar y el fin del asistente.
  basePath: string
  // 'hecho' o 'dimension' - mandado en el POST inicial, nunca elegido por el
  // usuario en el formulario (ver comentario largo en server/db/schema.ts).
  moduleKind: ModuleKind
  // Plural para el breadcrumb ("Módulos" / "Catálogos").
  sectionLabel: string
  // Singular en minuscula, para los textos del paso 1 ("módulo" / "catálogo").
  noun: string
  // Texto de ayuda bajo "Nombre" - donde va a aparecer este modulo una vez
  // creado (menu lateral para hechos, la pantalla de Catálogos para dimension).
  nameHelperText: string
}>()

const router = useRouter()

const step = ref<'basica' | 'campos' | 'detalle' | 'listado'>('basica')

const name = ref('')
const slug = ref('')
const description = ref('')
const slugTouched = ref(false)
const createError = ref<string | null>(null)
const creating = ref(false)

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

const savingListLayout = ref(false)
const listLayoutError = ref<string | null>(null)
async function onSaveListLayout() {
  if (!entityId.value) return
  listLayoutError.value = null
  savingListLayout.value = true
  try {
    await $fetch(`/api/entities/${entityId.value}`, { method: 'PUT', body: { listLayout: listLayout.value } })
    router.push(props.basePath)
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
      body: { name: name.value, slug: slug.value, description: description.value || null, moduleKind: props.moduleKind }
    })
    entityId.value = entity.id
    step.value = 'campos'
    await loadFields()
  } catch (err: any) {
    createError.value = err?.data?.statusMessage || `No se pudo crear el ${props.noun}`
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
      <NuxtLink :to="basePath" class="text-brand-text-secondary hover:underline">{{ sectionLabel }}</NuxtLink>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <span class="font-bold text-brand-text">
        {{ step === 'basica' ? `Nuevo ${noun}` : step === 'campos' ? 'Campos' : step === 'detalle' ? 'Diseño del detalle' : 'Diseño del listado' }}
      </span>
    </div>

    <template v-if="step === 'basica'">
      <div class="flex flex-col gap-1">
        <h1 class="text-[22px] font-bold text-brand-text">Nuevo {{ noun }}</h1>
        <p class="text-sm text-brand-text-secondary">Define el nombre del {{ noun }}. Después vas a poder agregar sus campos.</p>
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
              <label for="modulo-name" class="text-[13px] font-semibold text-brand-text">Nombre del {{ noun }}</label>
              <input
                id="modulo-name"
                v-model="name"
                type="text"
                class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
              <p class="text-xs text-brand-text-muted">{{ nameHelperText }}</p>
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
              <p class="text-xs text-brand-text-muted">Se autogenera desde el nombre. Puedes editarlo; se usa en la URL del {{ noun }}.</p>
            </div>

            <div class="flex flex-col gap-1.5">
              <label for="modulo-description" class="text-[13px] font-semibold text-brand-text">Descripción</label>
              <textarea
                id="modulo-description"
                v-model="description"
                rows="2"
                class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
              <p class="text-xs text-brand-text-muted">Opcional. Ayuda a otros usuarios a entender para qué sirve este {{ noun }}.</p>
            </div>
          </div>

          <p v-if="createError" class="mx-5 mb-2 text-sm text-brand-error-text">{{ createError }}</p>

          <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
            <NuxtLink :to="basePath" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
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
            <p class="text-sm text-brand-text-secondary">Configura los campos que va a tener este {{ noun }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <NuxtLink :to="basePath" class="rounded border border-brand-border px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
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
            <p class="text-sm text-brand-text-secondary">Configura qué información aparece en la ficha de un registro y en qué orden</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <NuxtLink :to="basePath" class="rounded border border-brand-border px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
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
            <p class="text-sm text-brand-text-secondary">Configura qué columnas se muestran en el listado, qué filtros están disponibles y el orden por defecto</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <NuxtLink :to="basePath" class="rounded border border-brand-border px-4 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
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

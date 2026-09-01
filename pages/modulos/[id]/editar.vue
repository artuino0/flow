<script setup lang="ts">
// HU-ERD-69/HU-ERD-70: edicion de un modulo (entity) - pagina dedicada, mismo
// patron que pages/roles/[id].vue. El slug es inmutable a proposito (ya se
// usa en URLs /registros/:slug y en GET /api/entities/:slug/fields).
//
// HU-ERD-70 extiende esta pagina para administrar los campos del modulo
// reusando EXACTAMENTE los mismos componentes que el paso 2 del asistente
// de creacion (pages/modulos/nuevo.vue) - criterio de aceptacion explicito
// de la HU: "editar un modulo existente reusa el mismo componente".
//
// Fix (feedback directo del usuario, 2026-08-31): la primera version de esta
// extension mostraba la card de "Informacion basica" Y la de "Campos del
// modulo"/vista previa al mismo tiempo, en una sola pantalla larga - no
// coincide con Screen/Editor de Campos del .pen, que muestra el indicador de
// pasos con SOLO uno de los dos visible a la vez (paso 1 "Informacion
// basica" completado en verde, paso 2 "Campos" activo - nunca los dos
// contenidos juntos). Se corrige con el mismo toggle "step" del asistente
// (pages/modulos/nuevo.vue), con la diferencia de que aca todos los pasos ya
// estan disponibles desde el principio (el modulo ya existe con sus datos
// basicos Y sus campos) - a diferencia del asistente, donde un paso recien
// se desbloquea al completar el anterior - asi que el indicador de pasos es
// clickeable en las dos direcciones, no solo hacia adelante.
//
// HU-ERD-74 suma el paso 3 "Diseño del detalle" con el mismo criterio.
// HU-ERD-75 suma el paso 4 "Diseño del listado" (Table Builder), tambien
// clickeable libremente como los otros tres.
import { Blocks, Check } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, InverseRelation, ListLayout } from '~/composables/useEntityFields'

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

const step = ref<'basica' | 'campos' | 'detalle' | 'listado'>('basica')

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
const { data: fieldsData, refresh: refreshFields } = await useFetch<{
  fields: EntityFieldMeta[]
  inverseRelations: InverseRelation[]
  detailLayout: DetailLayout
  listLayout: ListLayout
}>(
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

// HU-ERD-74: paso 3 "Diseño del detalle" - borrador local sincronizado desde
// el layout YA RESUELTO por el servidor (con defaults/reconciliacion, ver
// server/utils/detailLayout.ts) cada vez que fieldsData cambia (mismo
// criterio que name/description arriba con watchEffect), y guardado explicito
// via "Guardar diseño" (no se persiste en cada click, a diferencia de
// ModuleFieldsCard que si guarda cada cambio de inmediato contra su propio endpoint).
const inverseRelations = computed(() => fieldsData.value?.inverseRelations ?? [])
const detailLayout = ref<DetailLayout>({ properties: [], relations: [], showActivity: false })
watchEffect(() => {
  if (fieldsData.value) detailLayout.value = fieldsData.value.detailLayout
})

const savingDetailLayout = ref(false)
const detailLayoutError = ref<string | null>(null)
const detailLayoutSaved = ref(false)
async function onSaveDetailLayout() {
  detailLayoutError.value = null
  detailLayoutSaved.value = false
  savingDetailLayout.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'PUT', body: { detailLayout: detailLayout.value } })
    detailLayoutSaved.value = true
  } catch (err: any) {
    detailLayoutError.value = err?.data?.statusMessage || 'No se pudo guardar el diseño del detalle'
  } finally {
    savingDetailLayout.value = false
  }
}

// HU-ERD-75: paso 4 "Diseño del listado" - mismo criterio que el paso 3 de
// arriba (borrador local sincronizado desde el layout ya resuelto por el
// servidor, guardado explicito via "Guardar diseño").
const listLayout = ref<ListLayout>({ columns: [], filterFields: [], defaultSort: null })
watchEffect(() => {
  if (fieldsData.value) listLayout.value = fieldsData.value.listLayout
})

const savingListLayout = ref(false)
const listLayoutError = ref<string | null>(null)
const listLayoutSaved = ref(false)
async function onSaveListLayout() {
  listLayoutError.value = null
  listLayoutSaved.value = false
  savingListLayout.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'PUT', body: { listLayout: listLayout.value } })
    listLayoutSaved.value = true
  } catch (err: any) {
    listLayoutError.value = err?.data?.statusMessage || 'No se pudo guardar el diseño del listado'
  } finally {
    savingListLayout.value = false
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

      <!-- Indicador de pasos - mismo look que pages/modulos/nuevo.vue, pero
           clickeable en las dos direcciones (el modulo ya existe completo,
           no hay "paso bloqueado"). Solo UN paso se muestra por vez. -->
      <div class="flex items-center gap-3">
        <button type="button" class="flex items-center gap-2" @click="step = 'basica'">
          <span
            class="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold"
            :class="step === 'basica' ? 'bg-brand-orange text-white' : 'bg-brand-success-text text-white'"
          >
            <Check v-if="step !== 'basica'" class="h-3.5 w-3.5" :stroke-width="2.5" />
            <template v-else>1</template>
          </span>
          <span class="text-sm font-bold" :class="step === 'basica' ? 'text-brand-text' : 'text-brand-text-secondary'">Información básica</span>
        </button>
        <div class="h-px w-20 bg-brand-border" />
        <button type="button" class="flex items-center gap-2" @click="step = 'campos'">
          <span
            class="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold"
            :class="step === 'campos' ? 'bg-brand-orange text-white' : 'border border-brand-border text-brand-text-muted'"
          >2</span>
          <span class="text-sm font-bold" :class="step === 'campos' ? 'text-brand-text' : 'text-brand-text-secondary'">Campos</span>
        </button>
        <div class="h-px w-20 bg-brand-border" />
        <button type="button" class="flex items-center gap-2" @click="step = 'detalle'">
          <span
            class="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold"
            :class="step === 'detalle' ? 'bg-brand-orange text-white' : 'border border-brand-border text-brand-text-muted'"
          >3</span>
          <span class="text-sm font-bold" :class="step === 'detalle' ? 'text-brand-text' : 'text-brand-text-secondary'">Diseño del detalle</span>
        </button>
        <div class="h-px w-20 bg-brand-border" />
        <button type="button" class="flex items-center gap-2" @click="step = 'listado'">
          <span
            class="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold"
            :class="step === 'listado' ? 'bg-brand-orange text-white' : 'border border-brand-border text-brand-text-muted'"
          >4</span>
          <span class="text-sm font-bold" :class="step === 'listado' ? 'text-brand-text' : 'text-brand-text-secondary'">Diseño del listado</span>
        </button>
      </div>

      <template v-if="step === 'basica'">
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
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
            </div>

            <p v-if="saveError" class="mx-5 mb-2 text-sm text-brand-error-text">{{ saveError }}</p>
            <p v-if="saved" class="mx-5 mb-2 text-sm text-brand-success-text">Módulo guardado correctamente.</p>

            <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
              <NuxtLink to="/modulos" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
              <button
                type="button"
                :disabled="saving || !name"
                class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
                @click="onSave"
              >
                {{ saving ? 'Guardando...' : 'Guardar cambios' }}
              </button>
            </div>
          </div>

          <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" />
        </div>
      </template>

      <template v-else-if="step === 'campos'">
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <ModuleFieldsCard :entity-id="currentModule.id" :fields="fields" @changed="loadFields" />
          <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" />
        </div>
      </template>

      <!-- HU-ERD-74: paso 3 - ver components/ModuleDetailLayoutCard.vue
           (configurador) y components/RecordDetailView.vue (vista previa en
           vivo, el mismo componente que renderiza la ficha real). -->
      <template v-else-if="step === 'detalle'">
        <p v-if="detailLayoutError" class="text-sm text-brand-error-text">{{ detailLayoutError }}</p>
        <p v-if="detailLayoutSaved" class="text-sm text-brand-success-text">Diseño del detalle guardado correctamente.</p>
        <div class="flex justify-end">
          <button
            type="button"
            :disabled="savingDetailLayout"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSaveDetailLayout"
          >
            {{ savingDetailLayout ? 'Guardando...' : 'Guardar diseño' }}
          </button>
        </div>
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <ModuleDetailLayoutCard v-model="detailLayout" :fields="fields" :inverse-relations="inverseRelations" />
          <RecordDetailView
            :entity-slug="currentModule.slug"
            :entity-name="currentModule.name"
            :fields="fields"
            :layout="detailLayout"
            :inverse-relations="inverseRelations"
            :record="null"
          />
        </div>
      </template>

      <!-- HU-ERD-75: paso 4 - ver components/ModuleListLayoutCard.vue
           (configurador) y components/ModuleListPreviewCard.vue (vista previa,
           reusa DynamicTable.vue, el mismo componente del listado real). -->
      <template v-else>
        <p v-if="listLayoutError" class="text-sm text-brand-error-text">{{ listLayoutError }}</p>
        <p v-if="listLayoutSaved" class="text-sm text-brand-success-text">Diseño del listado guardado correctamente.</p>
        <div class="flex justify-end">
          <button
            type="button"
            :disabled="savingListLayout"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSaveListLayout"
          >
            {{ savingListLayout ? 'Guardando...' : 'Guardar diseño' }}
          </button>
        </div>
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <ModuleListLayoutCard v-model="listLayout" :fields="fields" />
          <ModuleListPreviewCard
            :entity-slug="currentModule.slug"
            :entity-name="currentModule.name"
            :fields="fields"
            :list-layout="listLayout"
          />
        </div>
      </template>
    </template>
  </div>
</template>

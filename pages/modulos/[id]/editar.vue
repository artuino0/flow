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
import { Blocks, Trash2 } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, InverseRelation, ListLayout } from '~/composables/useEntityFields'

definePageMeta({ layout: 'default' })

interface ModuleDetail {
  id: string
  slug: string
  name: string
  description: string | null
  // Rediseno "Editar Módulo" (Screen/Editar Módulo del .pen, revisado con las
  // herramientas de Pencil antes de este cambio) - switch "Módulo activo".
  isActive: boolean
}

// Rediseno "Editar Módulo": el indicador de 4 pasos con circulos se
// reemplaza por una barra de pestañas (Tab/Active - Tab/Default del .pen),
// con una 5ta pestaña "Vista previa" que no existia antes. Se mantienen las
// mismas 5 secciones/claves internas de siempre (name/description/isActive
// en "basica", ModuleFieldsCard en "campos", los mismos configuradores de
// ERD-74/75 en "detalle"/"listado") - el rediseno solo cambia la NAVEGACION
// entre ellas, no su contenido ni su forma de guardar. El .pen solo dibuja 3
// pestañas (Información general/Campos/Vista previa, sin "Diseño del
// detalle" ni "Diseño del listado" propias) - se agregan esas 2 como
// pestañas mas siguiendo el mismo look, decision confirmada con el usuario.
const TABS = [
  { key: 'basica', label: 'Información general' },
  { key: 'campos', label: 'Campos' },
  { key: 'detalle', label: 'Diseño del detalle' },
  { key: 'listado', label: 'Diseño del listado' },
  { key: 'preview', label: 'Vista previa' }
] as const
type StepKey = (typeof TABS)[number]['key']

const route = useRoute()
const router = useRouter()
const moduleId = route.params.id as string

const step = ref<StepKey>('basica')

// No existe GET /api/entities/:id puntual - se resuelve del listado ya
// existente (GET /api/entities, HU-ERD-69) en vez de sumar otro endpoint
// solo para esto.
const { data, pending, error: fetchError, refresh } = await useFetch<{ entities: ModuleDetail[] }>('/api/entities', {
  key: 'modulos-list',
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const currentModule = computed(() => data.value?.entities.find((m) => m.id === moduleId) ?? null)

const name = ref('')
const description = ref('')
const isActive = ref(true)
watchEffect(() => {
  if (currentModule.value) {
    name.value = currentModule.value.name
    description.value = currentModule.value.description ?? ''
    isActive.value = currentModule.value.isActive
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
      body: { name: name.value, description: description.value || null, isActive: isActive.value }
    })
    saved.value = true
    await refresh()
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo guardar el módulo'
  } finally {
    saving.value = false
  }
}

// Rediseno "Editar Módulo": "Zona de peligro" (Card Danger del .pen) - mismo
// mecanismo de borrado que pages/modulos/index.vue (DELETE /api/entities/:id,
// bloqueado con 409 si el modulo tiene records - HU-ERD-66), ahora tambien
// disponible desde la propia pagina de edicion, no solo desde el listado.
const deleteError = ref<string | null>(null)
const deleting = ref(false)
async function onDeleteModule() {
  if (!currentModule.value) return
  if (!confirm(`Eliminar el modulo "${currentModule.value.name}"? Esta accion no se puede deshacer.`)) return

  deleteError.value = null
  deleting.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'DELETE' })
    await router.push('/modulos')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el módulo'
  } finally {
    deleting.value = false
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
          <div class="flex items-center gap-2">
            <span class="text-[15px] font-bold text-brand-text">{{ currentModule.name }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="currentModule.isActive ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-neutral-bg text-brand-neutral-text'"
            >{{ currentModule.isActive ? 'Activo' : 'Inactivo' }}</span>
          </div>
          <span class="text-xs text-brand-text-secondary">
            <span class="font-mono">/{{ currentModule.slug }}</span> · {{ fields.length }} campo{{ fields.length === 1 ? '' : 's' }}
          </span>
        </div>
      </div>

      <!-- Rediseno "Editar Módulo" (Tab/Active - Tab/Default del .pen,
           revisado con las herramientas de Pencil): barra de pestañas en vez
           del indicador de pasos con circulos anterior - todas siempre
           clickeables (el modulo ya existe completo, no hay "paso
           bloqueado"). Solo UNA pestaña se muestra por vez. -->
      <div class="flex gap-8 border-b border-brand-border-light">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="relative flex flex-col items-center gap-2.5 pb-2.5 pt-1"
          @click="step = tab.key"
        >
          <span class="text-sm" :class="step === tab.key ? 'font-bold text-brand-orange' : 'font-semibold text-brand-text-secondary'">{{ tab.label }}</span>
          <!-- Reportado por el usuario (2026-09-01): el acento naranja de la
               pestaña activa quedaba "flotando" arriba del borde gris del
               contenedor (`border-b` de arriba), con un hueco visible entre
               los dos, porque el span vivia adentro del flujo normal del
               boton (empujado por pb-2.5). Se saca del flujo (absolute) y se
               ancla al mismo borde inferior del boton con `-bottom-px` (1px,
               el mismo grosor de `border-b`), asi el acento queda pegado
               justo sobre la linea gris, sin hueco. -->
          <span class="absolute inset-x-0 -bottom-px h-0.5 rounded-full" :class="step === tab.key ? 'bg-brand-orange' : 'bg-transparent'" />
        </button>
      </div>

      <template v-if="step === 'basica'">
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div class="flex flex-col gap-5">
            <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
              <div class="border-b border-brand-border-light p-5">
                <h2 class="text-[15px] font-bold text-brand-text">Información del módulo</h2>
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
                  <label for="modulo-description" class="text-[13px] font-semibold text-brand-text">Descripción</label>
                  <textarea
                    id="modulo-description"
                    v-model="description"
                    rows="2"
                    class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  />
                </div>

                <!-- Rediseno "Editar Módulo": el "Slug" pasa a llamarse "Ruta"
                     (mismo dato, mismo criterio de solo-lectura de siempre -
                     ya se usa en URLs /registros/:slug y en
                     GET /api/entities/:slug/fields, HU-ERD-23). -->
                <div class="flex flex-col gap-1.5">
                  <label for="modulo-slug" class="text-[13px] font-semibold text-brand-text">Ruta</label>
                  <input
                    id="modulo-slug"
                    :value="`/${currentModule.slug}`"
                    type="text"
                    disabled
                    class="w-full rounded border border-brand-border bg-brand-bg px-3 py-[9px] font-mono text-sm text-brand-text-muted"
                  />
                  <p class="text-xs text-brand-text-muted">La ruta no se puede editar una vez creado el módulo.</p>
                </div>

                <div class="h-px bg-brand-border-light" />

                <!-- Rediseno "Editar Módulo": switch "Módulo activo" (Switch
                     Row del .pen) - se guarda junto con el resto de esta
                     tarjeta via "Guardar cambios" (no es un toggle
                     inmediato); el bloqueo real para roles NO administrador
                     lo aplica requirePermission() (server/utils/rbac.ts). -->
                <div class="flex items-center justify-between">
                  <div class="flex flex-col gap-0.5">
                    <p class="text-sm font-semibold text-brand-text">Módulo activo</p>
                    <p class="text-xs text-brand-text-muted">Los usuarios podrán ver y usar este módulo</p>
                  </div>
                  <button
                    type="button"
                    class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
                    :class="isActive ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
                    @click="isActive = !isActive"
                  >
                    <span class="h-[18px] w-[18px] rounded-full bg-white shadow" />
                  </button>
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

            <!-- Rediseno "Editar Módulo": "Zona de peligro" (Card Danger del
                 .pen) - mismo mecanismo de borrado que pages/modulos/index.vue
                 (DELETE /api/entities/:id, bloqueado con 409 si el modulo
                 tiene records, HU-ERD-66), ahora disponible tambien desde
                 aca, no solo desde el listado. -->
            <div class="flex flex-col rounded-lg border border-brand-error-text/30 bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
              <div class="border-b border-brand-error-text/30 p-5">
                <h2 class="text-[15px] font-bold text-brand-error-text">Zona de peligro</h2>
              </div>
              <div class="flex items-center justify-between gap-4 p-5">
                <div class="flex flex-col gap-0.5">
                  <p class="text-sm font-semibold text-brand-text">Eliminar módulo</p>
                  <p class="text-xs text-brand-text-muted">Esta acción no se puede deshacer. Se eliminarán todos los registros de {{ currentModule.name }}.</p>
                </div>
                <button
                  type="button"
                  :disabled="deleting"
                  class="flex shrink-0 items-center gap-1.5 rounded border border-brand-error-text bg-brand-surface px-4 py-2 text-sm font-semibold text-brand-error-text hover:bg-brand-error-bg disabled:cursor-not-allowed disabled:opacity-60"
                  @click="onDeleteModule"
                >
                  <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  {{ deleting ? 'Eliminando...' : 'Eliminar módulo' }}
                </button>
              </div>
              <p v-if="deleteError" class="mx-5 mb-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ deleteError }}</p>
            </div>
          </div>

          <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" />
        </div>
      </template>

      <template v-else-if="step === 'campos'">
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <ModuleFieldsCard :entity-id="currentModule.id" :entity-name="currentModule.name" :fields="fields" @changed="loadFields" />
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

      <!-- HU-ERD-75: paso "Diseño del listado" - ver components/ModuleListLayoutCard.vue
           (configurador) y components/ModuleListPreviewCard.vue (vista previa,
           reusa DynamicTable.vue, el mismo componente del listado real). -->
      <template v-else-if="step === 'listado'">
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

      <!-- Rediseno "Editar Módulo": pestaña "Vista previa" (Tab Vista Previa
           del .pen) - sin mock propio en el archivo (las 2 pantallas
           revisadas solo muestran "Información general"/"Campos" activas),
           asi que se interpreta como el mismo ModulePreviewCard de siempre
           pero a ancho completo, en vez de compartir columna con un
           configurador - le da a la vista previa el foco central que su
           nombre de pestaña promete. -->
      <template v-else>
        <div class="mx-auto w-full max-w-[480px]">
          <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" />
        </div>
      </template>
    </template>
  </div>
</template>

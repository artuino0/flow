<script setup lang="ts">
// HU-ERD-69/HU-ERD-70: edicion de un modulo (entity) - pagina dedicada con
// ruta propia (patron estandar de edicion en el repo para entidades que si
// tienen ruta individual; pages/roles/index.vue NO sigue este patron a
// proposito - ver el comentario largo ahi, es una pantalla unica por diseno).
// El slug es inmutable a proposito (ya se usa en URLs /registros/:slug y en
// GET /api/entities/:slug/fields).
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
//
// HU-ERD-77 suma la pestaña "Relaciones" (administracion de
// relation_definitions, ver components/ModuleRelationsCard.vue para el
// detalle de diseno - revisado en Pencil antes de construir, sin mock fiel
// para esta version simple, decision explicita del usuario 2026-09-01).
import { MODULE_EDIT_TAB_ANCHORS } from '~/utils/onboardingTours'
import { isAgendaBase } from '~/utils/agendaBase'
import { ChevronRight, Trash2 } from '@lucide/vue'
import ModuleNavigationEditor from '~/components/ModuleNavigationEditor.vue'
import ModuleApiDocs from '~/components/ModuleApiDocs.vue'
import type { BoardConfig, CalendarConfig, DetailLayout, EntityFieldMeta, EntityMeta, InverseRelation, ListLayout } from '~/composables/useEntityFields'
import { DEFAULT_LABEL_CONFIG, labelConfigSchema, type LabelConfig } from '~/utils/labelTemplates'

definePageMeta({ darkReady: true, layout: 'default', fullBleed: true })

interface ModuleDetail {
  templateKey?: string | null
  id: string
  slug: string
  name: string
  description: string | null
  // Rediseno "Editar Módulo" (Screen/Editar Módulo del .pen, revisado con las
  // herramientas de Pencil antes de este cambio) - switch "Módulo activo".
  isActive: boolean
  deletedAt: string | null
  // Pedido directo del usuario (2026-09-01): icono editable del modulo - ver
  // comentario largo en server/db/schema.ts.
  icon: string | null
  // ERD-86: solo para decidir a donde vuelve "Cancelar"/"Volver al listado"/
  // el borrado (/modulos o /catalogos) - nunca se edita desde aca (ver
  // comentario largo en server/db/schema.ts, no viaja en el PUT de onSave()).
  moduleKind: 'hecho' | 'dimension'
  // Pedido directo del usuario (2026-09-05) - ver comentario largo en
  // server/db/schema.ts (entities.singularName).
  singularName: string | null
  labelConfig?: LabelConfig | null
}

// Rediseno "Editar Módulo": el indicador de 4 pasos con circulos se
// reemplaza por una barra de pestañas (Tab/Active - Tab/Default del .pen),
// sin una pestaña separada de vista previa. Se mantienen las
// mismas 5 secciones/claves internas de siempre (name/description/isActive
// en "basica", ModuleFieldsCard en "campos", los mismos configuradores de
// ERD-74/75 en "detalle"/"listado") - el rediseno solo cambia la NAVEGACION
// entre ellas, no su contenido ni su forma de guardar. El .pen solo dibuja 3
// pestañas (Información general/Campos, sin "Diseño del
// detalle" ni "Diseño del listado" propias) - se agregan esas 2 como
// pestañas mas siguiendo el mismo look, decision confirmada con el usuario.
// La pestaña API vive dentro del módulo para mantener la documentación junto
// a sus campos y permisos reales.
const TABS = [
  { key: 'basica', label: 'Información general' },
  { key: 'campos', label: 'Campos' },
  { key: 'relaciones', label: 'Relaciones' },
  { key: 'navegacion', label: 'Ubicación en menú' },
  { key: 'detalle', label: 'Diseño del detalle' },
  { key: 'listado', label: 'Diseño del listado' },
  { key: 'flujo', label: 'Flujo de estados' },
  { key: 'etiquetas', label: 'Etiquetas' },
  { key: 'api', label: 'API' }
] as const

const route = useRoute()
const router = useRouter()
const moduleId = route.params.id as string

const step = useModuleEditTab(route, router)

// No existe GET /api/entities/:id puntual - se resuelve del listado ya
// existente (GET /api/entities, HU-ERD-69) en vez de sumar otro endpoint
// solo para esto.
//
// ERD-86: key propia 'entities-all-list' (SIN filtro de moduleKind) - esta
// pagina edita tanto modulos (moduleKind='hecho', entrada desde /modulos)
// como catalogos (moduleKind='dimension', entrada desde /catalogos), y
// entityOptions de abajo (select "Entidad relacionada" de
// ModuleRelationsCard.vue) necesita ver TODAS las entidades sin importar el
// tipo. Si usara la misma key 'modulos-list' que pages/modulos/index.vue
// (que ahora filtra a moduleKind=hecho), useFetch podria reusar ese payload
// cacheado y no encontrar un catalogo abierto desde /catalogos.
const { data, pending, error: fetchError, refresh } = await useFetch<{ entities: ModuleDetail[] }>('/api/entities', {
  key: 'entities-all-list',
  query: { deleted: 'all' },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const currentModule = computed(() => data.value?.entities.find((m) => m.id === moduleId) ?? null)
const agendaProtected = computed(() => Boolean(currentModule.value && isAgendaBase(currentModule.value)))
const clientModalOpen = ref(false)
async function onAgendaClientChanged() {
  clientModalOpen.value = false
  await loadFields()
}

// ERD-86: a donde vuelven "Cancelar"/"Volver al listado" y el redirect tras
// borrar - segun el tipo real del modulo que se esta editando, no siempre
// /modulos (un catalogo abierto desde /catalogos debe volver ahi).
const listBackTo = computed(() => (currentModule.value?.moduleKind === 'dimension' ? '/catalogos' : '/modulos'))

// HU-ERD-77: opciones para el select "Entidad relacionada" de
// ModuleRelationsCard.vue - reusa el mismo listado de modulos ya cargado
// arriba (GET /api/entities), sin sumar otro fetch aparte solo para esto.
const entityOptions = computed(() => (data.value?.entities ?? []).filter((m) => m.isActive && !m.deletedAt).map((m) => ({ id: m.id, name: m.name })))

const name = ref('')
const description = ref('')
const isActive = ref(true)
const icon = ref<string | null>(null)
const singularName = ref('')
const labelConfig = ref<LabelConfig>({ ...DEFAULT_LABEL_CONFIG })
// Seguimiento (2026-09-05, mismo dia): "queria que con js en el menu se
// pusiera en plural, no queria un campo nuevo" - ver comentario largo en
// components/ModuleWizard.vue (mismo campo, misma vista previa).
const singularNamePreview = computed(() => (singularName.value.trim() ? pluralize(singularName.value.trim()) : ''))
watchEffect(() => {
  if (currentModule.value) {
    name.value = currentModule.value.name
    description.value = currentModule.value.description ?? ''
    isActive.value = currentModule.value.isActive
    icon.value = currentModule.value.icon
    singularName.value = currentModule.value.singularName ?? ''
    labelConfig.value = labelConfigSchema.safeParse(currentModule.value.labelConfig).success
      ? { ...DEFAULT_LABEL_CONFIG, ...(currentModule.value.labelConfig as LabelConfig) }
      : { ...DEFAULT_LABEL_CONFIG }
  }
})

const saveError = ref<string | null>(null)
const saving = ref(false)

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts. Reemplaza los 3 avisos inline estaticos de
// esta pagina (saved/detailLayoutSaved/listLayoutSaved, uno por pestaña) por
// Toast/Editado (variante "updated") - quedaban ocultos si el usuario ya
// habia scrolleado, y la pantalla tiene 6 pestañas distintas que podian
// mostrar el mismo tipo de aviso suelto cada una.
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

async function onSave() {
  saveError.value = null
  saving.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, {
      method: 'PUT',
      body: {
        name: name.value,
        description: description.value || null,
        isActive: isActive.value,
        icon: icon.value,
        singularName: singularName.value.trim() || null
      }
    })
    toast.updated('Módulo actualizado', 'Los cambios se guardaron correctamente.')
    await refresh()
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo guardar el módulo'
    toast.error('No se pudo guardar el módulo', saveError.value)
  } finally {
    saving.value = false
  }
}

const savingLabelConfig = ref(false)
async function onSaveLabelConfig() {
  savingLabelConfig.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'PUT', body: { labelConfig: labelConfig.value } })
    toast.updated('Diseño de etiquetas guardado', labelConfig.value.enabled ? 'Ya puedes imprimir etiquetas desde el módulo.' : 'La impresión de etiquetas quedó desactivada.')
    await refresh()
  } catch (err: any) {
    toast.error('No se pudo guardar la etiqueta', err?.data?.statusMessage || 'Revisa los campos seleccionados.')
  } finally {
    savingLabelConfig.value = false
  }
}

// Rediseno "Editar Módulo": "Zona de peligro" (Card Danger del .pen) - mismo
// mecanismo de borrado recuperable que pages/modulos/index.vue, ahora tambien
// disponible desde la propia pagina de edicion, no solo desde el listado.
const deleteError = ref<string | null>(null)
const deleting = ref(false)
async function onDeleteModule() {
  if (!currentModule.value) return
  if (!await confirmAction({ title: 'Deshabilitar módulo', message: `¿Deshabilitar el módulo "${currentModule.value.name}"? Sus datos y referencias seguirán disponibles para consulta.`, confirmLabel: 'Deshabilitar', destructive: true })) return

  deleteError.value = null
  deleting.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'DELETE' })
    toast.success('Módulo deshabilitado', `"${currentModule.value.name}" se puede restaurar desde módulos borrados.`)
    await router.push(listBackTo.value)
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el módulo'
    toast.error('No se pudo eliminar el módulo', deleteError.value)
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
  entity: EntityMeta
  fields: EntityFieldMeta[]
  permissions: { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }
  inverseRelations: InverseRelation[]
  detailLayout: DetailLayout
  listLayout: ListLayout
  boardConfig: BoardConfig
  calendarConfig: CalendarConfig
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
async function onSaveDetailLayout() {
  detailLayoutError.value = null
  savingDetailLayout.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'PUT', body: { detailLayout: detailLayout.value } })
    toast.updated('Diseño del detalle guardado', 'Los cambios se guardaron correctamente.')
  } catch (err: any) {
    detailLayoutError.value = err?.data?.statusMessage || 'No se pudo guardar el diseño del detalle'
    toast.error('No se pudo guardar el diseño del detalle', detailLayoutError.value)
  } finally {
    savingDetailLayout.value = false
  }
}

// HU-ERD-75: paso 4 "Diseño del listado" - mismo criterio que el paso 3 de
// arriba (borrador local sincronizado desde el layout ya resuelto por el
// servidor, guardado explicito via "Guardar diseño").
const listLayout = ref<ListLayout>({ columns: [], filterFields: [], defaultSort: null })
const boardConfig = ref<BoardConfig>({ enabled: false, statusField: null, titleField: null, secondaryFields: [], defaultView: 'table' })
const calendarConfig = ref<CalendarConfig>({ enabled: false, startDateField: null, startTimeField: null, durationField: null, endField: null, titleField: null, colorField: null, groupByField: null, defaultView: 'month' })
watchEffect(() => {
  if (fieldsData.value) {
    listLayout.value = fieldsData.value.listLayout
    boardConfig.value = fieldsData.value.boardConfig
    calendarConfig.value = fieldsData.value.calendarConfig
  }
})

const savingListLayout = ref(false)
const listLayoutError = ref<string | null>(null)
async function onSaveListLayout() {
  listLayoutError.value = null
  savingListLayout.value = true
  try {
    await $fetch(`/api/entities/${moduleId}`, { method: 'PUT', body: { listLayout: listLayout.value, boardConfig: boardConfig.value, calendarConfig: calendarConfig.value } })
    toast.updated('Diseño del listado guardado', 'Los cambios se guardaron correctamente.')
  } catch (err: any) {
    listLayoutError.value = err?.data?.statusMessage || 'No se pudo guardar el diseño del listado'
    toast.error('No se pudo guardar el diseño del listado', listLayoutError.value)
  } finally {
    savingListLayout.value = false
  }
}
</script>

<template>
  <AgendaBaseModal :open="clientModalOpen" change-client @close="clientModalOpen = false" @changed="onAgendaClientChanged" />
  <div class="flex h-full min-w-0 flex-col overflow-y-auto bg-brand-bg">
    <header v-if="currentModule" class="min-w-0 bg-brand-surface">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-brand-border-light px-7 py-5">
      <div class="flex min-w-0 flex-col gap-1.5">
        <nav class="flex items-center gap-1 text-[13px] font-medium text-brand-text-muted" aria-label="Migas de pan">
          <NuxtLink :to="listBackTo" class="text-brand-text-secondary hover:text-brand-blue">{{ currentModule.moduleKind === 'dimension' ? 'Catálogos' : 'Módulos' }}</NuxtLink>
          <ChevronRight class="h-[13px] w-[13px]" :stroke-width="1.75" aria-hidden="true" />
          <span class="font-bold text-brand-text">{{ currentModule.name }}</span>
        </nav>
        <div class="flex min-w-0 flex-wrap items-center gap-2.5">
          <IconPicker v-model="icon" />
          <h1 class="min-w-0 truncate text-2xl font-bold text-brand-text">Editar módulo · {{ currentModule.name }}</h1>
          <span
            class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            :class="currentModule.deletedAt ? 'bg-brand-error-bg text-brand-error-text' : currentModule.isActive ? 'bg-brand-blue-bg text-brand-blue' : 'bg-brand-neutral-bg text-brand-neutral-text'"
          >{{ currentModule.deletedAt ? 'Borrado' : currentModule.isActive ? 'Activo' : 'Inactivo' }}</span>
        </div>
        <p class="text-[13px] text-brand-text-secondary"><span class="font-mono">/{{ currentModule.slug }}</span> · {{ fields.length }} campo{{ fields.length === 1 ? '' : 's' }}</p>
      </div>
      <NuxtLink :to="listBackTo" class="flex shrink-0 items-center gap-1.5 rounded border border-brand-border px-3.5 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
        <ChevronRight class="h-3.5 w-3.5 rotate-180" :stroke-width="1.75" aria-hidden="true" />
        Volver al listado
      </NuxtLink>
      </div>
      <nav aria-label="Secciones del módulo" class="h-[50px] min-w-0 overflow-x-auto overflow-y-hidden border-b border-brand-border-light px-[18px] [scrollbar-width:thin]">
        <div class="flex h-[49px] min-w-max flex-nowrap items-stretch">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            :data-tour="MODULE_EDIT_TAB_ANCHORS[tab.key]"
            type="button"
            class="relative flex h-[50px] shrink-0 items-center whitespace-nowrap px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand-blue"
            :class="step === tab.key ? 'font-bold text-brand-orange' : 'font-medium text-brand-text-secondary hover:text-brand-text'"
            :aria-current="step === tab.key ? 'page' : undefined"
            @click="step = tab.key"
          >
            {{ tab.label }}
            <span v-if="step === tab.key" class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-brand-orange" />
          </button>
        </div>
      </nav>
    </header>

    <div class="flex min-w-0 flex-col gap-5 p-7 max-sm:p-4">
    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar el módulo{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>
    <p v-else-if="!currentModule" class="text-sm text-brand-error-text">Este módulo no existe.</p>

    <template v-else>
      <template v-if="step === 'basica'">
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div class="flex flex-col gap-5">
            <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-light p-5">
                <div class="flex flex-col gap-1"><div class="flex items-center gap-2"><h2 class="text-[15px] font-bold text-brand-text">Información del módulo</h2><ModuleTourHelpButton tab="info" /></div><p class="text-sm text-brand-text-secondary">Ajusta el nombre, la descripción y la disponibilidad del módulo.</p></div>
                <button
                  type="button"
                  :disabled="saving || !name || !!currentModule.deletedAt"
                  class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
                  data-tour="edit-info-save"
                  @click="onSave"
                >
                  {{ saving ? 'Guardando...' : 'Guardar cambios' }}
                </button>
              </div>
              <div data-tour="edit-info-identity" class="flex flex-col gap-4 p-5">
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

                <!-- Pedido directo del usuario (2026-09-05): "hay manera de
                     calcular el plural? para que en el menu salga
                     Manifiestos, Empaques..." - ver comentario largo en
                     server/db/schema.ts (entities.singularName). Opcional:
                     vacio (default) deja "Nuevo X"/"Editar X" usando Nombre
                     tal cual, igual que siempre. -->
                <div class="flex flex-col gap-1.5">
                  <label for="modulo-singular-name" class="text-[13px] font-semibold text-brand-text">Nombre en singular</label>
                  <input
                    id="modulo-singular-name"
                    v-model="singularName"
                    type="text"
                    :placeholder="name || 'Ej. Empaque'"
                    class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  />
                  <p class="text-xs text-brand-text-muted">
                    Opcional. Se usa en "Nuevo"/"Editar" (ej. "Nuevo Empaque")<template v-if="singularNamePreview">
                      y en el menú se va a mostrar como "<strong>{{ singularNamePreview }}</strong>"</template>. Si se deja vacío, se usa el Nombre tal cual.
                  </p>
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
                <div data-tour="edit-info-active" class="flex items-center justify-between">
                  <div class="flex flex-col gap-0.5">
                    <p class="text-sm font-semibold text-brand-text">Módulo activo</p>
                    <p v-if="agendaProtected" class="text-xs text-brand-info-text">Citas base permanece activo y no se puede eliminar. Configura el vínculo de Cliente desde Campos.</p>
                    <p class="text-xs text-brand-text-muted">Si está deshabilitado, sus registros siguen disponibles para consulta.</p>
                  </div>
                  <button
                    type="button"
                    class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
                    :class="isActive ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
                    :disabled="agendaProtected || !!currentModule.deletedAt"
                    @click="isActive = !isActive"
                  >
                    <span class="h-[18px] w-[18px] rounded-full bg-brand-switch-thumb shadow" />
                  </button>
                </div>
              </div>

              <p v-if="saveError" class="mx-5 mb-2 text-sm text-brand-error-text">{{ saveError }}</p>

              <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
                <NuxtLink :to="listBackTo" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>

              </div>
            </div>

            <!-- Rediseno "Editar Módulo": "Zona de peligro" (Card Danger del
                 .pen) - mismo mecanismo de borrado que pages/modulos/index.vue
                 (DELETE /api/entities/:id, bloqueado con 409 si el modulo
                 tiene records, HU-ERD-66), ahora disponible tambien desde
                 aca, no solo desde el listado. -->
            <div class="flex flex-col rounded-lg border border-brand-error-text/30 bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
              <div class="border-b border-brand-error-text/30 p-5">
                <h2 class="text-[15px] font-bold text-brand-error-text">Zona de peligro</h2>
              </div>
              <div class="flex items-center justify-between gap-4 p-5">
                <div class="flex flex-col gap-0.5">
                  <p class="text-sm font-semibold text-brand-text">Eliminar módulo</p>
                  <p class="text-xs text-brand-text-muted">Se ocultará del menú y no admitirá registros ni referencias nuevas. Los datos existentes se conservan y podrás restaurarlo.</p>
                </div>
                <button
                  type="button"
                  :disabled="agendaProtected || deleting || !!currentModule.deletedAt"
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

          <ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" :entity-id="currentModule.id" />
        </div>
      </template>

      <template v-else-if="step === 'campos'">
        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div class="space-y-4">
            <div v-if="agendaProtected" role="status" class="rounded border border-brand-border-light bg-brand-info-bg p-4 text-sm text-brand-info-text">
              <p>Citas es un módulo base del sistema: no se elimina ni desactiva. Sus campos núcleo están protegidos. Puedes cambiar etiquetas y permisos por rol, agregar campos y partidas propias.</p>
              <button type="button" class="mt-3 rounded border border-brand-border bg-brand-surface px-3 py-2 font-semibold text-brand-blue hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" @click="clientModalOpen = true">Configurar vínculo de Cliente</button>
            </div>
            <ModuleFieldsCard :entity-id="currentModule.id" :entity-name="currentModule.name" :fields="fields" @changed="loadFields" />
          </div>
          <div data-tour="edit-fields-preview" class="min-w-0"><ModulePreviewCard :module-name="name" :module-description="description" :fields="fields" :entity-id="currentModule.id" /></div>
        </div>
      </template>

      <template v-else-if="step === 'relaciones'">
        <ModuleRelationsCard :entity-id="currentModule.id" :entity-name="currentModule.name" :entity-options="entityOptions" />
      </template>

      <!-- HU-ERD-74: paso 3 - ver components/ModuleDetailLayoutCard.vue
           (configurador) y components/RecordDetailView.vue (vista previa en
           vivo, el mismo componente que renderiza la ficha real). -->
      <template v-else-if="step === 'detalle'">
        <p v-if="detailLayoutError" class="text-sm text-brand-error-text">{{ detailLayoutError }}</p>

        <div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <ModuleDetailLayoutCard v-model="detailLayout" :fields="fields" :inverse-relations="inverseRelations">
            <template #actions>
              <button
                type="button"
                :disabled="savingDetailLayout"
                class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
                data-tour="edit-detail-save"
                @click="onSaveDetailLayout"
              >
                {{ savingDetailLayout ? 'Guardando...' : 'Guardar diseño' }}
              </button>
            </template>
          </ModuleDetailLayoutCard>
          <div data-tour="edit-detail-preview" class="min-w-0">
          <RecordDetailView
            :entity-id="currentModule.id"
            :entity-slug="currentModule.slug"
            :entity-name="currentModule.name"
            :fields="fields"
            :layout="detailLayout"
            :inverse-relations="inverseRelations"
            :record="null"
          />
          </div>
        </div>
      </template>

      <!-- HU-ERD-75: paso "Diseño del listado" - ver components/ModuleListLayoutCard.vue
           (configurador) y components/ModuleListPreviewCard.vue (vista previa,
           reusa DynamicTable.vue, el mismo componente del listado real). -->
      <template v-else-if="step === 'listado'">
        <p v-if="listLayoutError" class="text-sm text-brand-error-text">{{ listLayoutError }}</p>
        <ModuleListLayoutCard v-model="listLayout" v-model:board-config="boardConfig" v-model:calendar-config="calendarConfig" :fields="fields">
          <template #actions>
            <button
              type="button"
              :disabled="savingListLayout"
              class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              data-tour="edit-list-save"
              @click="onSaveListLayout"
            >
              {{ savingListLayout ? 'Guardando...' : 'Guardar diseño' }}
            </button>
          </template>
          <template #preview="{ activeView }">
            <ModuleListPreviewCard
              :entity-slug="currentModule.slug"
              :entity-name="currentModule.name"
              :fields="fields"
              :list-layout="listLayout"
              :active-view="activeView"
              :board-config="boardConfig"
              :calendar-config="calendarConfig"
            />
          </template>
        </ModuleListLayoutCard>
      </template>

      <template v-else-if="step === 'flujo'">
        <ModuleStateWorkflowCard :module-id="currentModule.id" :fields="fields" :config="fieldsData?.entity.workflowConfig" :selected-field="boardConfig.statusField" @saved="refreshFields" />
      </template>

      <template v-else-if="step === 'etiquetas'">

        <ModuleLabelEditor v-model="labelConfig" :fields="fields" :module-name="currentModule.name">
          <template #actions>
            <button
            type="button"
            :disabled="savingLabelConfig"
            class="shrink-0 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            data-tour="edit-labels-save"
            @click="onSaveLabelConfig"
          >
            {{ savingLabelConfig ? 'Guardando...' : 'Guardar etiqueta' }}
          </button>
          </template>
        </ModuleLabelEditor>
      </template>

      <template v-else-if="step === 'navegacion'">
        <div data-tour="edit-menu-context">
        <ModuleNavigationEditor v-if="currentModule.moduleKind === 'hecho'" :entity-id="currentModule.id" :entity-name="currentModule.name" />
        <section v-else class="flex max-w-2xl flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
          <div class="border-b border-brand-border-light p-5"><div class="flex items-center gap-2"><h2 class="text-[15px] font-bold text-brand-text">Ubicación en el menú</h2><ModuleTourHelpButton tab="menu" /></div></div>
          <p class="p-5 text-sm text-brand-text-secondary">Los catálogos no aparecen en el menú operativo. Se consultan desde los selectores de los módulos según los permisos del rol.</p>
        </section>
        </div>
      </template>
      <template v-else-if="step === 'api'">
        <ModuleApiDocs :entity-name="currentModule.name" :entity-slug="currentModule.slug" :fields="fields" :permissions="fieldsData?.permissions" />
      </template>
    </template>
    </div>
  </div>
</template>

<style scoped>
/* HU-164: controles nativos con el esquema del ámbito y el blanco claro original. */
:where(input, select, textarea) { color-scheme: inherit; }
:where(select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])):not([class*="bg-"]) { background-color: rgb(var(--brand-surface)); }
</style>

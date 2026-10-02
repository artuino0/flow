<script setup lang="ts">
// HU-ERD-74: "ficha" de un registro (Screen/Detalle Pedido del .pen,
// investigado en HU-ERD-72, y Screen/Diseño del Detalle en esta HU) - UN
// SOLO componente para dos usos: (a) la vista previa en vivo del
// configurador (pages/modulos/[id]/editar.vue, paso "Diseño del detalle",
// `record: null`) y (b) la ficha real de un registro
// (pages/registros/[entity]/[id]/index.vue, `record` con datos reales).
// Mismo principio ya establecido en ModulePreviewCard.vue (HU-ERD-70):
// "la vista previa usa el mismo componente que el resultado real, no una
// maqueta aparte" - por eso NO hay una version separada "solo para preview".
//
// En modo preview (record=null) las relaciones NO se buscan de verdad (no
// hay un id de registro real todavia) - se muestra el mismo texto que el
// .pen para ese estado ("Se muestra como tabla de solo lectura"), que
// coincide exactamente con lo que YA hacia el diseño en su propia vista
// previa - no es una simplificación nuestra, es lo que el diseño real muestra.
//
// Alcance dejado afuera, documentado: la tabla de una relación embebida
// muestra como maximo 5 filas (sin paginación propia) con un link "Ver
// todos" hacia el listado ya filtrado (HU-ERD-73) - una tabla embebida
// completamente interactiva por relación es más el terreno de HU-ERD-75
// (Table Builder), no de esta HU. La "línea de tiempo de actividad" es un
// toggle guardado (HU-ERD-74 solo pide poder configurarlo) pero no existe
// ningún historial de auditoría en el esquema hoy - se muestra un aviso
// honesto en vez de datos inventados; el historial real queda para una HU futura.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Calendar, Clock, Copy, EllipsisVertical, FileText, Link2, List, Pencil, Plus, Share2, Trash2, WalletCards } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, EntityPermissions, InverseRelation, StateWorkflowConfig } from '~/composables/useEntityFields'

interface RecordData {
  id: string
  customData: Record<string, unknown>
  createdAt?: string
  // Reportado por el usuario (2026-09-03): etiquetas ya resueltas para las
  // propiedades de tipo relation (ver server/utils/relationLabels.ts),
  // adjuntadas por GET /api/records/:entity/:id.
  relationLabels?: Record<string, Record<string, string>>
}

const props = defineProps<{
  entityId: string
  entitySlug: string
  entityName: string
  fields: EntityFieldMeta[]
  layout: DetailLayout
  inverseRelations: InverseRelation[]
  /** null = modo vista previa (configurador) - sin datos reales, sin fetch de relaciones. */
  record: RecordData | null
  canUpdate?: boolean
  canCreate?: boolean
  canDelete?: boolean
  // Reportado por el usuario (2026-09-03): entities.labelField de ESTA
  // entidad (no de una relacionada) - el encabezado de la ficha ("displayLabel"
  // de abajo) es exactamente "como se etiqueta un registro de esta entidad",
  // el mismo concepto que labelField configura para cuando esta entidad es
  // destino de una relacion en OTRO lado - mismo criterio, mismo dato.
  labelField?: string | null
  startInEdit?: boolean
  initialPane?: 'associations' | 'activity'
  initialActivityId?: string
  workflowConfig?: StateWorkflowConfig | null
  userRoleId?: string | null
}>()

const emit = defineEmits<{
  deleted: []
  // Se editaron líneas hijas: el padre pudo cambiar (rollups), la página lo recarga.
  changed: []
}>()

const actionMenuOpen = ref(false)
function closeActionMenu(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-record-actions]')) actionMenuOpen.value = false
}
onMounted(() => document.addEventListener('click', closeActionMenu))
onBeforeUnmount(() => document.removeEventListener('click', closeActionMenu))

// --- Puente al dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md, fase C) ----
// Los registros dinámicos que originan documentos fiscales ganan un acceso
// directo a /facturacion con el vínculo de origen pre-llenado
// (source_record_id / cobro). Convención de slugs de la Business Suite; la
// entrada es admin + país MX, mismo gate que la nav y los endpoints
// (requireMxBillingAdmin). En modo preview (record=null) nunca aparece.
const FISCAL_SOURCE_SLUGS: Record<string, { tipo: 'I' | 'P'; label: string }> = {
  cuentas_por_cobrar: { tipo: 'I', label: 'Generar factura' },
  embarques: { tipo: 'I', label: 'Generar factura' },
  cobros_cliente: { tipo: 'P', label: 'Complemento de pago' }
}
const { data: isAdminForFiscal } = useIsAdmin()
const { user: fiscalUser } = useAuth()
const fiscalAction = computed(() => {
  if (!props.record || !isAdminForFiscal.value || fiscalUser.value?.country !== 'MX') return null
  const def = FISCAL_SOURCE_SLUGS[props.entitySlug]
  if (!def) return null
  if (def.tipo === 'P' && props.record.customData?.estado !== 'aplicado') return null
  const param = def.tipo === 'P' ? `cobro=${props.record.id}` : `sourceRecord=${props.record.id}`
  return { label: def.label, to: `/facturacion/nuevo?tipo=${def.tipo}&${param}`, icon: def.tipo === 'P' ? WalletCards : FileText }
})

const visibleProperties = computed(() =>
  props.layout.properties
    .filter((p) => p.visible)
    .map((p) => props.fields.find((f) => f.name === p.name))
    .filter((f): f is EntityFieldMeta => Boolean(f))
)

const visibleRelations = computed(() =>
  props.layout.relations
    .filter((r) => r.visible)
    .map((r) => ({ ...r, meta: props.inverseRelations.find((i) => i.entitySlug === r.entitySlug && i.fieldName === r.fieldName) }))
    .filter((r) => r.meta)
)

const displayLabel = computed(() =>
  props.record
    ? labelForRecord(props.fields, props.record.customData, props.record.id, props.labelField)
    : `Ejemplo de ${props.entityName || 'este módulo'}`
)
function shareRecord() {
  if (!props.record) return
  void navigateTo({ path: '/chat', query: { shareEntity: props.entitySlug, shareRecord: props.record.id, shareLabel: displayLabel.value } })
}
const initials = computed(() => {
  const words = displayLabel.value.trim().split(/\s+/).filter(Boolean)
  const chars = words.length >= 2 ? [words[0][0], words[1][0]] : [displayLabel.value[0] ?? '?', displayLabel.value[1] ?? '']
  return chars.join('').toUpperCase()
})

const statusField = computed(() =>
  props.workflowConfig?.enabled ? props.fields.find(field => field.name === props.workflowConfig?.field) : props.fields.find((field) => ['estado', 'status', 'estatus'].includes(field.name.toLocaleLowerCase()))
)
const currentWorkflowState = computed(() => props.workflowConfig?.enabled && props.record ? props.workflowConfig.states[String(props.record.customData[props.workflowConfig.field] ?? '')] : undefined)
const isWorkflowLocked = computed(() => Boolean(currentWorkflowState.value?.locked))
const lockedEditableFields = computed(() => currentWorkflowState.value?.editableFields ?? [])
const canEditRecord = computed(() => Boolean(props.canUpdate && (!isWorkflowLocked.value || lockedEditableFields.value.length)))
const availableTransitions = computed(() => {
  if (!props.workflowConfig?.enabled || !props.record || !props.userRoleId) return []
  const current = String(props.record.customData[props.workflowConfig.field] ?? '')
  return props.workflowConfig.transitions.filter(item => item.from === current && (item.roles === 'all' || item.roles.includes(props.userRoleId!)))
})
const statusLabel = computed(() => {
  const field = statusField.value
  if (!field) return ''
  if (!props.record) return 'Estado'
  const value = formatValue(field, props.record.customData[field.name])
  return value === '-' ? '' : value
})

function formatValue(field: EntityFieldMeta, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (field.dataType) {
    case 'boolean':
      return value ? 'Sí' : 'No'
    case 'date': {
      return formatDate(value as string)
    }
    case 'currency':
      return formatCurrencyValue(value, field.validationRules)
    case 'select':
    case 'multiselect': {
      const options = Array.isArray(field.validationRules?.options) ? (field.validationRules.options as Array<{ value: string; label: string }>) : []
      const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v
      return Array.isArray(value) ? value.map(labelFor).join(', ') || '-' : labelFor(String(value))
    }
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value)
    // Reportado por el usuario (2026-09-03): antes caia al default (uuid
    // crudo) - misma etiqueta ya resuelta server-side que usa DynamicTable.vue.
    case 'relation':
      return props.record?.relationLabels?.[field.name]?.[String(value)] ?? String(value).slice(0, 8)
    case 'user':
      return (Array.isArray(value) ? value : [value]).map(id => props.record?.relationLabels?.[field.name]?.[String(id)] ?? `${String(id).slice(0, 8)} (inactivo)`).join(', ')
    case 'file':
      return 'Archivo'
    default:
      return String(value)
  }
}

// Relaciones: solo en modo real (record != null) - cada una trae hasta 5
// registros ya filtrados por GET /api/records/:entity?filterField=&filterValues=
// (HU-ERD-73), reusando DynamicTable.vue en modo solo-lectura (permisos
// de escritura en false, oculta la columna de Acciones).
interface RelatedTableState {
  fields: EntityFieldMeta[]
  rows: { id: string; customData: Record<string, unknown> }[]
  total: number
  loading: boolean
  canCreate: boolean
  // Reportado por el usuario (2026-09-03): la tabla embebida de una relacion
  // inversa puede tener SUS PROPIAS columnas relation (ej. Empaque listando
  // Recepciones, y esa lista mostrando a su vez su Productor) - mismas
  // etiquetas ya resueltas que trae GET /api/records/:entity.
  relationLabels: Record<string, Record<string, string>>
}
// Cantidad de tipos de asociación directa (record_relations) visibles para el usuario;
// null mientras RecordAssociationsPanel no terminó de consultarlos.
const directAssociationCount = ref<number | null>(null)
watch(() => props.record?.id, () => { directAssociationCount.value = null })
const hasAnyAssociationType = computed(() => visibleRelations.value.length > 0 || (directAssociationCount.value ?? 0) > 0)
const relatedTables = reactive<Record<string, RelatedTableState>>({})
const readOnlyPermissions: EntityPermissions = { canRead: true, canCreate: false, canUpdate: false, canDelete: false }
const activePane = ref<'associations' | 'activity'>(props.initialPane ?? (props.initialActivityId ? 'activity' : 'associations'))

async function loadRelatedTable(entitySlug: string, fieldName: string) {
  if (!props.record) return
  const key = `${entitySlug}.${fieldName}`
  relatedTables[key] = { fields: [], rows: [], total: 0, loading: true, canCreate: false, relationLabels: {} }
  try {
    const [fieldsRes, recordsRes] = await Promise.all([
      $fetch<{ fields: EntityFieldMeta[]; permissions: EntityPermissions }>(`/api/entities/${entitySlug}/fields`),
      $fetch<{ data: { id: string; customData: Record<string, unknown> }[]; total: number; relationLabels: Record<string, Record<string, string>> }>(
        `/api/records/${entitySlug}`,
        { query: { filterField: fieldName, filterValues: props.record.id, pageSize: 5 } }
      )
    ])
    relatedTables[key] = { fields: fieldsRes.fields, rows: recordsRes.data, total: recordsRes.total, loading: false, canCreate: !!fieldsRes.permissions?.canCreate, relationLabels: recordsRes.relationLabels }
  } catch {
    relatedTables[key] = { fields: [], rows: [], total: 0, loading: false, canCreate: false, relationLabels: {} }
  }
}

watch(
  () => [props.record?.id, visibleRelations.value.map((r) => `${r.entitySlug}.${r.fieldName}`).join(',')] as const,
  () => {
    if (!props.record) return
    for (const r of visibleRelations.value) if (!r.editable) void loadRelatedTable(r.entitySlug, r.fieldName)
  },
  { immediate: true }
)

function relatedListLink(entitySlug: string, fieldName: string): string {
  if (!props.record) return '#'
  return `/registros/${entitySlug}?filterField=${encodeURIComponent(fieldName)}&filterValues=${encodeURIComponent(props.record.id)}`
}

function relatedCreateLink(entitySlug: string, fieldName: string): string {
  if (!props.record) return '#'
  const from = `/registros/${props.entitySlug}/${props.record.id}`
  return `/registros/${entitySlug}/nuevo?${encodeURIComponent(fieldName)}=${encodeURIComponent(props.record.id)}&from=${encodeURIComponent(from)}`
}

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts.
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

const deleting = ref(false)
const duplicating = ref(false)
const deleteError = ref<string | null>(null)
async function onDuplicate() {
  if (!props.record || duplicating.value) return
  duplicating.value = true
  try {
    const copy = await $fetch<{ id: string }>(`/api/records/${props.entitySlug}/${props.record.id}/duplicate`, { method: 'POST' })
    await navigateTo({ path: `/registros/${props.entitySlug}/${copy.id}`, query: { duplicatedFrom: props.record.id } })
  } catch (error) {
    const message = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.error('No se pudo duplicar el registro', message || 'Inténtalo de nuevo.')
  } finally {
    duplicating.value = false
  }
}
async function onDelete() {
  if (!props.record) return
  if (!await confirmAction({ title: 'Eliminar registro', message: '¿Eliminar este registro? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', destructive: true })) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/records/${props.entitySlug}/${props.record.id}`, { method: 'DELETE' })
    toast.success('Registro eliminado', 'El registro se eliminó correctamente.')
    emit('deleted')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el registro'
    toast.error('No se pudo eliminar el registro', deleteError.value)
  } finally {
    deleting.value = false
  }
}
const isEditing = ref(false)
const submittingEdit = ref(false)
const editFormValues = ref<Record<string, unknown>>({})

function startEditing() {
  if (!props.record || !canEditRecord.value) return
  editFormValues.value = JSON.parse(JSON.stringify(props.record.customData))
  isEditing.value = true
}
watch(() => props.startInEdit, (value) => {
  if (value && props.record && canEditRecord.value) startEditing()
}, { immediate: true })

function cancelEditing() {
  isEditing.value = false
}

async function saveEdit() {
  if (!props.record) return
  submittingEdit.value = true
  try {
    await $fetch(`/api/records/${props.entitySlug}/${props.record.id}`, {
      method: 'PUT',
      body: { customData: editFormValues.value }
    })
    toast.success('Registro actualizado', 'Los cambios se guardaron correctamente.')
    // Refetch the data (since we rely on external data, we can emit or just reload window, 
    // but the easiest is just updating props if possible, or reload)
    window.location.reload()
  } catch (err: any) {
    toast.error('Error al guardar', err?.data?.statusMessage || 'No se pudo actualizar el registro')
  } finally {
    submittingEdit.value = false
  }
}

async function changeState(to: string, label?: string) {
  if (!props.record || !props.workflowConfig?.enabled) return
  const target = props.workflowConfig.states[to]
  if (target?.locked && !await confirmAction({ title: 'Cambiar estado', message: `¿${label || `Pasar a ${to}`}? El registro quedará bloqueado.`, confirmLabel: 'Cambiar estado' })) return
  try {
    const body = { changes: { [props.workflowConfig.field]: to } }
    try {
      await $fetch(`/api/records/${props.entitySlug}/${props.record.id}`, { method: 'PATCH', body })
    } catch (error) {
      const warnings = (error as { data?: { data?: { warnings?: string[] } } })?.data?.data?.warnings
      if (!warnings?.length || !await confirmAction({ title: 'Advertencias de transición', message: warnings.join('\n'), confirmLabel: 'Continuar de todos modos' })) throw error
      await $fetch(`/api/records/${props.entitySlug}/${props.record.id}`, { method: 'PATCH', body: { ...body, acknowledgeWarnings: true } })
    }
    const stateField = props.fields.find(field => field.name === props.workflowConfig?.field)
    const stateLabel = (stateField?.validationRules?.options as Array<{ value: string; label: string }> | undefined)?.find(option => option.value === to)?.label ?? to
    toast.updated('Estado actualizado', `El registro pasó a ${stateLabel}.`)
    window.location.reload()
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string; data?: { warnings?: string[] } } } | null)?.data?.statusMessage
    toast.error('No se pudo cambiar el estado', statusMessage || 'La transición no está permitida.')
  }
}
</script>

<template>
  <div
    class="grid grid-cols-1 items-start gap-5"
    :class="record ? 'lg:min-h-[calc(100vh-167px)] lg:grid-cols-[400px_minmax(0,1fr)]' : ''"
  >
    <aside class="flex min-w-0 flex-col gap-4 self-start">
      <section class="rounded-lg border border-brand-border-light bg-brand-surface">
        <div class="flex flex-col gap-3.5 p-5">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue-bg text-base font-bold text-brand-blue">{{ initials }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.04em] text-brand-text-muted">Detalle de {{ entityName }}</p>
              <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                <h1 class="min-w-0 break-words text-[18px] font-bold leading-6 text-brand-text">{{ displayLabel }}</h1>
                <span v-if="statusLabel" class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-neutral-bg px-2.5 py-[3px] text-[11px] font-semibold text-brand-text-secondary">
                  <span class="h-1.5 w-1.5 rounded-full bg-brand-text-muted" />
                  {{ statusLabel }}
                </span>
              </div>
              <p v-if="record?.createdAt" class="mt-1 flex items-center gap-1 text-[11px] text-brand-text-muted">
                <Calendar class="h-[11px] w-[11px] shrink-0" :stroke-width="1.75" />
                Creado el {{ new Date(record.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) }}
              </p>
              <p v-else-if="!record" class="mt-1 text-[11px] text-brand-text-muted">Así se verá la ficha de un registro de {{ entityName || 'este módulo' }}</p>
            </div>
          </div>

          <div v-if="record && availableTransitions.length" class="flex flex-wrap gap-2">
            <button v-for="transition in availableTransitions" :key="`${transition.from}-${transition.to}`" type="button" class="rounded bg-brand-blue px-3 py-2 text-xs font-semibold text-brand-primary-fg hover:opacity-90" @click="changeState(transition.to, transition.label)">{{ transition.label || `Pasar a ${(statusField?.validationRules?.options as Array<{ value: string; label: string }> | undefined)?.find(option => option.value === transition.to)?.label || transition.to}` }}</button>
          </div>
          <p v-if="record && isWorkflowLocked" class="text-xs text-brand-text-muted">Registro bloqueado por el estado actual.</p>

          <div v-if="record" class="flex w-full items-center gap-2">
            <template v-if="!isEditing">
              <button type="button" class="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded border border-brand-border px-3 text-[13px] font-semibold text-brand-blue hover:bg-brand-blue-bg" @click="shareRecord">
                <Share2 class="h-3.5 w-3.5" :stroke-width="1.75" /> Compartir
              </button>

              <button v-if="canEditRecord" type="button" class="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded border border-brand-border px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="startEditing">
                <Pencil class="h-3.5 w-3.5" :stroke-width="1.75" /> Editar
              </button>
              <div v-if="fiscalAction || canCreate || (canDelete && !isWorkflowLocked)" class="relative shrink-0" data-record-actions>
                <button
                  type="button"
                  title="Más acciones"
                  aria-label="Más acciones"
                  :aria-expanded="actionMenuOpen"
                  class="flex h-9 w-9 items-center justify-center rounded border border-brand-border-light text-brand-text-secondary hover:bg-brand-bg hover:text-brand-text"
                  @click.stop="actionMenuOpen = !actionMenuOpen"
                >
                  <EllipsisVertical class="h-4 w-4" :stroke-width="1.9" />
                </button>
                <div v-if="actionMenuOpen" class="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[210px] overflow-hidden rounded-md border border-brand-border-light bg-brand-surface py-1 shadow-[0_8px_24px_#33475B22]">
                  <button v-if="canCreate" type="button" :disabled="duplicating" class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg disabled:opacity-60" @click="actionMenuOpen = false; onDuplicate()">
                    <Copy class="h-4 w-4 shrink-0" :stroke-width="1.75" />{{ duplicating ? 'Duplicando…' : 'Duplicar' }}
                  </button>
                  <NuxtLink
                    v-if="fiscalAction"
                    :to="fiscalAction.to"
                    class="flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg hover:text-brand-blue"
                    @click="actionMenuOpen = false"
                  >
                    <component :is="fiscalAction.icon" class="h-4 w-4 shrink-0 text-brand-blue" :stroke-width="1.75" />
                    {{ fiscalAction.label }}
                  </NuxtLink>
                  <button
                    v-if="canDelete && !isWorkflowLocked"
                    type="button"
                    :disabled="deleting"
                    class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold text-brand-error-text hover:bg-brand-error-bg disabled:cursor-not-allowed disabled:opacity-60" :class="fiscalAction ? 'border-t border-brand-border-light' : ''"
                    @click="actionMenuOpen = false; onDelete()"
                  >
                    <Trash2 class="h-4 w-4 shrink-0" :stroke-width="1.75" />
                    {{ deleting ? 'Eliminando…' : 'Eliminar registro' }}
                  </button>
                </div>
              </div>
            </template>
            <template v-else>
              <button type="button" :disabled="submittingEdit" class="flex h-9 flex-1 items-center justify-center rounded border border-brand-border px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="cancelEditing">Cancelar</button>
              <button type="button" :disabled="submittingEdit" class="flex h-9 flex-1 items-center justify-center rounded bg-brand-orange px-3 text-[13px] font-semibold text-brand-primary-fg hover:bg-brand-orange-hover" @click="saveEdit">{{ submittingEdit ? 'Guardando…' : 'Guardar' }}</button>
            </template>
          </div>
          <p v-if="deleteError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ deleteError }}</p>
        </div>
      </section>

      <section class="relative rounded-lg border border-brand-border-light" :class="isEditing ? 'z-20 bg-brand-surface' : 'z-0 bg-brand-surface'">
        <header class="flex items-center gap-2 border-b border-brand-border-light px-[18px] py-3">
          <List class="h-3.5 w-3.5 text-brand-text-muted" :stroke-width="1.75" />
          <h2 class="text-xs font-bold tracking-[0.03em] text-brand-text-muted">Propiedades</h2>
        </header>
        <div v-if="visibleProperties.length === 0" class="px-[18px] py-6 text-sm text-brand-text-muted">Ninguna propiedad configurada para mostrarse en la ficha.</div>
        <div v-else-if="isEditing">
          <DynamicForm v-model="editFormValues" detail :fields="visibleProperties" :entity-id="entityId" :relation-labels="record?.relationLabels" :disabled="submittingEdit" :disabled-fields="isWorkflowLocked ? visibleProperties.filter(field => !lockedEditableFields.includes(field.name)).map(field => field.name) : []" />
        </div>
        <dl v-else>
          <div v-for="field in visibleProperties" :key="field.id" class="flex flex-col gap-[3px] border-b border-brand-border-light px-[18px] py-2.5 last:border-b-0">
            <dt class="text-[11px] font-semibold leading-4 text-brand-text-secondary">{{ field.label }}</dt>
            <dd class="break-words text-[13px] font-medium leading-[18px] text-brand-text">
              <DynamicFileValue v-if="field.dataType === 'file' && typeof record?.customData[field.name] === 'string'" :file-id="String(record?.customData[field.name])" />
              <FieldDateValue v-else-if="record && field.dataType === 'date'" :value="record.customData[field.name]" :rules="field.validationRules" />
              <template v-else>{{ record ? formatValue(field, record.customData[field.name]) : '—' }}</template>
            </dd>
          </div>
        </dl>
      </section>
    </aside>

    <section class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface" :class="record ? 'h-full min-h-[620px]' : 'min-h-[480px]'">
      <div class="flex h-[47px] shrink-0 items-stretch gap-5 border-b border-brand-border-light px-6" role="tablist" aria-label="Asociaciones y actividad">
        <button type="button" role="tab" :aria-selected="activePane === 'associations'" class="border-b-2 px-1 text-sm" :class="activePane === 'associations' ? 'border-brand-orange font-bold text-brand-text' : 'border-transparent font-medium text-brand-text-muted hover:text-brand-text'" @click="activePane = 'associations'">Asociaciones</button>
        <button type="button" role="tab" :aria-selected="activePane === 'activity'" class="border-b-2 px-1 text-sm" :class="activePane === 'activity' ? 'border-brand-orange font-bold text-brand-text' : 'border-transparent font-medium text-brand-text-muted hover:text-brand-text'" @click="activePane = 'activity'">Actividad</button>
      </div>

      <div v-if="activePane === 'associations'" class="flex min-h-0 flex-1 flex-col">
        <div v-if="!hasAnyAssociationType && (!record || directAssociationCount !== null)" class="flex flex-1 items-center justify-center p-10 text-center">
          <div class="flex max-w-[380px] flex-col items-center">
            <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-neutral-bg text-brand-text-muted"><Link2 class="h-[26px] w-[26px]" :stroke-width="1.75" /></span>
            <h3 class="mt-4 text-[15px] font-bold text-brand-text">Sin asociaciones</h3>
            <p class="mt-1 max-w-[340px] text-[13px] leading-5 text-brand-text-secondary">Este módulo no tiene tipos de asociación definidos ni otros módulos con un campo de relación hacia este registro.</p>
            <button v-if="record && canEditRecord" type="button" class="mt-4 flex items-center gap-1.5 rounded border border-brand-border px-3.5 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="startEditing">
              <Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Vincular registro
            </button>
          </div>
        </div>

        <div v-else class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">
          <RecordAssociationsPanel v-if="record" :key="`${entitySlug}:${record.id}`" :entity-slug="entitySlug" :record-id="record.id" @loaded="directAssociationCount = $event" />
          <div v-for="rel in visibleRelations" :key="`${rel.entitySlug}.${rel.fieldName}`" class="flex flex-col overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
            <div class="flex items-center justify-between gap-3 border-b border-brand-border-light px-4 py-3">
              <div class="flex flex-col gap-0.5">
                <h3 class="text-sm font-bold text-brand-text">{{ rel.meta!.entityName }}</h3>
                <p class="text-xs text-brand-text-muted">{{ rel.meta!.fieldLabel }}</p>
              </div>
              <NuxtLink v-if="record && !isWorkflowLocked && !rel.editable && relatedTables[`${rel.entitySlug}.${rel.fieldName}`]?.canCreate" :to="relatedCreateLink(rel.entitySlug, rel.fieldName)" class="flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-[13px] font-semibold text-brand-primary-fg hover:bg-brand-orange-hover">
                <Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Agregar
              </NuxtLink>
            </div>
            <div>
              <p v-if="!record" class="p-6 text-center text-xs text-brand-text-muted">{{ rel.editable ? 'Se muestra como tabla editable' : 'Se muestra como tabla de solo lectura' }}</p>
              <RecordLinesTable
                v-else-if="rel.editable"
                v-show="!isWorkflowLocked"
                :key="`${rel.entitySlug}.${rel.fieldName}:${record.id}`"
                :parent-id="record.id"
                :child-slug="rel.entitySlug"
                :child-name="rel.meta!.entityName"
                :field-name="rel.fieldName"
                :totals="rel.totals"
                :parent-label="displayLabel"
                @changed="emit('changed')"
              />
              <p v-if="record && rel.editable && isWorkflowLocked" class="p-6 text-center text-xs text-brand-text-muted">Las partidas están bloqueadas por el estado actual.</p>
              <template v-else-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`]">
                <p v-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].loading" class="p-6 text-center text-xs text-brand-text-muted">Cargando...</p>
                <p v-else-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].rows.length === 0" class="p-6 text-center text-xs text-brand-text-muted">Sin registros relacionados.</p>
                <template v-else>
                  <DynamicTable
                    :entity-slug="rel.entitySlug"
                    :fields="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].fields"
                    :rows="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].rows"
                    :page="1"
                    :page-size="5"
                    :total="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total"
                    sort-by="createdAt"
                    sort-dir="desc"
                    :rounded="false"
                    :permissions="readOnlyPermissions"
                    :inset="true"
                    :borderless="true"
                    :actions-sticky="true"
                    :relation-labels="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].relationLabels"
                  />
                  <NuxtLink v-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total > 5" :to="relatedListLink(rel.entitySlug, rel.fieldName)" class="m-4 inline-block text-xs font-semibold text-brand-blue hover:underline">
                    Ver los {{ relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total }} registros →
                  </NuxtLink>
                </template>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="min-h-0 flex-1 overflow-auto">
        <ActivityTimeline v-if="record" :key="`${entitySlug}:${record.id}`" compact :entity="entitySlug" :record-id="record.id" :can-update="canUpdate" :fields="fields" :highlight-activity-id="initialActivityId" />
        <div v-else class="m-6 flex items-center gap-2 rounded border border-brand-border-light bg-brand-bg p-3 text-xs text-brand-text-secondary">
          <Clock class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" /><span>Guarda el registro primero para empezar a registrar actividad.</span>
        </div>
      </div>
    </section>
  </div>
</template>

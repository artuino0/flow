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
import { computed, reactive, ref, watch } from 'vue'
import { Calendar, Clock, FileText, Pencil, Plus, Trash2, WalletCards } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, EntityPermissions, InverseRelation } from '~/composables/useEntityFields'

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
  entitySlug: string
  entityName: string
  fields: EntityFieldMeta[]
  layout: DetailLayout
  inverseRelations: InverseRelation[]
  /** null = modo vista previa (configurador) - sin datos reales, sin fetch de relaciones. */
  record: RecordData | null
  canUpdate?: boolean
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
}>()

const emit = defineEmits<{
  deleted: []
}>()

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
const initials = computed(() => {
  const words = displayLabel.value.trim().split(/\s+/).filter(Boolean)
  const chars = words.length >= 2 ? [words[0][0], words[1][0]] : [displayLabel.value[0] ?? '?', displayLabel.value[1] ?? '']
  return chars.join('').toUpperCase()
})

function formatValue(field: EntityFieldMeta, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (field.dataType) {
    case 'boolean':
      return value ? 'Sí' : 'No'
    case 'date': {
      const d = new Date(value as string)
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()
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
    for (const r of visibleRelations.value) void loadRelatedTable(r.entitySlug, r.fieldName)
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

const deleting = ref(false)
const deleteError = ref<string | null>(null)
async function onDelete() {
  if (!props.record) return
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return
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
const expandedProperties = ref(false)

function startEditing() {
  if (!props.record) return
  editFormValues.value = JSON.parse(JSON.stringify(props.record.customData))
  isEditing.value = true
}
watch(() => props.startInEdit, (value) => {
  if (value && props.record && props.canUpdate) startEditing()
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
</script>

<template>
  <div class="grid grid-cols-1 gap-5" :class="record ? 'lg:grid-cols-[360px_1fr]' : ''">
    <div class="flex flex-col h-fit self-start rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
      <div class="flex flex-col gap-3 border-b border-brand-border-light p-5">
        <div class="flex min-w-0 items-start gap-3">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue-bg text-sm font-bold text-brand-blue">{{ initials }}</span>
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Detalle de {{ entityName }}</p>
            <h2 class="break-words text-[17px] font-bold leading-snug text-brand-text">{{ displayLabel }}</h2>
            <p v-if="record?.createdAt" class="flex items-center gap-1 text-xs text-brand-text-muted">
              <Calendar class="h-3 w-3 shrink-0" :stroke-width="1.75" />
              Creado el {{ new Date(record.createdAt).toLocaleDateString() }}
            </p>
            <p v-else-if="!record" class="text-xs text-brand-text-muted">Así se verá la ficha de un registro de {{ entityName || 'este módulo' }}</p>
          </div>
        </div>
        
        <div v-if="record && (canUpdate || canDelete || fiscalAction)" class="flex items-center gap-2">
          <template v-if="!isEditing">
            <NuxtLink
              v-if="fiscalAction"
              :to="fiscalAction.to"
              class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-blue hover:bg-brand-blue-bg"
            >
              <component :is="fiscalAction.icon" class="h-3.5 w-3.5" :stroke-width="1.75" />
              {{ fiscalAction.label }}
            </NuxtLink>
            <button
              v-if="canUpdate"
              type="button"
              @click="startEditing"
              class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-text hover:bg-brand-bg"
            >
              <Pencil class="h-3.5 w-3.5" :stroke-width="1.75" />
              Editar
            </button>
            <button
              v-if="canDelete"
              type="button"
              :disabled="deleting"
              title="Eliminar"
              class="flex h-8 w-8 items-center justify-center rounded border border-brand-border-light text-brand-error-text hover:bg-brand-error-bg disabled:cursor-not-allowed disabled:opacity-60"
              @click="onDelete"
            >
              <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              :disabled="submittingEdit"
              @click="cancelEditing"
              class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-text hover:bg-brand-bg"
            >
              Cancelar
            </button>
            <button
              type="button"
              :disabled="submittingEdit"
              @click="saveEdit"
              class="flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-orange-hover"
            >
              Guardar
            </button>
          </template>
        </div>
      </div>

      <p v-if="deleteError" class="mx-5 mt-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ deleteError }}</p>

      <div class="flex flex-col gap-5 p-5">
        <div v-if="visibleProperties.length === 0" class="text-sm text-brand-text-muted">Ninguna propiedad configurada para mostrarse en la ficha.</div>
        <template v-else>
          <div v-if="isEditing">
            <DynamicForm v-model="editFormValues" :fields="visibleProperties" :entity-id="record!.id" :disabled="submittingEdit" />
          </div>
          <div v-else class="flex flex-col gap-3">
            <dl class="grid grid-cols-1 gap-3">
              <div v-for="field in (expandedProperties ? visibleProperties : visibleProperties.slice(0, 8))" :key="field.id" class="flex flex-col gap-0.5">
                <dt class="text-xs font-semibold text-brand-text-secondary">{{ field.label }}</dt>
                <dd class="text-sm text-brand-text">{{ record ? formatValue(field, record.customData[field.name]) : '—' }}</dd>
              </div>
            </dl>
            <button 
              v-if="visibleProperties.length > 8" 
              type="button" 
              class="-mx-5 -mb-5 mt-2 rounded-b-lg border-t border-brand-border-light py-3 text-center text-xs font-semibold text-brand-blue hover:bg-brand-bg hover:underline"
              @click="expandedProperties = !expandedProperties"
            >
              {{ expandedProperties ? 'Ver menos' : `Ver ${visibleProperties.length - 8} ${visibleProperties.length - 8 === 1 ? 'propiedad' : 'propiedades'} más` }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <div class="flex flex-col rounded-lg min-w-0">
      <div class="flex items-center gap-1 border-b border-brand-border-light" role="tablist" aria-label="Asociaciones y actividad">
        <button
          type="button"
          role="tab"
          :aria-selected="activePane === 'associations'"
          class="border-b-2 px-4 py-3 text-sm font-semibold"
          :class="activePane === 'associations' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted hover:text-brand-text'"
          @click="activePane = 'associations'"
        >
          Asociaciones
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="activePane === 'activity'"
          class="border-b-2 px-4 py-3 text-sm font-semibold"
          :class="activePane === 'activity' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted hover:text-brand-text'"
          @click="activePane = 'activity'"
        >
          Actividad
        </button>
      </div>

      <div v-if="activePane === 'associations'" class="flex flex-col gap-5 pt-5">
        <p v-if="visibleRelations.length === 0" class="text-sm text-brand-text-muted">Ningún otro módulo tiene un campo de relación apuntando a este.</p>
        <div
          v-for="rel in visibleRelations"
          :key="`${rel.entitySlug}.${rel.fieldName}`"
          class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface"
        >
          <div class="flex items-center justify-between gap-3 border-b border-brand-border-light px-4 py-3">
            <div class="flex flex-col gap-0.5">
              <h3 class="text-sm font-bold text-brand-text">{{ rel.meta!.entityName }}</h3>
              <p class="text-xs text-brand-text-muted">{{ rel.meta!.fieldLabel }}</p>
            </div>
            <NuxtLink
              v-if="record && relatedTables[`${rel.entitySlug}.${rel.fieldName}`]?.canCreate"
              :to="relatedCreateLink(rel.entitySlug, rel.fieldName)"
              class="flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-orange-hover"
            >
              <Plus class="h-3.5 w-3.5" :stroke-width="1.75" />
              Agregar
            </NuxtLink>
          </div>
          <div>
            <p v-if="!record" class="text-xs text-brand-text-muted">Se muestra como tabla de solo lectura</p>
            <template v-else-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`]">
              <p v-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].loading" class="text-xs text-brand-text-muted p-6 text-center">Cargando...</p>
              <template v-else-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].rows.length === 0">
                <p class="text-xs text-brand-text-muted p-6 text-center">Sin registros relacionados.</p>
              </template>
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
                <NuxtLink
                  v-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total > 5"
                  :to="relatedListLink(rel.entitySlug, rel.fieldName)"
                  class="mt-3 inline-block text-xs font-semibold text-brand-blue hover:underline"
                >
                  Ver los {{ relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total }} registros →
                </NuxtLink>
              </template>
            </template>
          </div>
        </div>
      </div>

      <div v-else class="pt-4">
        <ActivityTimeline v-if="record" :key="`${entitySlug}:${record.id}`" :entity="entitySlug" :record-id="record.id" :can-update="canUpdate" :fields="fields" :highlight-activity-id="initialActivityId" />
        <div v-else class="flex items-center gap-2 rounded border border-brand-border-light bg-brand-bg p-3 text-xs text-brand-text-secondary">
          <Clock class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
          <span>Guarda el registro primero para empezar a registrar actividad.</span>
        </div>
      </div>
    </div>
  </div>
</template>

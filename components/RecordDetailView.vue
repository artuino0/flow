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
import { Calendar, Clock, Pencil, Trash2 } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, InverseRelation } from '~/composables/useEntityFields'

interface RecordData {
  id: string
  customData: Record<string, unknown>
  createdAt?: string
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
}>()

const emit = defineEmits<{
  deleted: []
}>()

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
  props.record ? labelForRecord(props.fields, props.record.customData, props.record.id) : `Ejemplo de ${props.entityName || 'este módulo'}`
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
    case 'select':
    case 'multiselect': {
      const options = Array.isArray(field.validationRules?.options) ? (field.validationRules.options as Array<{ value: string; label: string }>) : []
      const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v
      return Array.isArray(value) ? value.map(labelFor).join(', ') || '-' : labelFor(String(value))
    }
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value)
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
}
const relatedTables = reactive<Record<string, RelatedTableState>>({})
const readOnlyPermissions = { canRead: true, canCreate: false, canUpdate: false, canDelete: false }

async function loadRelatedTable(entitySlug: string, fieldName: string) {
  if (!props.record) return
  const key = `${entitySlug}.${fieldName}`
  relatedTables[key] = { fields: [], rows: [], total: 0, loading: true }
  try {
    const [fieldsRes, recordsRes] = await Promise.all([
      $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${entitySlug}/fields`),
      $fetch<{ data: { id: string; customData: Record<string, unknown> }[]; total: number }>(`/api/records/${entitySlug}`, {
        query: { filterField: fieldName, filterValues: props.record.id, pageSize: 5 }
      })
    ])
    relatedTables[key] = { fields: fieldsRes.fields, rows: recordsRes.data, total: recordsRes.total, loading: false }
  } catch {
    relatedTables[key] = { fields: [], rows: [], total: 0, loading: false }
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

const deleting = ref(false)
const deleteError = ref<string | null>(null)
async function onDelete() {
  if (!props.record) return
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/records/${props.entitySlug}/${props.record.id}`, { method: 'DELETE' })
    emit('deleted')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el registro'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex items-start justify-between gap-3 border-b border-brand-border-light p-5">
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue-bg text-sm font-bold text-brand-blue">{{ initials }}</span>
        <div class="flex flex-col gap-0.5">
          <h2 class="text-[17px] font-bold text-brand-text">{{ displayLabel }}</h2>
          <p v-if="record?.createdAt" class="flex items-center gap-1 text-xs text-brand-text-muted">
            <Calendar class="h-3 w-3" :stroke-width="1.75" />
            Creado el {{ new Date(record.createdAt).toLocaleDateString() }}
          </p>
          <p v-else-if="!record" class="text-xs text-brand-text-muted">Así se verá la ficha de un registro de {{ entityName || 'este módulo' }}</p>
        </div>
      </div>
      <div v-if="record" class="flex shrink-0 items-center gap-2">
        <NuxtLink
          v-if="canUpdate"
          :to="`/registros/${entitySlug}/${record.id}/editar`"
          class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-text hover:bg-brand-bg"
        >
          <Pencil class="h-3.5 w-3.5" :stroke-width="1.75" />
          Editar
        </NuxtLink>
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
      </div>
    </div>

    <p v-if="deleteError" class="mx-5 mt-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ deleteError }}</p>

    <div class="flex flex-col gap-5 p-5">
      <div v-if="visibleProperties.length === 0" class="text-sm text-brand-text-muted">Ninguna propiedad configurada para mostrarse en la ficha.</div>
      <dl v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div v-for="field in visibleProperties" :key="field.id" class="flex flex-col gap-0.5">
          <dt class="text-xs font-semibold text-brand-text-secondary">{{ field.label }}</dt>
          <dd class="text-sm text-brand-text">{{ record ? formatValue(field, record.customData[field.name]) : '—' }}</dd>
        </div>
      </dl>

      <div v-for="rel in visibleRelations" :key="`${rel.entitySlug}.${rel.fieldName}`" class="flex flex-col gap-2 border-t border-brand-border-light pt-4">
        <h3 class="text-sm font-bold text-brand-text">{{ rel.meta!.entityName }}</h3>

        <!-- Modo vista previa: sin datos reales, mismo texto que el .pen. -->
        <p v-if="!record" class="text-xs text-brand-text-muted">Se muestra como tabla de solo lectura</p>

        <template v-else-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`]">
          <p v-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].loading" class="text-xs text-brand-text-muted">Cargando...</p>
          <template v-else-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].rows.length === 0">
            <p class="text-xs text-brand-text-muted">Sin registros relacionados.</p>
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
              :permissions="readOnlyPermissions"
            />
            <NuxtLink
              v-if="relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total > 5"
              :to="relatedListLink(rel.entitySlug, rel.fieldName)"
              class="self-start text-xs font-semibold text-brand-blue hover:underline"
            >
              Ver los {{ relatedTables[`${rel.entitySlug}.${rel.fieldName}`].total }} registros →
            </NuxtLink>
          </template>
        </template>
      </div>

      <div v-if="layout.showActivity" class="flex items-center gap-2 rounded border border-brand-border-light bg-brand-bg p-3 text-xs text-brand-text-secondary">
        <Clock class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
        <span v-if="!record">Línea de tiempo de actividad visible</span>
        <span v-else>La línea de tiempo de actividad todavía no está disponible - requiere un historial de auditoría (HU futura).</span>
      </div>
    </div>
  </div>
</template>

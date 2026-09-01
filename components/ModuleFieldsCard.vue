<script setup lang="ts">
// HU-ERD-70: card "Campos del modulo" - sigue el Card de LeftCol en
// Screen/Editor de Campos del .pen (revisado con las herramientas de
// Pencil): fila por campo (nombre + nombre tecnico, badge de tipo con
// icono/color propio, Obligatorio/Opcional, editar/eliminar), boton
// "Agregar campo" que abre FieldFormModal.
//
// Reusado tal cual tanto en pages/modulos/nuevo.vue (paso 2 del asistente)
// como en pages/modulos/[id]/editar.vue - Jira ERD-70 pide explicitamente
// que "editar un modulo existente reuse el mismo componente".
import { computed, ref } from 'vue'
import { Blocks, Braces, Calendar, Hash, Link2, List, ListChecks, Pencil, Plus, Table2, ToggleLeft, Trash2, Type as TypeIcon } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import FieldFormModal, { type FieldDraft } from '~/components/FieldFormModal.vue'
import FieldImpactWarningModal from '~/components/FieldImpactWarningModal.vue'

const props = defineProps<{
  entityId: string
  entityName: string
  fields: EntityFieldMeta[]
}>()

const emit = defineEmits<{
  changed: []
}>()

// Mismo criterio de icono/color por dataType que las filas de campos del
// diseno (badge, no la tarjeta de seleccion de tipo del modal, que siempre
// usa azul para "seleccionado").
const TYPE_BADGE: Record<string, { icon: typeof TypeIcon; bg: string; text: string; label: string }> = {
  text: { icon: TypeIcon, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text', label: 'Texto' },
  number: { icon: Hash, bg: 'bg-brand-success-bg', text: 'text-brand-success-text', label: 'Número' },
  boolean: { icon: ToggleLeft, bg: 'bg-brand-warning-bg', text: 'text-brand-warning-text', label: 'Booleano' },
  date: { icon: Calendar, bg: 'bg-brand-pink-bg', text: 'text-brand-pink-text', label: 'Fecha' },
  json: { icon: Braces, bg: 'bg-brand-purple-bg', text: 'text-brand-purple-text', label: 'JSON' },
  relation: { icon: Link2, bg: 'bg-brand-blue-bg', text: 'text-brand-blue', label: 'Relación' },
  // HU-ERD-71: sin badge propio en el .pen para estos 3 tipos (el diseño de
  // la lista de campos es anterior a HU-ERD-68) - se sigue el mismo patrón
  // que los demás (icono + par bg/text de marca), usando los tokens
  // info-* (sin usar todavía en ningún otro badge) para Select/Multiselect.
  select: { icon: List, bg: 'bg-brand-info-bg', text: 'text-brand-info-text', label: 'Select' },
  multiselect: { icon: ListChecks, bg: 'bg-brand-info-bg', text: 'text-brand-info-text', label: 'Multiselect' },
  tabla: { icon: Table2, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text', label: 'Tabla' }
}
function badgeFor(dataType: string) {
  return TYPE_BADGE[dataType] ?? { icon: Blocks, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text', label: dataType }
}

const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingField = ref<EntityFieldMeta | null>(null)
const saving = ref(false)
const modalError = ref<string | null>(null)

function openCreate() {
  modalMode.value = 'create'
  editingField.value = null
  modalError.value = null
  modalOpen.value = true
}
function openEdit(field: EntityFieldMeta) {
  modalMode.value = 'edit'
  editingField.value = field
  modalError.value = null
  modalOpen.value = true
}
function closeModal() {
  modalOpen.value = false
}

// HU-ERD-76: compara SOLO la "forma" del campo (lo que puede volver
// incompatibles datos ya guardados) - label es cosmetico, no cuenta.
// Coincide 1:1 con el criterio que ya usa updateEntityField()
// (server/utils/moduleEntityFields.ts) para decidir si escribe un snapshot
// en entity_field_history, para no mostrar la advertencia cuando el backend
// ni siquiera va a versionar el cambio.
function metadataShapeChanged(original: EntityFieldMeta, draft: FieldDraft): boolean {
  return (
    draft.dataType !== original.dataType ||
    JSON.stringify(draft.validationRules ?? {}) !== JSON.stringify(original.validationRules ?? {}) ||
    draft.isRequired !== original.isRequired
  )
}

// Estado del modal de advertencia (Screen/Advertencia - Editar Campo con
// Datos del .pen) - una sola instancia para editar y eliminar, diferenciada
// por `impactAction`. `pendingDraft`/`pendingDeleteField` guardan que hacer
// si el usuario confirma; se limpian al cancelar.
const impactModalOpen = ref(false)
const impactAction = ref<'edit' | 'delete'>('edit')
const impactAffectedRecords = ref(0)
const impactConfirming = ref(false)
const pendingDraft = ref<FieldDraft | null>(null)
const pendingDeleteField = ref<EntityFieldMeta | null>(null)
const impactFieldLabel = computed(() => (impactAction.value === 'edit' ? editingField.value?.label : pendingDeleteField.value?.label) ?? '')

/** GET /api/entity-fields/:fieldId (HU-ERD-76) - conteo real, siempre server-side. */
async function fetchAffectedRecords(fieldId: string): Promise<number> {
  const impact = await $fetch<{ affectedRecords: number }>(`/api/entity-fields/${fieldId}`)
  return impact.affectedRecords
}

async function submitFieldUpdate(fieldId: string, draft: FieldDraft) {
  await $fetch(`/api/entity-fields/${fieldId}`, {
    method: 'PUT',
    body: { label: draft.label, dataType: draft.dataType, validationRules: draft.validationRules, isRequired: draft.isRequired }
  })
}

async function onSubmit(draft: FieldDraft) {
  modalError.value = null

  if (modalMode.value === 'edit' && editingField.value && metadataShapeChanged(editingField.value, draft)) {
    const fieldId = editingField.value.id
    saving.value = true
    try {
      const affectedRecords = await fetchAffectedRecords(fieldId)
      if (affectedRecords > 0) {
        pendingDraft.value = draft
        impactAction.value = 'edit'
        impactAffectedRecords.value = affectedRecords
        impactModalOpen.value = true
        return
      }
    } catch {
      // Si falla el conteo de impacto (ej. el campo ya no existe), no se
      // bloquea el guardado por eso - se sigue el flujo normal y, si el PUT
      // en si falla, el catch de abajo ya muestra el error real.
    } finally {
      saving.value = false
    }
  }

  await runFieldUpdate(draft)
}

async function runFieldUpdate(draft: FieldDraft) {
  modalError.value = null
  saving.value = true
  try {
    if (modalMode.value === 'create') {
      await $fetch(`/api/entities/${props.entityId}/fields`, { method: 'POST', body: draft })
    } else if (editingField.value) {
      await submitFieldUpdate(editingField.value.id, draft)
    }
    modalOpen.value = false
    emit('changed')
  } catch (err: any) {
    modalError.value = err?.data?.statusMessage || 'No se pudo guardar el campo'
  } finally {
    saving.value = false
  }
}

const deleteError = ref<string | null>(null)
const deletingId = ref<string | null>(null)

async function onDelete(field: EntityFieldMeta) {
  deleteError.value = null
  try {
    const affectedRecords = await fetchAffectedRecords(field.id)
    if (affectedRecords > 0) {
      pendingDeleteField.value = field
      impactAction.value = 'delete'
      impactAffectedRecords.value = affectedRecords
      impactModalOpen.value = true
      return
    }
  } catch {
    // Mismo criterio que en onSubmit: si el conteo de impacto falla, no se
    // bloquea la eliminacion por eso - se sigue con la confirmacion liviana
    // de siempre.
  }

  if (!confirm(`Eliminar el campo "${field.label}"? Esta accion no se puede deshacer.`)) return
  await runFieldDelete(field.id)
}

async function runFieldDelete(fieldId: string) {
  deleteError.value = null
  deletingId.value = fieldId
  try {
    await $fetch(`/api/entity-fields/${fieldId}`, { method: 'DELETE' })
    emit('changed')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el campo'
  } finally {
    deletingId.value = null
  }
}

function cancelImpactModal() {
  impactModalOpen.value = false
  pendingDraft.value = null
  pendingDeleteField.value = null
}

// runFieldUpdate/runFieldDelete ya manejan su propio error (modalError /
// deleteError, mismos mensajes que el flujo sin advertencia) - por eso este
// handler no necesita try/catch propio: si la accion real falla, el error
// queda visible donde siempre estuvo (el modal de campo o el header de la
// tarjeta), no dentro del modal de advertencia.
async function confirmImpactModal() {
  impactConfirming.value = true
  if (impactAction.value === 'edit' && pendingDraft.value) {
    await runFieldUpdate(pendingDraft.value)
  } else if (impactAction.value === 'delete' && pendingDeleteField.value) {
    await runFieldDelete(pendingDeleteField.value.id)
  }
  impactConfirming.value = false
  impactModalOpen.value = false
  pendingDraft.value = null
  pendingDeleteField.value = null
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex items-center justify-between border-b border-brand-border-light p-5">
      <div class="flex flex-col gap-1">
        <h2 class="text-[15px] font-bold text-brand-text">Campos del módulo</h2>
        <p class="text-sm text-brand-text-secondary">{{ fields.length }} campo{{ fields.length === 1 ? '' : 's' }}</p>
      </div>
      <button type="button" class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover" @click="openCreate">
        <Plus class="h-[15px] w-[15px]" :stroke-width="2" />
        Agregar campo
      </button>
    </div>

    <p v-if="deleteError" class="mx-5 mt-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">
      {{ deleteError }}
    </p>

    <p v-if="fields.length === 0" class="p-6 text-center text-sm text-brand-text-muted">Todavía no agregaste ningún campo.</p>

    <div v-else class="flex flex-col divide-y divide-brand-border-light">
      <div v-for="field in fields" :key="field.id" class="flex items-center gap-3 px-5 py-3">
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-semibold text-brand-text">{{ field.label }}</span>
          <span class="truncate font-mono text-xs text-brand-text-muted">{{ field.name }}</span>
        </div>
        <span class="flex w-[110px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1" :class="badgeFor(field.dataType).bg">
          <component :is="badgeFor(field.dataType).icon" class="h-3 w-3" :class="badgeFor(field.dataType).text" :stroke-width="2" />
          <span class="text-xs font-semibold" :class="badgeFor(field.dataType).text">{{ badgeFor(field.dataType).label }}</span>
        </span>
        <span class="w-20 shrink-0 text-xs font-semibold" :class="field.isRequired ? 'text-brand-text-secondary' : 'text-brand-text-muted'">
          {{ field.isRequired ? 'Obligatorio' : 'Opcional' }}
        </span>
        <div class="flex shrink-0 gap-1.5">
          <button type="button" title="Editar" class="flex h-[26px] w-[26px] items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg" @click="openEdit(field)">
            <Pencil class="h-3.5 w-3.5" :stroke-width="1.75" />
          </button>
          <button
            type="button"
            title="Eliminar"
            :disabled="deletingId === field.id"
            class="flex h-[26px] w-[26px] items-center justify-center rounded text-brand-error-text hover:bg-brand-error-bg disabled:cursor-not-allowed disabled:opacity-60"
            @click="onDelete(field)"
          >
            <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
          </button>
        </div>
      </div>
    </div>

    <FieldFormModal
      :open="modalOpen"
      :mode="modalMode"
      :initial-field="editingField"
      :saving="saving"
      :error="modalError"
      @close="closeModal"
      @submit="onSubmit"
    />

    <FieldImpactWarningModal
      :open="impactModalOpen"
      :action="impactAction"
      :field-label="impactFieldLabel"
      :entity-name="entityName"
      :affected-records="impactAffectedRecords"
      :confirming="impactConfirming"
      @cancel="cancelImpactModal"
      @confirm="confirmImpactModal"
    />
  </div>
</template>

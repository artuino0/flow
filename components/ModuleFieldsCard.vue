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
import { Blocks, Braces, Calendar, Hash, Link2, Pencil, Plus, ToggleLeft, Trash2, Type as TypeIcon } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import FieldFormModal, { type FieldDraft } from '~/components/FieldFormModal.vue'

const props = defineProps<{
  entityId: string
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
  relation: { icon: Link2, bg: 'bg-brand-blue-bg', text: 'text-brand-blue', label: 'Relación' }
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

async function onSubmit(draft: FieldDraft) {
  modalError.value = null
  saving.value = true
  try {
    if (modalMode.value === 'create') {
      await $fetch(`/api/entities/${props.entityId}/fields`, { method: 'POST', body: draft })
    } else if (editingField.value) {
      await $fetch(`/api/entity-fields/${editingField.value.id}`, {
        method: 'PUT',
        body: { label: draft.label, dataType: draft.dataType, validationRules: draft.validationRules, isRequired: draft.isRequired }
      })
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
  if (!confirm(`Eliminar el campo "${field.label}"? Esta accion no se puede deshacer.`)) return
  deleteError.value = null
  deletingId.value = field.id
  try {
    await $fetch(`/api/entity-fields/${field.id}`, { method: 'DELETE' })
    emit('changed')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el campo'
  } finally {
    deletingId.value = null
  }
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
  </div>
</template>

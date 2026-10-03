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
import { GripVertical, LockKeyhole, Pencil, Plus, Trash2 } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import FieldFormModal, { type FieldDraft } from '~/components/FieldFormModal.vue'
import FieldImpactWarningModal from '~/components/FieldImpactWarningModal.vue'
import { badgeFor } from '~/utils/fieldTypeBadge'

const props = defineProps<{
  entityId: string
  entityName: string
  fields: EntityFieldMeta[]
}>()

const emit = defineEmits<{
  changed: []
}>()

// Reportado por el usuario (2026-09-03): GET /api/entities/:entity/fields
// (fields.get.ts) ahora siempre antepone un campo sintetico "id" (nunca una
// fila real de entity_fields - ver el comentario largo alla) a props.fields,
// para que esta tarjeta lo muestre SIEMPRE como "Automático"/"Reservado", sin
// editar/eliminar (ya soportado desde que se reporto por primera vez este
// problema, solo que nunca llegaba ningun campo "id" para mostrar). Como no
// es una fila real, no puede participar del drag-and-drop/reorder (su id
// sintetico "system:id" no existe en la base - PUT /api/entity-fields/reorder
// lo rechazaria) - se separa del resto para que el v-for/onDrop de mas abajo
// sigan operando exactamente igual que antes sobre las filas reales.
const idField = computed(() => props.fields.find((f) => f.name === 'id') ?? null)
const realFields = computed(() => props.fields.filter((f) => f.name !== 'id'))

// Mismo criterio de icono/color por dataType que las filas de campos del
// diseno (badge, no la tarjeta de seleccion de tipo del modal, que siempre
// usa azul para "seleccionado").
function badgeForField(field: EntityFieldMeta) {
  return badgeFor(field.name === 'id' ? 'uuid' : field.dataType)
}

const modalOpen = ref(false)
// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts.
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

const modalMode = ref<'create' | 'edit'>('create')
const editingField = ref<EntityFieldMeta | null>(null)
const saving = ref(false)
const modalError = ref<string | null>(null)
const usageLoading = ref(false)
const fieldUsage = ref<{ hasValues: boolean; usedOptionValues: string[] } | null>(null)
const validationImpact = ref<{ nonCompliantRecords: number; truncated: boolean } | null>(null)

function openCreate() {
  fieldUsage.value = null
  usageLoading.value = false
  modalMode.value = 'create'
  editingField.value = null
  modalError.value = null
  modalOpen.value = true
}
async function openEdit(field: EntityFieldMeta) {
  modalMode.value = 'edit'
  editingField.value = field
  modalError.value = null
  modalOpen.value = true
  fieldUsage.value = null
  usageLoading.value = true
  try {
    const usage = await $fetch<{ hasValues: boolean; usedOptionValues: string[] }>(`/api/entity-fields/${field.id}`)
    if (editingField.value?.id === field.id) fieldUsage.value = usage
  } catch (error) {
    if (editingField.value?.id === field.id) modalError.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'No se pudo consultar el uso del campo. Cierra y vuelve a abrir para editarlo.'
  } finally {
    if (editingField.value?.id === field.id) usageLoading.value = false
  }
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
  const response = await $fetch<{ validationImpact?: { nonCompliantRecords: number; truncated: boolean } }>(`/api/entity-fields/${fieldId}`, {
    method: 'PUT',
    body: editingField.value?.systemProtected ? { label: draft.label } : { label: draft.label, dataType: draft.dataType, validationRules: draft.validationRules, isRequired: draft.isRequired }
  })
  validationImpact.value = response.validationImpact && response.validationImpact.nonCompliantRecords > 0 ? response.validationImpact : null
}

async function onSubmit(draft: FieldDraft) {
  if (usageLoading.value || (modalMode.value === 'edit' && !fieldUsage.value)) return
  modalError.value = null

  if (modalMode.value === 'edit' && editingField.value && !editingField.value.systemProtected && metadataShapeChanged(editingField.value, draft)) {
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
      toast.success('Campo creado', `"${draft.label}" se agregó al módulo.`)
    } else if (editingField.value) {
      await submitFieldUpdate(editingField.value.id, draft)
      toast.updated('Campo actualizado', `Los cambios en "${draft.label}" se guardaron correctamente.`)
    }
    modalOpen.value = false
    emit('changed')
  } catch (err: any) {
    modalError.value = err?.data?.statusMessage || 'No se pudo guardar el campo'
    toast.error('No se pudo guardar el campo', modalError.value)
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

  if (!await confirmAction({ title: 'Eliminar campo', message: `¿Eliminar el campo "${field.label}"? Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) return
  await runFieldDelete(field.id)
}

async function runFieldDelete(fieldId: string) {
  deleteError.value = null
  deletingId.value = fieldId
  try {
    // Nitro tipa $fetch por PATRON de ruta - desde que existe el sibling
    // ESTATICO /api/entity-fields/reorder (put-only, "el organizador",
    // 2026-09-01), el template literal `/api/entity-fields/${fieldId}`
    // matchea AMBOS `/api/entity-fields/:fieldId` (get/put/delete) y
    // `/api/entity-fields/reorder` (put) a nivel de tipos - typescript no
    // sabe que fieldId nunca sera literalmente "reorder" - y el metodo
    // permitido queda angostado a la INTERSECCION de ambos (solo "put"), lo
    // que rompe este DELETE real en tiempo de compilacion (no en runtime: el
    // router real si distingue "reorder" de un uuid sin problema). Se
    // widening la url a `string` para que $fetch use su firma generica en
    // vez de la sobrecarga por ruta - mismo problema no aplica a
    // fetchAffectedRecords()/submitFieldUpdate() de arriba porque GET (sin
    // method explicito) y PUT si caen dentro de esa interseccion.
    const url: string = `/api/entity-fields/${fieldId}`
    await $fetch(url, { method: 'DELETE' })
    emit('changed')
    toast.success('Campo eliminado', 'El campo se eliminó correctamente.')
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el campo'
    toast.error('No se pudo eliminar el campo', deleteError.value)
  } finally {
    deletingId.value = null
  }
}

// "El organizador" (pedido del usuario, 2026-09-01): reordenar campos con
// drag-and-drop real (feedback explicito: nada de botones ↑/↓ - a diferencia
// del builder de Opciones/Columnas de FieldFormModal.vue, que si usa ese
// patron mas simple porque ahi el orden es un borrador local que recien se
// persiste al guardar el campo entero). Drag-and-drop NATIVO del navegador
// (draggable + eventos drag*), sin sumar ninguna libreria: la lista es chica
// y de un solo nivel, no hace falta mas que eso.
//
// `dropIndicator` guarda sobre que fila esta el cursor y si soltaria ANTES o
// DESPUES de ella (mitad superior/inferior de la fila, calculado en
// onDragOver) - la linea naranja del template se dibuja ahi, apuntando
// exactamente donde caeria el campo si se suelta ahora.
//
// Cada campo ya existe como su propia fila en la base, asi que soltar
// dispara de inmediato PUT /api/entity-fields/reorder con el array completo
// de ids en el nuevo orden (mismo criterio de "guardado inmediato" que ya
// usan onSubmit/onDelete de arriba).
const reorderError = ref<string | null>(null)
const reordering = ref(false)
const draggingIndex = ref<number | null>(null)
const dropIndicator = ref<{ index: number; position: 'before' | 'after' } | null>(null)

function onDragStart(index: number, event: DragEvent) {
  draggingIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Requerido por Firefox para que dragstart no se cancele - el contenido
    // en si no se usa (el estado real vive en draggingIndex).
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOverRow(index: number, event: DragEvent) {
  if (draggingIndex.value === null) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
  dropIndicator.value = { index, position }
}

function onDragLeaveRow(index: number) {
  if (dropIndicator.value?.index === index) dropIndicator.value = null
}

function onDragEnd() {
  draggingIndex.value = null
  dropIndicator.value = null
}

async function onDrop() {
  const from = draggingIndex.value
  const indicator = dropIndicator.value
  draggingIndex.value = null
  dropIndicator.value = null
  if (from === null || !indicator) return

  // La posicion "despues de la fila X" en la lista ORIGINAL no es la misma
  // posicion de destino en el array una vez que se saca el campo arrastrado
  // de su lugar viejo - si el origen esta antes del destino, todo lo que
  // queda entre medio se corre un lugar hacia atras.
  let to = indicator.position === 'after' ? indicator.index + 1 : indicator.index
  if (from < to) to -= 1
  if (to === from) return

  const order = realFields.value.map((f) => f.id)
  const [movedId] = order.splice(from, 1)
  order.splice(to, 0, movedId)

  reorderError.value = null
  reordering.value = true
  try {
    await $fetch('/api/entity-fields/reorder', { method: 'PUT', body: { entityId: props.entityId, order } })
    emit('changed')
  } catch (err: any) {
    reorderError.value = err?.data?.statusMessage || 'No se pudo reordenar los campos'
    // Sin toast de exito aca a proposito (a diferencia del resto de acciones
    // de esta tarjeta): el drag-and-drop es una interaccion frecuente/fluida,
    // un toast en cada soltada seria ruido. El de error si importa - sin el,
    // un reorder fallido pasaria desapercibido (el orden visual ya cambio
    // optimisticamente antes de este catch).
    toast.error('No se pudo reordenar los campos', reorderError.value)
  } finally {
    reordering.value = false
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
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
    <div data-tour="edit-fields-add" class="flex items-center justify-between border-b border-brand-border-light p-5">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2"><h2 class="text-[15px] font-bold text-brand-text">Campos del módulo</h2><ModuleTourHelpButton tab="fields" /></div>
        <p class="text-sm text-brand-text-secondary">{{ realFields.length }} campo{{ realFields.length === 1 ? '' : 's' }}</p>
      </div>
      <button type="button" data-tour="manual-field-add" class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-[13px] font-semibold text-brand-primary-fg hover:bg-brand-orange-hover" @click="openCreate">
        <Plus class="h-[15px] w-[15px]" :stroke-width="2" />
        Agregar campo
      </button>
    </div>

    <p v-if="deleteError" class="mx-5 mt-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">
      {{ deleteError }}
    </p>
    <p v-if="validationImpact" role="status" class="mx-5 mt-4 rounded border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-warning-text">
      {{ validationImpact.nonCompliantRecords }} registros existentes no cumplen la nueva regla; se conservan sin cambios y se validarán al editarlos<span v-if="validationImpact.truncated"> (conteo truncado)</span>.
    </p>
    <p v-if="reorderError" class="mx-5 mt-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">
      {{ reorderError }}
    </p>

    <div v-if="idField" class="flex items-center gap-3 border-b border-brand-border-light bg-brand-bg px-5 py-3">
      <GripVertical class="h-4 w-4 shrink-0 text-brand-border" :stroke-width="1.75" />
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm font-semibold text-brand-text">{{ idField.label }}</span>
        <span class="truncate font-mono text-xs text-brand-text-muted">{{ idField.name }}</span>
      </div>
      <span class="flex w-[110px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1" :class="badgeForField(idField).bg">
        <component :is="badgeForField(idField).icon" class="h-3 w-3" :class="badgeForField(idField).text" :stroke-width="2" />
        <span class="text-xs font-semibold" :class="badgeForField(idField).text">{{ badgeForField(idField).label }}</span>
      </span>
      <span class="w-20 shrink-0 text-xs font-semibold text-brand-text-muted">Automático</span>
      <span class="w-[62px] shrink-0 text-center text-xs text-brand-text-muted" title="El campo id es reservado del sistema">Reservado</span>
    </div>

    <p v-if="realFields.length === 0" class="p-6 text-center text-sm text-brand-text-muted">Todavía no agregaste ningún campo.</p>

    <div v-else data-tour="manual-field-saved" class="flex flex-col divide-y divide-brand-border-light">
      <div
        v-for="(field, index) in realFields"
        :key="field.id"
        data-tour="edit-fields-rows"
        class="relative flex items-center gap-3 px-5 py-3 transition-opacity"
        :class="draggingIndex === index ? 'opacity-40' : ''"
        :draggable="!reordering"
        @dragstart="onDragStart(index, $event)"
        @dragover.prevent="onDragOverRow(index, $event)"
        @dragleave="onDragLeaveRow(index)"
        @drop.prevent="onDrop"
        @dragend="onDragEnd"
      >
        <!-- "El organizador" (pedido del usuario, 2026-09-01): drag-and-drop
             real (nativo del navegador, sin libreria) - la linea naranja
             marca EXACTAMENTE donde caeria el campo si se suelta ahora
             (arriba o abajo de esta fila, segun en que mitad este el cursor,
             calculado en onDragOverRow). -->
        <div v-if="dropIndicator && dropIndicator.index === index && dropIndicator.position === 'before'" class="absolute inset-x-0 top-0 h-0.5 rounded-full bg-brand-orange" />
        <div v-if="dropIndicator && dropIndicator.index === index && dropIndicator.position === 'after'" class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-orange" />
        <GripVertical class="h-4 w-4 shrink-0 cursor-grab text-brand-text-muted active:cursor-grabbing" :stroke-width="1.75" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-semibold text-brand-text">{{ field.label }}</span>
          <span class="truncate font-mono text-xs text-brand-text-muted">{{ field.name }}</span>
          <span v-if="field.systemProtected" class="mt-1 flex items-center gap-1 text-xs text-brand-info-text"><LockKeyhole class="h-3 w-3" aria-hidden="true" />Campo núcleo protegido. Puedes cambiar su etiqueta.</span>
        </div>
        <span class="flex w-[110px] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1" :class="badgeForField(field).bg">
          <component :is="badgeForField(field).icon" class="h-3 w-3" :class="badgeForField(field).text" :stroke-width="2" />
          <span class="text-xs font-semibold" :class="badgeForField(field).text">{{ badgeForField(field).label }}</span>
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
            :disabled="field.systemProtected || deletingId === field.id"
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
      :schema-locked="editingField?.systemProtected"
      :saving="saving"
      :error="modalError"
      :existing-fields="realFields"
      :entity-id="entityId"
      :has-values="fieldUsage?.hasValues"
      :used-option-values="fieldUsage?.usedOptionValues"
      :loading-usage="usageLoading"
      :usage-unavailable="modalMode === 'edit' && !fieldUsage && !usageLoading"
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

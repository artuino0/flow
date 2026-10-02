<script setup lang="ts">
// HU-ERD-76: modal de advertencia antes de confirmar una edicion/borrado de
// un campo que ya tiene datos existentes (Screen/Advertencia - Editar Campo
// con Datos del .pen, revisado con las herramientas de Pencil antes de
// construir). Componente puro de confirmacion - no dispara ningun fetch el
// mismo; ModuleFieldsCard.vue decide cuando mostrarlo (ya con el conteo real
// de `affectedRecords` en mano, calculado server-side via GET
// /api/entity-fields/:fieldId) y que hacer al confirmar (PUT/DELETE reales,
// exactamente el mismo flujo de is_dirty/entity_field_history de HU-ERD-67 -
// este modal es solo una capa de confirmacion, nunca una ruta alternativa de
// guardado, criterio de aceptacion explicito de la HU).
//
// El diseno solo muestra el texto para "editar" (cambiar el tipo de dato).
// El texto para "eliminar" (bullets y botones) es una extrapolacion
// documentada: mismo look, mismo mecanismo de acknowledgment, pero explica lo
// que realmente pasa al borrar un campo (ver el comentario de
// deleteEntityField() en server/utils/moduleEntityFields.ts) - los datos no
// se eliminan, quedan huerfanos hasta la proxima revalidacion perezosa.
import { AlertTriangle } from '@lucide/vue'
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  action: 'edit' | 'delete'
  fieldLabel: string
  entityName: string
  affectedRecords: number
  confirming?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const acknowledged = ref(false)
watch(
  () => props.open,
  (open) => {
    if (open) acknowledged.value = false
  }
)

const COPY = {
  edit: {
    title: 'Este cambio puede afectar datos existentes',
    subtitle: (field: string, entity: string) => `Estás por modificar el campo "${field}" del módulo ${entity}, que ya está publicado.`,
    bullets: [
      'Cambiar el tipo de dato puede vaciar el valor en registros donde no sea compatible.',
      'Los datos actuales no se eliminan, pero podrían dejar de mostrarse correctamente.'
    ],
    confirmLabel: 'Sí, modificar campo'
  },
  delete: {
    title: 'Esta eliminación puede afectar datos existentes',
    subtitle: (field: string, entity: string) => `Estás por eliminar el campo "${field}" del módulo ${entity}, que ya está publicado.`,
    bullets: [
      'El campo eliminado deja de mostrarse en formularios, listados y filtros del módulo.',
      'Los datos ya guardados no se eliminan: quedan huérfanos en el registro hasta la próxima actualización.'
    ],
    confirmLabel: 'Sí, eliminar campo'
  }
} as const
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-modal-overlay/40 p-4">
    <div class="flex w-full max-w-[420px] flex-col rounded-lg bg-brand-surface shadow-xl">
      <div class="flex items-start gap-3 border-b border-brand-border-light p-5">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-warning-bg">
          <AlertTriangle class="h-[18px] w-[18px] text-brand-warning-text" :stroke-width="1.75" />
        </div>
        <div class="flex flex-col gap-1">
          <h2 class="text-[15px] font-bold text-brand-text">{{ COPY[action].title }}</h2>
          <p class="text-sm text-brand-text-secondary">{{ COPY[action].subtitle(fieldLabel, entityName) }}</p>
        </div>
      </div>

      <div class="flex flex-col gap-3 p-5">
        <div class="flex items-center gap-2.5 rounded border border-brand-warning-text/30 bg-brand-warning-bg px-3 py-2.5">
          <AlertTriangle class="h-4 w-4 shrink-0 text-brand-warning-text" :stroke-width="1.75" />
          <span class="text-sm font-semibold text-brand-warning-text">
            {{ affectedRecords }} registro{{ affectedRecords === 1 ? '' : 's' }} existente{{ affectedRecords === 1 ? '' : 's' }} usa{{ affectedRecords === 1 ? '' : 'n' }} este campo
          </span>
        </div>

        <ul class="flex flex-col gap-1 text-sm text-brand-text-secondary">
          <li v-for="bullet in COPY[action].bullets" :key="bullet" class="flex gap-1.5">
            <span>•</span>
            <span>{{ bullet }}</span>
          </li>
        </ul>

        <label class="flex cursor-pointer items-start gap-2 rounded border border-brand-border-light p-3 text-sm text-brand-text">
          <input v-model="acknowledged" type="checkbox" class="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange" />
          Entiendo que esta acción puede afectar datos existentes
        </label>
      </div>

      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="emit('cancel')">
          Cancelar
        </button>
        <button
          type="button"
          :disabled="!acknowledged || confirming"
          class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="emit('confirm')"
        >
          {{ confirming ? 'Aplicando...' : COPY[action].confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

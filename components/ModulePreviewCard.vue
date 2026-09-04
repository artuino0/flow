<script setup lang="ts">
// HU-ERD-70: card "Vista previa en vivo" - sigue el componente ModulePreview
// del .pen (revisado con las herramientas de Pencil). Criterio de aceptacion
// explicito de la HU: "la vista previa usa el mismo DynamicForm.vue que
// renderiza el formulario real - no una maqueta aparte, para que preview y
// resultado final nunca diverjan" - por eso esto envuelve DynamicForm.vue
// (HU-ERD-23) tal cual, en modo disabled, en vez de reconstruir los inputs
// a mano como hace el diseno (que sí los redibuja con datos de ejemplo).
import { Eye, ListPlus } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

const props = defineProps<{
  moduleName: string
  moduleDescription?: string | null
  fields: EntityFieldMeta[]
  // HU-ERD-78: opcional (a diferencia del requerido en DynamicForm.vue)
  // porque en pages/modulos/nuevo.vue paso 1 ("basica") esta card se
  // renderiza ANTES de que el modulo exista (todavia no hay POST
  // /api/entities) - no hay entityId real que pasar. No es un problema:
  // el formulario aca siempre esta disabled y previewData nunca tiene un
  // valor cargado, asi que DynamicFileField nunca llega a necesitar el id
  // (ni dispara upload ni fetch de metadata). Se pasa '' como fallback
  // solo para satisfacer el tipo de DynamicForm.vue.
  entityId?: string
}>()

const previewData = ref<Record<string, unknown>>({})

// Reportado por el usuario (2026-09-03): props.fields ahora siempre trae el
// campo sintetico "id" (ver fields.get.ts) - DynamicForm.vue ya lo filtra
// solo para el formulario en si, pero el placeholder de abajo ("Los campos
// del formulario se agregarán...") debe seguir apareciendo cuando el modulo
// todavia no tiene NINGUN campo real, no solo cuando fields esta
// literalmente vacio (que ya nunca vuelve a pasar).
const realFieldCount = computed(() => props.fields.filter((f) => f.name !== 'id').length)
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
      <div class="flex items-center gap-2">
        <Eye class="h-[15px] w-[15px] text-brand-blue" :stroke-width="1.75" />
        <h2 class="text-[15px] font-bold text-brand-text">Vista previa en vivo</h2>
      </div>
      <p class="text-[13px] text-brand-text-secondary">
        Así se verá el formulario para crear un registro de {{ moduleName || 'este módulo' }}
      </p>
    </div>

    <div class="p-5">
      <div v-if="realFieldCount === 0" class="flex flex-col items-center gap-2 rounded border border-brand-border bg-brand-surface p-7 text-center">
        <ListPlus class="h-5 w-5 text-brand-text-muted" :stroke-width="1.75" />
        <p class="text-xs text-brand-text-muted">Los campos del formulario se agregarán en el siguiente paso</p>
      </div>
      <DynamicForm v-else :fields="fields" :model-value="previewData" :entity-id="props.entityId ?? ''" disabled />
    </div>
  </div>
</template>

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

defineProps<{
  moduleName: string
  moduleDescription?: string | null
  fields: EntityFieldMeta[]
}>()

const previewData = ref<Record<string, unknown>>({})
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
      <div v-if="fields.length === 0" class="flex flex-col items-center gap-2 rounded border border-brand-border bg-brand-surface p-7 text-center">
        <ListPlus class="h-5 w-5 text-brand-text-muted" :stroke-width="1.75" />
        <p class="text-xs text-brand-text-muted">Los campos del formulario se agregarán en el siguiente paso</p>
      </div>
      <DynamicForm v-else :fields="fields" :model-value="previewData" disabled />
    </div>
  </div>
</template>

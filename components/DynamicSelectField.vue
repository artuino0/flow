<script setup lang="ts">
// HU-ERD-73: renderizado real de los campos Select (opción única) y
// Multiselect (opciones múltiples) en DynamicForm.vue - el editor de sus
// opciones ya existía desde HU-ERD-71 (FieldFormModal.vue), esta HU lo usa
// de verdad. Revisado en el .pen antes de construir
// (`Screen/Form - Campos Select y Multiselect`): caja cerrada con punto de
// color + valor + chevron para Select; chips removibles + input "Agregar
// etiqueta..." para Multiselect, con un dropdown de opciones disponibles.
//
// Simplificación documentada sobre el diseño: el dropdown del .pen paginaba
// implícitamente mostrando pocas opciones a la vez con un conteo de uso por
// valor (ej. "Alta · 11") - ese conteo pertenece al panel de Filtros del
// listado (ver pages/registros/[entity]/index.vue), no a este campo dentro
// de un formulario, así que aquí se omite: la lista siempre muestra TODAS
// las opciones configuradas (validationRules.options), sin buscar/paginar -
// el volumen esperado (badges de estado, prioridad, etiquetas) es chico.
import { computed, ref } from 'vue'
import { Check, ChevronDown, Plus, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import type { SelectOption } from '~/utils/optionColors'

const props = defineProps<{
  field: EntityFieldMeta
  modelValue: unknown
  disabled?: boolean
  detail?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

const options = computed<SelectOption[]>(() => {
  const raw = props.field.validationRules?.options
  return Array.isArray(raw) ? (raw as SelectOption[]) : []
})

const isMultiple = computed(() => props.field.dataType === 'multiselect')

const selectedValues = computed<string[]>(() => {
  if (isMultiple.value) return Array.isArray(props.modelValue) ? (props.modelValue as string[]) : []
  return typeof props.modelValue === 'string' && props.modelValue !== '' ? [props.modelValue as string] : []
})

function optionFor(value: string): SelectOption | undefined {
  return options.value.find((o) => o.value === value)
}

const open = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | undefined

function openDropdown() {
  if (props.disabled) return
  if (closeTimer) clearTimeout(closeTimer)
  open.value = true
}

// Mismo criterio que el dropdown de sugerencias de DynamicTableField.vue: un
// timeout corto en vez de cerrar en el blur inmediato, para que el
// @mousedown.prevent de una opcion alcance a registrarse antes de que el
// dropdown se cierre.
function scheduleClose() {
  closeTimer = setTimeout(() => {
    open.value = false
  }, 150)
}

function selectSingle(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function toggleMultiValue(value: string) {
  const current = selectedValues.value
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  emit('update:modelValue', next)
}

function removeChip(value: string) {
  emit('update:modelValue', selectedValues.value.filter((v) => v !== value))
}

function clearSingle() {
  emit('update:modelValue', null)
}
</script>

<template>
  <div class="relative" :class="{ 'detail-select': detail }">
    <!-- Select: caja cerrada con punto de color + valor + chevron -->
    <button
      v-if="!isMultiple"
      type="button"
      :disabled="disabled"
      class="flex w-full items-center gap-2 rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-left text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:cursor-not-allowed disabled:bg-brand-bg"
      @click="open ? (open = false) : openDropdown()"
      @blur="scheduleClose"
    >
      <span v-if="selectedValues[0] && optionFor(selectedValues[0])" class="h-2.5 w-2.5 shrink-0 rounded-full" :class="colorDotClass(optionFor(selectedValues[0])!.color)" />
      <span class="min-w-0 flex-1 truncate" :class="selectedValues[0] ? 'text-brand-text' : 'text-brand-text-muted'">
        {{ selectedValues[0] ? (optionFor(selectedValues[0])?.label ?? selectedValues[0]) : 'Seleccionar...' }}
      </span>
      <X v-if="selectedValues[0] && !disabled" class="h-3.5 w-3.5 shrink-0 text-brand-text-muted hover:text-brand-text" @mousedown.prevent.stop="clearSingle" />
      <ChevronDown class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="2" />
    </button>

    <div v-if="!isMultiple && open" class="absolute z-50 mt-1 w-full overflow-hidden rounded border border-brand-border-light bg-brand-surface shadow-lg">
      <p v-if="options.length === 0" class="px-3 py-2 text-xs text-brand-text-muted">Sin opciones configuradas.</p>
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-bg"
        @mousedown.prevent="selectSingle(opt.value)"
      >
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="colorDotClass(opt.color)" />
        <span class="min-w-0 flex-1 truncate text-brand-text">{{ opt.label }}</span>
        <Check v-if="selectedValues.includes(opt.value)" class="h-3.5 w-3.5 shrink-0 text-brand-orange" :stroke-width="2.5" />
      </button>
    </div>

    <!-- Multiselect: chips removibles + trigger para agregar -->
    <div v-else-if="isMultiple" class="flex flex-wrap items-center gap-1.5 rounded border border-brand-border bg-brand-surface px-2 py-1.5">
      <span
        v-for="value in selectedValues"
        :key="value"
        class="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
        :class="[colorBadgeClasses(optionFor(value)?.color).bg, colorBadgeClasses(optionFor(value)?.color).text]"
      >
        {{ optionFor(value)?.label ?? value }}
        <X v-if="!disabled" class="h-3 w-3 cursor-pointer" @click="removeChip(value)" />
      </span>
      <button
        v-if="!disabled"
        type="button"
        class="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-brand-text-muted hover:bg-brand-bg"
        @click="open ? (open = false) : openDropdown()"
        @blur="scheduleClose"
      >
        <Plus class="h-3 w-3" :stroke-width="2" />
        Agregar...
      </button>

      <div v-if="open" class="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded border border-brand-border-light bg-brand-surface shadow-lg">
        <p v-if="options.length === 0" class="px-3 py-2 text-xs text-brand-text-muted">Sin opciones configuradas.</p>
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-bg"
          @mousedown.prevent="toggleMultiValue(opt.value)"
        >
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="colorDotClass(opt.color)" />
          <span class="min-w-0 flex-1 truncate text-brand-text">{{ opt.label }}</span>
          <Check v-if="selectedValues.includes(opt.value)" class="h-3.5 w-3.5 shrink-0 text-brand-orange" :stroke-width="2.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-select > button,
.detail-select > div:first-of-type {
  padding-top:6px;
  padding-bottom:6px;
  font-size:13px;
}
</style>

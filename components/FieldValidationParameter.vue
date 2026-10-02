<script setup lang="ts">
import { computed } from 'vue'
import { parameterError, type ValidationParameter } from '~/utils/fieldValidationCatalog'
const props = defineProps<{
  modelValue: unknown; parameter: ValidationParameter; label: string; id: string
  choices?: Array<{ value: string; label: string }>; date?: boolean
  objectFields?: Array<{ value: string; label: string }>
  invalid?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()
const controlClass = 'min-w-0 w-full rounded border border-brand-border bg-brand-surface px-2 py-1.5 text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue'
const selectedUnion = computed(() => Math.max(0, props.parameter.options?.findIndex(p => !parameterError(p, props.modelValue)) ?? 0))
function setUnion(index: number) {
  const p = props.parameter.options![index]
  emit('update:modelValue', p.default ?? p.value ?? (p.type === 'number' ? 0 : p.type === 'boolean' ? false : ''))
}
function updateProperty(key: string, value: unknown) {
  const object = props.modelValue && typeof props.modelValue === 'object' ? props.modelValue as Record<string, unknown> : {}
  emit('update:modelValue', { ...object, [key]: value })
}
const min = computed(() => props.parameter.limits?.find(l => l.kind === 'min')?.value)
const max = computed(() => props.parameter.limits?.find(l => l.kind === 'max')?.value)
const errorId = computed(() => `${props.id}-error`)
</script>

<template>
  <div v-if="parameter.type === 'union'" class="flex flex-wrap gap-2">
    <select :id="id" :aria-label="`${label}: tipo de valor`" :class="controlClass" :value="selectedUnion" @change="setUnion(Number(($event.target as HTMLSelectElement).value))">
      <option v-for="(p, index) in parameter.options" :key="index" :value="index">{{ p.type === 'literal' ? (p.value === 'today' ? 'Hoy' : p.value) : p.type === 'number' ? 'Número' : p.type === 'boolean' ? 'Sí / No' : date ? 'Fecha exacta' : 'Texto' }}</option>
    </select>
    <FieldValidationParameter v-if="parameter.options?.[selectedUnion]?.type !== 'literal'" :id="`${id}-value`" :label="label" :parameter="parameter.options![selectedUnion]!" :model-value="modelValue" :date="date" @update:model-value="emit('update:modelValue', $event)" />
  </div>
  <select v-else-if="parameter.type !== 'array' && (choices || parameter.type === 'enum')" :id="id" :aria-label="label" :aria-invalid="invalid || undefined" :aria-describedby="invalid ? errorId : undefined" :class="controlClass" :value="modelValue" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
    <option value="" disabled>Elegir…</option>
    <option v-for="choice in choices ?? parameter.values?.map(value => ({ value, label: value }))" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
  </select>
  <select v-else-if="parameter.type === 'boolean'" :id="id" :aria-label="label" :class="controlClass" :value="String(modelValue)" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value === 'true')"><option value="true">Sí</option><option value="false">No</option></select>
  <input v-else-if="parameter.type === 'number'" :id="id" :aria-label="label" :aria-invalid="invalid || undefined" :aria-describedby="invalid ? errorId : undefined" :class="controlClass" type="number" :min="min" :max="max" :step="parameter.limits?.some(l => l.kind === 'int') ? 1 : 'any'" :value="modelValue" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value))">
  <input v-else-if="parameter.type === 'string'" :id="id" :aria-label="label" :class="controlClass" :type="date ? 'date' : 'text'" :minlength="min" :maxlength="max" :value="modelValue" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
  <select v-else-if="parameter.type === 'array' && (choices || parameter.items?.type === 'enum')" :id="id" :aria-label="label" :class="controlClass" multiple :value="modelValue" @change="emit('update:modelValue', Array.from(($event.target as HTMLSelectElement).selectedOptions).map(option => option.value))"><option v-for="choice in choices ?? parameter.items?.values?.map(value => ({ value, label: value }))" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select>
  <input v-else-if="parameter.type === 'array'" :id="id" :aria-label="`${label} (separados por coma)`" :class="controlClass" :value="Array.isArray(modelValue) ? modelValue.join(', ') : ''" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value.split(',').map(v => v.trim()).filter(Boolean))">
  <div v-else-if="parameter.type === 'object'" class="flex flex-col gap-2">
    <label v-for="(child, key) in parameter.properties" :key="key" class="text-xs text-brand-text-secondary">{{ key === 'field' ? 'Campo' : key === 'value' ? 'Valor' : key }}
      <FieldValidationParameter :id="`${id}-${key}`" :label="`${label}: ${key}`" :parameter="child" :model-value="(modelValue as Record<string, unknown>)?.[key]" :choices="key === 'field' ? objectFields : undefined" @update:model-value="updateProperty(String(key), $event)" />
    </label>
  </div>
</template>

<script setup lang="ts">
// HU-ERD-23: Form Builder dinamico - renderiza un input por cada entity_field
// segun su dataType/validationRules, sin desarrollo especifico por formulario.
// Los tipos soportados son los del diccionario de datos actual (ERD-7/17):
// text (+ enum), number, boolean, date, json, relation.
import type { EntityFieldMeta } from '~/composables/useEntityFields'

const props = defineProps<{
  fields: EntityFieldMeta[]
  modelValue: Record<string, unknown>
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const errors = ref<Record<string, string>>({})

function valueFor(name: string): unknown {
  return props.modelValue[name]
}

// Para binds de :value en el template - siempre string, evita el quirk de
// TS al tipar `unknown ?? ''` (NonNullable<unknown> colapsa a "{}").
function displayValue(name: string): string {
  const v = props.modelValue[name]
  return v === null || v === undefined ? '' : String(v)
}

function setValue(name: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [name]: value })
}

function onInput(field: EntityFieldMeta, raw: unknown) {
  let value: unknown = raw
  if (field.dataType === 'number' && raw !== '') value = Number(raw)
  if (field.dataType === 'number' && raw === '') value = null
  setValue(field.name, value)
}

function validateAll(): boolean {
  const nextErrors: Record<string, string> = {}
  for (const field of props.fields) {
    const result = validateFieldValue(field, valueFor(field.name))
    if (!result.valid) nextErrors[field.name] = result.error!
  }
  errors.value = nextErrors
  return Object.keys(nextErrors).length === 0
}

defineExpose({ validateAll })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-for="field in fields" :key="field.id" class="flex flex-col gap-1">
      <label :for="`field-${field.name}`" class="text-sm font-medium text-gray-700">
        {{ field.label }}
        <span v-if="field.isRequired" class="text-red-600">*</span>
      </label>

      <!-- text con enum -> select -->
      <select
        v-if="field.dataType === 'text' && Array.isArray(field.validationRules?.enum)"
        :id="`field-${field.name}`"
        :disabled="disabled"
        class="rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @change="onInput(field, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>Seleccionar...</option>
        <option v-for="opt in (field.validationRules!.enum as string[])" :key="opt" :value="opt">{{ opt }}</option>
      </select>

      <!-- text simple -->
      <input
        v-else-if="field.dataType === 'text'"
        :id="`field-${field.name}`"
        type="text"
        :disabled="disabled"
        :maxlength="(field.validationRules?.maxLength as number) || undefined"
        class="rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- number -->
      <input
        v-else-if="field.dataType === 'number'"
        :id="`field-${field.name}`"
        type="number"
        :disabled="disabled"
        :min="field.validationRules?.min as number"
        :max="field.validationRules?.max as number"
        :step="field.validationRules?.integer ? 1 : 'any'"
        class="rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- boolean -->
      <label v-else-if="field.dataType === 'boolean'" class="flex items-center gap-2 text-sm text-gray-700">
        <input
          :id="`field-${field.name}`"
          type="checkbox"
          :disabled="disabled"
          :checked="Boolean(valueFor(field.name))"
          class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          @change="onInput(field, ($event.target as HTMLInputElement).checked)"
        />
        <span>Si</span>
      </label>

      <!-- date -->
      <input
        v-else-if="field.dataType === 'date'"
        :id="`field-${field.name}`"
        type="date"
        :disabled="disabled"
        :min="field.validationRules?.min as string"
        :max="field.validationRules?.max as string"
        class="rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- json -->
      <textarea
        v-else-if="field.dataType === 'json'"
        :id="`field-${field.name}`"
        rows="4"
        :disabled="disabled"
        placeholder="{}"
        class="rounded border border-gray-300 px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLTextAreaElement).value)"
      />

      <!-- relation: id de otro record (uuid) -->
      <input
        v-else-if="field.dataType === 'relation'"
        :id="`field-${field.name}`"
        type="text"
        :disabled="disabled"
        placeholder="uuid del registro relacionado"
        class="rounded border border-gray-300 px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- tipo desconocido: fallback texto -->
      <input
        v-else
        :id="`field-${field.name}`"
        type="text"
        :disabled="disabled"
        class="rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <p v-if="errors[field.name]" class="text-xs text-red-600">{{ errors[field.name] }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { workflowInputType } from '~/utils/workflowFields'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
const props = defineProps<{ modelValue: unknown; dataType?: string; field?: EntityFieldMeta; label: string }>()
const dataType = computed(() => props.field?.dataType ?? props.dataType)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="flex flex-col gap-1.5 text-sm text-brand-text">
    {{ label }}
    <DynamicRelationField v-if="field && dataType === 'relation'" :key="field.name" :field="field" :model-value="modelValue" @update:model-value="emit('update:modelValue', String($event ?? ''))" />
    <DynamicSelectField v-else-if="field && dataType === 'select'" :key="field.name" :field="field" :model-value="modelValue" @update:model-value="emit('update:modelValue', String($event ?? ''))" />
    <select v-else-if="dataType === 'boolean'" :value="String(modelValue ?? 'false')" class="rounded border border-brand-control-border bg-brand-surface px-3 py-2 focus:border-brand-blue focus:outline-none" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option value="false">No</option><option value="true">Sí</option>
    </select>
    <input v-else :value="modelValue ?? ''" :type="workflowInputType({ name: '', dataType: dataType ?? 'text' })" step="any" class="rounded border border-brand-control-border bg-brand-surface px-3 py-2 focus:border-brand-blue focus:outline-none" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
  </label>
</template>

<style scoped>
input, select { color-scheme: inherit; }
</style>

<script setup lang="ts">
import type { PrintLayout } from '~/utils/printLayout'
const props = defineProps<{ modelValue: PrintLayout }>()
const emit = defineEmits<{ 'update:modelValue': [value: PrintLayout] }>()
function update(key: keyof PrintLayout, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>
<template>
  <div class="report-layout-controls">
    <ReportOptionSelect label="Papel" :model-value="modelValue.paper" :options="[{ value: 'letter', label: 'Carta' }, { value: 'a4', label: 'A4' }]" @update:model-value="update('paper', $event)" />
    <ReportOptionSelect label="Orientación" :model-value="modelValue.orientation" :options="[{ value: 'portrait', label: 'Vertical' }, { value: 'landscape', label: 'Horizontal' }]" @update:model-value="update('orientation', $event)" />
    <ReportOptionSelect label="Densidad" :model-value="modelValue.density" :options="[{ value: 'normal', label: 'Normal' }, { value: 'compact', label: 'Compacta' }]" @update:model-value="update('density', $event)" />
  </div>
</template>
<style scoped>
.report-layout-controls { display:flex; flex-wrap:wrap; gap:16px; }
</style>

<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
type Operator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'changed'
interface Row { field: string; operator: Operator; value: string }
const props = defineProps<{ modelValue: Row[]; fields: EntityFieldMeta[]; event: string; single?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [rows: Row[]] }>()
const operators = [{ value:'eq',label:'Es igual a' },{ value:'neq',label:'Es distinto de' },{ value:'gt',label:'Es mayor que' },{ value:'gte',label:'Es mayor o igual a' },{ value:'lt',label:'Es menor que' },{ value:'lte',label:'Es menor o igual a' },{ value:'contains',label:'Contiene' },{ value:'changed',label:'Cambió' }]
function meta(name: string) { return props.fields.find(field => field.name === name) }
function options(row: Row) { return operators.filter(op => op.value === 'changed' ? props.event === 'on_update' : ['gt','gte','lt','lte'].includes(op.value) ? ['number', 'currency'].includes(meta(row.field)?.dataType ?? '') : op.value === 'contains' ? ['text','textarea'].includes(meta(row.field)?.dataType ?? '') : true) }
function patch(index: number, update: Partial<Row>) { emit('update:modelValue', props.modelValue.map((row, i) => i === index ? { ...row, ...update } : row)) }
function add() { const field = props.fields[0]; emit('update:modelValue', [...props.modelValue, { field: field?.name ?? '', operator: 'eq', value: field?.dataType === 'boolean' ? 'false' : '' }]) }
</script>

<template>
  <div class="condition-rows">
    <div v-for="(row, index) in modelValue" :key="index" class="condition-row">
      <div class="condition-heading"><span>{{ single ? 'Comparación' : `Condición ${index + 1}` }}</span><button type="button" :aria-label="`Eliminar condición ${index + 1}`" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))"><Trash2 /></button></div>
      <label>Campo<select :value="row.field" @change="patch(index, { field: ($event.target as HTMLSelectElement).value, operator: 'eq', value: meta(($event.target as HTMLSelectElement).value)?.dataType === 'boolean' ? 'false' : '' })"><option value="" disabled>Selecciona un campo</option><option v-for="field in fields" :key="field.name" :value="field.name">{{ field.label }}</option></select></label>
      <label>Comparación<select :value="row.operator" @change="patch(index, { operator: ($event.target as HTMLSelectElement).value as Operator })"><option v-for="op in options(row)" :key="op.value" :value="op.value">{{ op.label }}</option></select></label>
      <WorkflowFieldValue v-if="row.operator !== 'changed'" :key="row.field" :field="meta(row.field)" :model-value="row.value" label="Valor" @update:model-value="patch(index, { value: $event })" />
      <p v-else>Compara el valor anterior con el nuevo al actualizar el registro.</p>
    </div>
    <button v-if="!single || !modelValue.length" type="button" class="add-condition" @click="add"><Plus />{{ single ? 'Configurar decisión' : 'Agregar condición' }}</button>
  </div>
</template>

<style scoped>
.condition-rows{display:flex;flex-direction:column;gap:18px}.condition-row{display:flex;flex-direction:column;gap:14px;border-top:1px solid rgb(var(--brand-border-light));padding-top:16px}.condition-heading{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:rgb(var(--brand-text-secondary));font-weight:600}.condition-heading button{padding:4px;color:rgb(var(--brand-sites-muted))}.condition-heading svg{width:15px;height:15px}.condition-row label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:rgb(var(--brand-text))}select,input{width:100%;padding:9px 12px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));font-size:13px;font-weight:400;color:rgb(var(--brand-text));min-height:38px}select:focus,input:focus{outline:2px solid rgb(var(--brand-blue));outline-offset:1px}.condition-row p{font-size:12px;line-height:1.5;color:rgb(var(--brand-sites-muted))}.add-condition{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;padding:9px 12px;font-size:13px;font-weight:600;color:rgb(var(--brand-text-secondary))}.add-condition:hover{background:rgb(var(--brand-bg))}.add-condition svg{width:15px;height:15px}
</style>

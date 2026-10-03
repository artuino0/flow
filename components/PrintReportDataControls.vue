<script setup lang="ts">
import { ArrowDownUp, ChevronDown, ListFilter, Plus, Trash2 } from '@lucide/vue'
import type { ColumnSource, FieldTreeBranch, FieldTreeNode, FlatLeaf, PrintReportDsl } from '~/composables/usePrintReports'
import { inputsForType, type ReportParameter } from '~/utils/reportParameters'

type Leaf = FlatLeaf & { side: 'base' | 'detail' }
const props = defineProps<{
  leaves: Leaf[]
  tree: FieldTreeNode[]
  baseName: string
  detailName?: string
  detailFieldName?: string
  activeSection: 'filters' | 'order' | 'columns' | 'calculations' | null
}>()
const emit = defineEmits<{ 'update:activeSection': [value: 'filters' | 'order' | 'columns' | 'calculations' | null] }>()
const filters = defineModel<ReportParameter[]>('filters', { default: () => [] })
const orderBy = defineModel<NonNullable<PrintReportDsl['orderBy']>>('orderBy', { default: () => [] })
const filtersOpen = computed(() => props.activeSection === 'filters')
const orderOpen = computed(() => props.activeSection === 'order')
function toggle(section: 'filters' | 'order') {
  emit('update:activeSection', props.activeSection === section ? null : section)
}

function key(source: ColumnSource): string {
  return JSON.stringify([source.side, ...source.forwardHops, source.field])
}
function source(value: string): ColumnSource {
  const leaf = props.leaves.find(item => key(item) === value)
  return leaf ? { side: leaf.side, forwardHops: leaf.forwardHops, field: leaf.field } : { side: 'base', forwardHops: [], field: '' }
}
function label(leaf: Leaf): string {
  const detailBranch = props.tree.find((node): node is FieldTreeBranch => node.type === 'branch' && node.kind === 'inverse' && node.fieldName === props.detailFieldName)
  let nodes = leaf.side === 'detail' ? detailBranch?.children ?? [] : props.tree
  const path = [leaf.side === 'detail' ? props.detailName : props.baseName]
  for (const hop of leaf.forwardHops) {
    const branch = nodes.find((node): node is FieldTreeBranch => node.type === 'branch' && node.kind === 'forward' && node.fieldName === hop)
    path.push(branch?.entityName ?? hop)
    nodes = branch?.children ?? []
  }
  return [...path, leaf.label].filter(Boolean).join(' › ')
}
const filterOptions = computed(() => props.leaves.filter(leaf => inputsForType(leaf.dataType).length > 0).map(leaf => ({ value: key(leaf), label: label(leaf) })))
const orderOptions = computed(() => props.leaves.map(leaf => ({ value: key(leaf), label: label(leaf) })))

function addFilter() {
  const leaf = props.leaves.find(item => inputsForType(item.dataType).length > 0)
  if (!leaf || filters.value.length >= 12) return
  filters.value = [...filters.value, { id: crypto.randomUUID(), source: source(key(leaf)), input: inputsForType(leaf.dataType)[0]!.value, label: leaf.label, required: false }]
  emit('update:activeSection', 'filters')
}
function changeField(filter: ReportParameter, value: string) {
  const leaf = props.leaves.find(item => key(item) === value)
  if (!leaf) return
  filter.source = source(value)
  filter.input = inputsForType(leaf.dataType)[0]!.value
  filter.label = leaf.label
}
function addOrder() {
  const leaf = props.leaves[0]
  if (!leaf || orderBy.value.length >= 4) return
  orderBy.value = [...orderBy.value, { source: source(key(leaf)), direction: 'asc' }]
  emit('update:activeSection', 'order')
}
function changeOrder(index: number, value: string) {
  const leaf = props.leaves.find(item => key(item) === value)
  if (leaf) orderBy.value[index]!.source = source(value)
}
</script>

<template>
  <div class="border-b border-brand-border-light">
    <button type="button" class="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-brand-bg" :aria-expanded="filtersOpen" @click="toggle('filters')">
      <ListFilter class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
      <span class="min-w-0 flex-1 text-[13px] font-bold text-brand-text">Filtros</span>
      <span class="text-xs font-semibold text-brand-blue">{{ filters.length }} filtros</span>
      <ChevronDown class="h-4 w-4 shrink-0 text-brand-sites-muted transition-transform" :class="filtersOpen ? '' : '-rotate-90'" :stroke-width="1.75" />
    </button>
    <div v-if="filtersOpen" class="flex flex-col gap-3 px-4 pb-4">
      <p class="text-xs leading-5 text-brand-sites-muted">Elige qué preguntar al generar el reporte. Los valores se capturan en cada ejecución.</p>
      <p v-if="!filters.length" class="rounded bg-brand-bg px-3 py-3 text-xs text-brand-text-secondary">Sin filtros configurados.</p>
      <div v-for="(filter, index) in filters" :key="filter.id" class="border-b border-brand-border-light py-4 first:pt-1 last:border-b-0">
        <div class="flex items-center gap-3">
          <PrintReportFieldPicker class="min-w-0 flex-1" :model-value="key(filter.source)" :options="filterOptions" :ariaLabel="'Campo del filtro ' + (index + 1)" @update:model-value="changeField(filter, $event)" />
          <button type="button" :aria-label="'Quitar filtro ' + (index + 1)" class="shrink-0 rounded p-1 text-brand-sites-muted hover:text-brand-error-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" @click="filters = filters.filter((_, i) => i !== index)"><Trash2 class="h-4 w-4" :stroke-width="1.75" /></button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3">
          <label class="min-w-0 text-[11px] font-bold uppercase tracking-wide text-brand-sites-muted">Tipo de entrada
            <select v-model="filter.input" class="mt-1 h-9 w-full rounded border border-brand-control-border bg-brand-surface px-2.5 text-[13px] font-normal normal-case tracking-normal text-brand-text focus:border-brand-blue focus:outline-none"><option v-for="input in inputsForType(leaves.find(leaf => key(leaf) === key(filter.source))?.dataType ?? '')" :key="input.value" :value="input.value">{{ input.label }}</option></select>
          </label>
          <label class="min-w-0 text-[11px] font-bold uppercase tracking-wide text-brand-sites-muted">Etiqueta visible
            <input v-model="filter.label" maxlength="80" class="mt-1 h-9 w-full rounded border border-brand-control-border bg-brand-surface px-2.5 text-[13px] font-normal normal-case tracking-normal text-brand-text focus:border-brand-blue focus:outline-none" />
          </label>
        </div>
        <label class="mt-2.5 flex items-center gap-1.5 text-xs text-brand-text-secondary"><input v-model="filter.required" type="checkbox" class="h-[18px] w-[18px] accent-brand-orange" /> Obligatorio</label>
      </div>
      <button type="button" class="flex items-center gap-1.5 self-start py-1 text-xs font-semibold text-brand-blue hover:underline disabled:opacity-40" :disabled="filters.length >= 12 || !filterOptions.length" @click="addFilter"><Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Agregar filtro</button>
    </div>
  </div>
  <div class="border-b border-brand-border-light">
    <button type="button" class="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-brand-bg" :aria-expanded="orderOpen" @click="toggle('order')">
      <ArrowDownUp class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
      <span class="min-w-0 flex-1 text-[13px] font-bold text-brand-text">Orden de las filas</span>
      <span class="text-xs text-brand-sites-muted">{{ orderBy.length ? `${orderBy.length} criterios` : 'Sin definir' }}</span>
      <ChevronDown class="h-4 w-4 shrink-0 text-brand-sites-muted transition-transform" :class="orderOpen ? '' : '-rotate-90'" :stroke-width="1.75" />
    </button>
    <div v-if="orderOpen" class="flex flex-col gap-3 px-4 pb-4">
      <p class="text-xs leading-5 text-brand-sites-muted">Define un orden por fecha, folio o cualquier otro campo. Sin orden, se muestran como fueron capturados.</p>
      <div v-for="(order, index) in orderBy" :key="index" class="flex flex-col gap-2 rounded border border-brand-border-light bg-brand-bg p-2.5">
        <div class="flex items-center justify-between"><span class="text-xs font-bold text-brand-text">Orden {{ index + 1 }}</span><button type="button" :aria-label="'Quitar orden ' + (index + 1)" class="text-brand-sites-muted hover:text-brand-error-text" @click="orderBy = orderBy.filter((_, i) => i !== index)"><Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" /></button></div>
        <PrintReportFieldPicker :model-value="key(order.source)" :options="orderOptions" :ariaLabel="'Campo de orden ' + (index + 1)" @update:model-value="changeOrder(index, $event)" />
        <select v-model="order.direction" :aria-label="'Dirección de orden ' + (index + 1)" class="w-full rounded border border-brand-control-border bg-brand-surface px-2.5 py-2 text-xs text-brand-text"><option value="asc">Ascendente</option><option value="desc">Descendente</option></select>
      </div>
      <button type="button" class="flex items-center gap-1.5 self-start py-1 text-xs font-semibold text-brand-blue hover:underline disabled:opacity-40" :disabled="orderBy.length >= 4 || !orderOptions.length" @click="addOrder"><Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Agregar orden</button>
    </div>
  </div>
</template>

<style scoped>
input, select { color-scheme: inherit; }
button:focus-visible, select:focus-visible { outline: 2px solid rgb(var(--brand-blue)); outline-offset: 2px; }
</style>

<script setup lang="ts">
import type { ColumnSource, FlatLeaf, PrintReportDsl } from '~/composables/usePrintReports'
import { inputsForType, type ReportParameter } from '~/utils/reportParameters'
type Leaf = FlatLeaf & { side: 'base' | 'detail' }
const props = defineProps<{ leaves: Leaf[]; baseName: string; detailName?: string }>()
const mode = defineModel<'detail' | 'summary'>('mode', { default: 'detail' })
const filters = defineModel<ReportParameter[]>('filters', { default: () => [] })
const orderBy = defineModel<NonNullable<PrintReportDsl['orderBy']>>('orderBy', { default: () => [] })
const open = ref(false)
function key(source: ColumnSource) { return JSON.stringify([source.side, ...source.forwardHops, source.field]) }
function label(leaf: Leaf) { return [leaf.side === 'detail' ? props.detailName : props.baseName, ...leaf.forwardHops, leaf.label].filter(Boolean).join(' › ') }
function source(value: string): ColumnSource {
  const leaf = props.leaves.find(leaf => key(leaf) === value)!
  return { side: leaf.side, forwardHops: leaf.forwardHops, field: leaf.field }
}
function addFilter() {
  const leaf = props.leaves.find(leaf => inputsForType(leaf.dataType).length)
  if (leaf) filters.value = [...filters.value, { id: crypto.randomUUID(), source: source(key(leaf)), input: inputsForType(leaf.dataType)[0]!.value, label: leaf.label, required: false }]
  open.value = true
}
function changeField(filter: ReportParameter, value: string) {
  filter.source = source(value)
  const leaf = props.leaves.find(leaf => key(leaf) === value)!
  filter.input = inputsForType(leaf.dataType)[0]!.value
  filter.label = leaf.label
}
function addOrder() {
  if (props.leaves[0]) orderBy.value = [...orderBy.value, { source: source(key(props.leaves[0])), direction: 'asc' }]
  open.value = true
}
</script>
<template>
  <section class="rounded-lg border border-brand-border-light bg-brand-surface p-4" aria-label="Datos del reporte">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Origen · {{ baseName }}</p>
        <p class="mt-1 text-sm font-semibold text-brand-text">{{ mode === 'summary' ? 'Un resumen por cada grupo configurado' : `Cada fila representa un registro de ${detailName || baseName}` }}</p>
        <p v-if="detailName" class="mt-1 text-xs text-brand-text-muted">Los datos de {{ baseName }} pueden repetirse en sus detalles. Los totales cuentan cada registro de origen una vez.</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-sm">Mostrar
          <select v-model="mode" aria-label="Contenido del reporte" class="rounded border border-brand-border bg-brand-surface px-3 py-2">
            <option value="detail">Detalle y totales</option><option value="summary">Solo grupos y totales</option>
          </select>
        </label>
        <button type="button" class="rounded border border-brand-border px-3 py-2 text-sm" :aria-expanded="open" @click="open = !open">Filtros y orden · {{ filters.length + orderBy.length }}</button>
      </div>
    </div>
    <div v-if="open" class="mt-4 grid gap-6 border-t border-brand-border-light pt-4 xl:grid-cols-2">
      <div>
        <div class="mb-3 flex items-center justify-between"><h3 class="text-sm font-semibold">Filtros</h3><button type="button" class="text-sm text-brand-blue disabled:opacity-40" :disabled="filters.length >= 12 || !leaves.length" @click="addFilter">Agregar filtro</button></div>
        <p class="mb-3 text-xs text-brand-text-muted">Elige qué preguntar al generar el reporte. Los valores se capturan en cada ejecución.</p>
        <div v-for="(filter, index) in filters" :key="index" class="mb-2 flex flex-wrap gap-2">
          <select :value="key(filter.source)" :aria-label="`Campo del filtro ${index + 1}`" class="w-full min-w-0 rounded border border-brand-border p-2 text-sm" @change="changeField(filter, ($event.target as HTMLSelectElement).value)"><option v-for="leaf in leaves.filter(leaf => inputsForType(leaf.dataType).length)" :key="key(leaf)" :value="key(leaf)">{{ label(leaf) }}</option></select>
          <label class="text-xs">Tipo de entrada<select v-model="filter.input" class="mt-1 block rounded border border-brand-border p-2 text-sm"><option v-for="input in inputsForType(leaves.find(leaf => key(leaf) === key(filter.source))?.dataType ?? '')" :key="input.value" :value="input.value">{{ input.label }}</option></select></label>
          <label class="min-w-0 flex-1 text-xs">Etiqueta<input v-model="filter.label" maxlength="80" class="mt-1 w-full rounded border border-brand-border p-2 text-sm" /></label>
          <label class="flex items-center gap-2 text-xs"><input v-model="filter.required" type="checkbox" />Obligatorio</label>
          <button type="button" :aria-label="`Quitar filtro ${index + 1}`" class="px-2 text-brand-text-muted" @click="filters = filters.filter((_, i) => i !== index)">×</button>
        </div>
        <p v-if="filters.length" class="text-xs text-brand-text-muted">Los filtros opcionales pueden dejarse sin aplicar.</p>
      </div>
      <div>
        <div class="mb-3 flex items-center justify-between"><h3 class="text-sm font-semibold">Orden de las filas</h3><button type="button" class="text-sm text-brand-blue disabled:opacity-40" :disabled="orderBy.length >= 4 || !leaves.length" @click="addOrder">Agregar orden</button></div>
        <p v-if="!orderBy.length" class="text-xs text-brand-text-muted">Define un orden por fecha, folio o cualquier otro campo.</p>
        <div v-for="(order, index) in orderBy" :key="index" class="mb-2 flex gap-2">
          <select :value="key(order.source)" :aria-label="`Campo de orden ${index + 1}`" class="min-w-0 flex-1 rounded border border-brand-border p-2 text-sm" @change="order.source = source(($event.target as HTMLSelectElement).value)"><option v-for="leaf in leaves" :key="key(leaf)" :value="key(leaf)">{{ label(leaf) }}</option></select>
          <select v-model="order.direction" :aria-label="`Dirección de orden ${index + 1}`" class="rounded border border-brand-border p-2 text-sm"><option value="asc">Ascendente</option><option value="desc">Descendente</option></select>
          <button type="button" :aria-label="`Quitar orden ${index + 1}`" class="px-2 text-brand-text-muted" @click="orderBy = orderBy.filter((_, i) => i !== index)">×</button>
        </div>
      </div>
    </div>
  </section>
</template>

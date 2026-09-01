<script setup lang="ts">
// HU-ERD-75: card "Listado de registros" - configurador del "Diseño del
// listado" (Table Builder, Screen/Table Builder del .pen, revisado con las
// herramientas de Pencil antes de construir). Tres secciones: COLUMNAS
// VISIBLES (que campos propios se muestran en DynamicTable.vue y en que
// orden), FILTROS DISPONIBLES (subconjunto curado de los campos Select/
// Multiselect que se ofrecen como filtro en el listado real, ver
// server/utils/listLayout.ts) y ORDEN POR DEFECTO (campo + direccion).
//
// Mismas simplificaciones ya establecidas en ModuleDetailLayoutCard.vue
// (HU-ERD-74): reordenar con botones ↑/↓ en vez de arrastrar, etiqueta de
// texto simple por tipo (fieldTypeLabel, ahora compartida - ver
// utils/fieldTypeLabels.ts).
import { ChevronDown } from '@lucide/vue'
import type { EntityFieldMeta, ListLayout } from '~/composables/useEntityFields'

const props = defineProps<{
  fields: EntityFieldMeta[]
  modelValue: ListLayout
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ListLayout]
}>()

function fieldMeta(name: string): EntityFieldMeta | undefined {
  return props.fields.find((f) => f.name === name)
}

// HU-ERD-73: los unicos campos con un operador de filtro real hoy son
// Select/Multiselect - mismo calculo que server/api/entities/[entity]/fields.get.ts
// (filterFields de listLayout nunca puede ofrecer nada fuera de este conjunto,
// criterio de aceptacion explicito de la HU).
const filterableCandidates = computed(() => props.fields.filter((f) => f.dataType === 'select' || f.dataType === 'multiselect'))

function toggleColumnVisible(name: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    columns: props.modelValue.columns.map((c) => (c.name === name ? { ...c, visible: !c.visible } : c))
  })
}
function moveColumn(index: number, dir: -1 | 1) {
  const target = index + dir
  const list = props.modelValue.columns
  if (target < 0 || target >= list.length) return
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  emit('update:modelValue', { ...props.modelValue, columns: next })
}

function toggleFilterField(name: string) {
  const included = props.modelValue.filterFields.includes(name)
  emit('update:modelValue', {
    ...props.modelValue,
    filterFields: included ? props.modelValue.filterFields.filter((f) => f !== name) : [...props.modelValue.filterFields, name]
  })
}

function setDefaultSortField(field: string) {
  if (!field) {
    emit('update:modelValue', { ...props.modelValue, defaultSort: null })
    return
  }
  emit('update:modelValue', { ...props.modelValue, defaultSort: { field, dir: props.modelValue.defaultSort?.dir ?? 'desc' } })
}
function setDefaultSortDir(dir: 'asc' | 'desc') {
  if (!props.modelValue.defaultSort) return
  emit('update:modelValue', { ...props.modelValue, defaultSort: { ...props.modelValue.defaultSort, dir } })
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
      <h2 class="text-[15px] font-bold text-brand-text">Listado de registros</h2>
      <p class="text-sm text-brand-text-secondary">Elegí las columnas, filtros disponibles y el orden por defecto</p>
    </div>

    <div class="flex flex-col gap-5 p-5">
      <div class="flex flex-col gap-1.5">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Columnas visibles</p>
        <p v-if="modelValue.columns.length === 0" class="text-xs text-brand-text-muted">Este módulo todavía no tiene campos.</p>
        <div
          v-for="(col, index) in modelValue.columns"
          :key="col.name"
          class="flex items-center gap-2.5 rounded px-1.5 py-1.5 hover:bg-brand-bg"
        >
          <input type="checkbox" :checked="col.visible" class="h-3.5 w-3.5 shrink-0" @change="toggleColumnVisible(col.name)" />
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">{{ fieldMeta(col.name)?.label ?? col.name }}</span>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">
            {{ fieldTypeLabel(fieldMeta(col.name)?.dataType) }}
          </span>
          <div class="flex shrink-0 gap-0.5">
            <button type="button" title="Mover arriba" :disabled="index === 0" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveColumn(index, -1)">
              <ChevronDown class="h-3.5 w-3.5 rotate-180" :stroke-width="1.75" />
            </button>
            <button type="button" title="Mover abajo" :disabled="index === modelValue.columns.length - 1" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveColumn(index, 1)">
              <ChevronDown class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1.5 border-t border-brand-border-light pt-4">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Filtros disponibles</p>
        <p v-if="filterableCandidates.length === 0" class="text-xs text-brand-text-muted">
          Este módulo todavía no tiene campos Select o Multiselect (los únicos que se pueden ofrecer como filtro).
        </p>
        <label
          v-for="f in filterableCandidates"
          :key="f.id"
          class="flex cursor-pointer items-center gap-2.5 rounded px-1.5 py-1.5 hover:bg-brand-bg"
        >
          <input type="checkbox" :checked="modelValue.filterFields.includes(f.name)" class="h-3.5 w-3.5 shrink-0" @change="toggleFilterField(f.name)" />
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">{{ f.label }}</span>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">{{ fieldTypeLabel(f.dataType) }}</span>
        </label>
      </div>

      <div class="flex flex-col gap-2 border-t border-brand-border-light pt-4">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Orden por defecto</p>
        <select
          :value="modelValue.defaultSort?.field ?? ''"
          class="w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          @change="setDefaultSortField(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Sin orden por defecto (fecha de creación, descendente)</option>
          <option v-for="f in fields" :key="f.id" :value="f.name">{{ f.label }}</option>
        </select>
        <div v-if="modelValue.defaultSort" class="flex w-full max-w-[220px] gap-0.5 rounded-full bg-brand-bg p-[3px]">
          <button
            type="button"
            class="flex-1 rounded px-2.5 py-1.5 text-xs font-semibold"
            :class="modelValue.defaultSort.dir === 'asc' ? 'bg-brand-surface text-brand-text shadow' : 'text-brand-text-secondary'"
            @click="setDefaultSortDir('asc')"
          >
            Ascendente
          </button>
          <button
            type="button"
            class="flex-1 rounded px-2.5 py-1.5 text-xs font-semibold"
            :class="modelValue.defaultSort.dir === 'desc' ? 'bg-brand-surface text-brand-text shadow' : 'text-brand-text-secondary'"
            @click="setDefaultSortDir('desc')"
          >
            Descendente
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

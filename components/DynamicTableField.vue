<script setup lang="ts">
// HU-ERD-72: widget de campo "Tabla" dentro de DynamicForm.vue - filas
// dinamicas, autocomplete por columna de relacion, columnas copiadas
// (copyFrom, snapshot - ver DOCS/Diseno_Pantallas_Faltantes_Fase2.md
// "Semantica de copia") prellenadas y opcionalmente editables, columna de
// solo lectura calculada en vivo (subtotal) y total del bloque. Sigue
// Screen/Form Pedido (Campo Tabla) + Screen/Detalle Pedido (Campo Tabla) del
// .pen (revisado con las herramientas de Pencil).
//
// Decision de alcance (Jira dejaba abierto si se suma una ficha de detalle
// de solo lectura nueva, o si la tabla se renderiza en modo solo lectura
// dentro del mismo formulario): se elige la segunda opcion - reusar
// DynamicForm.vue con su prop `disabled` ya existente (la misma que usa
// ModulePreviewCard.vue) en vez de crear una pagina de detalle nueva, que
// seria un cambio de arquitectura mucho mas grande (afecta a TODAS las
// entidades, no solo a los campos Tabla) y no pedido explicitamente por esta
// HU. El criterio de "el snapshot nunca se recalcula al mostrarlo" se
// cumple porque una fila YA guardada (cargada desde customData) nunca vuelve
// a copiar/recalcular sus valores - la copia (applyCopyFrom) solo corre al
// ELEGIR una relacion nueva, nunca al montar el componente con datos
// existentes.
//
// "Columna de solo lectura calculada en vivo" (subtotal): el schema de
// columnas (server/utils/dynamicSchema.ts) no define ningun lenguaje de
// formula - siguiendo el principio ya establecido en el proyecto de "nunca
// eval, nunca recalcular dinamicamente" (Epic ERD-46), NO se interpreta
// ningun string de formula. En su lugar, una columna `readonly` de tipo
// `number` se calcula con una convencion fija y generica, sin eval: el
// PRODUCTO de las demas columnas `type: 'number'` no-readonly de la misma
// fila (reproduce exactamente "cantidad x precio_unitario" del ejemplo de
// DOCS, sin necesitar un campo de formula). Documentado aca porque es una
// simplificacion deliberada, no un motor de calculo generico - si a futuro
// se necesita algo mas flexible, eso es una HU de "campos calculados" aparte.
import { computed, onMounted, reactive } from 'vue'
import { Info, Package, Plus, Search, Sigma, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

interface ColumnDef {
  name: string
  label: string
  type: string
  relationEntity?: string
  copyFrom?: string
  editable?: boolean
  readonly?: boolean
}

type Row = Record<string, unknown>

const props = defineProps<{
  field: EntityFieldMeta
  modelValue: Row[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [rows: Row[]]
}>()

const columns = computed<ColumnDef[]>(() => {
  const rules = (props.field.validationRules ?? {}) as Record<string, unknown>
  return Array.isArray(rules.columns) ? (rules.columns as ColumnDef[]) : []
})

const readonlyNumericColumn = computed(() => columns.value.find((c) => c.readonly && c.type === 'number') ?? null)

function computeReadonly(row: Row, col: ColumnDef): number {
  const factors = columns.value
    .filter((c) => c.type === 'number' && !c.readonly && c.name !== col.name)
    .map((c) => Number(row[c.name]))
  if (factors.length === 0 || factors.some((n) => !Number.isFinite(n))) return 0
  return factors.reduce((a, b) => a * b, 1)
}

/** Recalcula (sin eval - ver comentario de arriba) y "hornea" las columnas readonly antes de emitir, para que lo persistido sea siempre un numero fijo. */
function bakeReadonly(rows: Row[]): Row[] {
  if (!readonlyNumericColumn.value) return rows
  return rows.map((r) => {
    const next = { ...r }
    for (const c of columns.value) {
      if (c.readonly && c.type === 'number') next[c.name] = computeReadonly(next, c)
    }
    return next
  })
}

function emptyRow(): Row {
  const row: Row = {}
  for (const c of columns.value) {
    if (c.readonly) row[c.name] = 0
    else if (c.type === 'boolean') row[c.name] = false
    else if (c.type === 'number') row[c.name] = null
    else row[c.name] = ''
  }
  return row
}

function updateRow(idx: number, name: string, value: unknown) {
  const next = props.modelValue.map((r, i) => (i === idx ? { ...r, [name]: value } : r))
  emit('update:modelValue', bakeReadonly(next))
}

function addRow() {
  emit('update:modelValue', bakeReadonly([...props.modelValue, emptyRow()]))
}
function removeRow(idx: number) {
  emit('update:modelValue', bakeReadonly(props.modelValue.filter((_, i) => i !== idx)))
}

const total = computed(() => {
  if (!readonlyNumericColumn.value) return null
  return props.modelValue.reduce((sum, r) => sum + (Number(r[readonlyNumericColumn.value!.name]) || 0), 0)
})
function formatNumber(n: number): string {
  return n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// --- Autocomplete de columnas de relacion (busca records de OTRA entidad
// por texto libre, GET /api/records/:entity?search=..., HU-ERD-72) ---
// Reportado por el usuario (2026-09-03): ademas de los campos, se cachea
// entity.labelField (la eleccion explicita, si existe - ver comentario largo
// en server/db/schema.ts) para pasarselo a labelForRecord() como override -
// sin esto, esta busqueda seguia usando SIEMPRE la heuristica automatica
// aunque el usuario ya hubiera fijado a mano un campo distinto desde
// ModuleListLayoutCard.vue.
interface RelationEntityMeta {
  fields: EntityFieldMeta[]
  labelField: string | null
}
const entityFieldsCache = reactive<Record<string, RelationEntityMeta>>({})
async function ensureEntityFields(slug: string): Promise<RelationEntityMeta> {
  if (entityFieldsCache[slug]) return entityFieldsCache[slug]
  try {
    const res = await $fetch<{ entity: { labelField: string | null }; fields: EntityFieldMeta[] }>(`/api/entities/${slug}/fields`)
    entityFieldsCache[slug] = { fields: res.fields, labelField: res.entity.labelField ?? null }
  } catch {
    entityFieldsCache[slug] = { fields: [], labelField: null }
  }
  return entityFieldsCache[slug]
}
// labelFieldFor()/labelForRecord(): HU-ERD-74 las extrajo a
// utils/recordLabel.ts (auto-importado) para reusarlas tal cual en
// RecordDetailView.vue (encabezado de la ficha de detalle real) - mismo
// criterio que utils/slugify.ts.

const labelCache = reactive<Record<string, string>>({})
function cacheKey(slug: string, id: string): string {
  return `${slug}:${id}`
}

interface SearchState {
  query: string
  open: boolean
  loading: boolean
  results: Array<{ id: string; label: string; customData: Record<string, unknown> }>
}
const searchState = reactive<Record<number, SearchState>>({})
function stateFor(idx: number): SearchState {
  if (!searchState[idx]) searchState[idx] = { query: '', open: false, loading: false, results: [] }
  return searchState[idx]
}

const debounceTimers: Record<number, ReturnType<typeof setTimeout>> = {}
function onSearchInput(idx: number, col: ColumnDef, value: string) {
  const state = stateFor(idx)
  state.query = value
  state.open = true
  clearTimeout(debounceTimers[idx])
  debounceTimers[idx] = setTimeout(() => void runSearch(idx, col), 250)
}
async function runSearch(idx: number, col: ColumnDef) {
  const state = stateFor(idx)
  if (!col.relationEntity || !state.query.trim()) {
    state.results = []
    return
  }
  state.loading = true
  try {
    const [meta, res] = await Promise.all([
      ensureEntityFields(col.relationEntity),
      $fetch<{ data: Array<{ id: string; customData: Record<string, unknown> }> }>(`/api/records/${col.relationEntity}`, {
        query: { search: state.query, pageSize: 6 }
      })
    ])
    state.results = res.data.map((r) => ({ id: r.id, label: labelForRecord(meta.fields, r.customData, r.id, meta.labelField), customData: r.customData }))
    for (const r of state.results) labelCache[cacheKey(col.relationEntity, r.id)] = r.label
  } catch {
    state.results = []
  } finally {
    state.loading = false
  }
}

function applyCopyFrom(idx: number, relationCol: ColumnDef, customData: Record<string, unknown>) {
  if (!relationCol.relationEntity) return
  const prefix = `${relationCol.relationEntity}.`
  let next = props.modelValue
  for (const c of columns.value) {
    if (c.copyFrom?.startsWith(prefix)) {
      const sourceField = c.copyFrom.slice(prefix.length)
      next = next.map((r, i) => (i === idx ? { ...r, [c.name]: customData[sourceField] ?? null } : r))
    }
  }
  emit('update:modelValue', bakeReadonly(next))
}

function selectSuggestion(idx: number, col: ColumnDef, result: { id: string; label: string; customData: Record<string, unknown> }) {
  if (col.relationEntity) labelCache[cacheKey(col.relationEntity, result.id)] = result.label
  updateRow(idx, col.name, result.id)
  applyCopyFrom(idx, col, result.customData)
  const state = stateFor(idx)
  state.open = false
  state.query = ''
}
function clearRelation(idx: number, col: ColumnDef) {
  updateRow(idx, col.name, '')
}
function closeSuggestions(idx: number) {
  // Deja que el click en una sugerencia se procese antes de cerrar la lista.
  setTimeout(() => {
    const state = searchState[idx]
    if (state) state.open = false
  }, 150)
}

// Resuelve la etiqueta de un valor de relacion YA guardado (fila existente,
// cargada desde customData - solo tenemos el uuid) - se hace una sola vez al
// montar, nunca en cada render, y solo del lado del cliente (esta busqueda
// es puramente de exhibicion, no forma parte de la carga SSR del formulario).
async function resolveExistingLabel(id: string, col: ColumnDef) {
  if (!col.relationEntity) return
  const key = cacheKey(col.relationEntity, id)
  if (labelCache[key]) return
  try {
    const [meta, record] = await Promise.all([
      ensureEntityFields(col.relationEntity),
      $fetch<{ customData: Record<string, unknown> }>(`/api/records/${col.relationEntity}/${id}`)
    ])
    labelCache[key] = labelForRecord(meta.fields, record.customData, id, meta.labelField)
  } catch {
    labelCache[key] = id.slice(0, 8)
  }
}
onMounted(() => {
  for (const row of props.modelValue) {
    for (const col of columns.value) {
      if (col.type === 'relation' && typeof row[col.name] === 'string' && row[col.name]) {
        void resolveExistingLabel(row[col.name] as string, col)
      }
    }
  }
})
</script>

<template>
  <div class="flex flex-col gap-3 rounded border border-brand-border-light bg-brand-surface p-3">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr class="border-b border-brand-border-light">
            <th v-for="col in columns" :key="col.name" class="px-2 py-1.5 text-left text-xs font-semibold text-brand-text-secondary">{{ col.label }}</th>
            <th v-if="!disabled" class="w-8" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in modelValue" :key="idx" class="border-b border-brand-border-light last:border-b-0">
            <td v-for="col in columns" :key="col.name" class="px-2 py-1.5 align-top">
              <!-- columna de relacion: chip si ya hay valor, buscador si no -->
              <template v-if="col.type === 'relation'">
                <div v-if="row[col.name]" class="flex items-center gap-1.5 rounded-full bg-brand-blue-bg px-2 py-1">
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-surface">
                    <Package class="h-3 w-3 text-brand-blue" :stroke-width="1.75" />
                  </span>
                  <span class="truncate text-xs font-semibold text-brand-blue">
                    {{ col.relationEntity ? (labelCache[`${col.relationEntity}:${row[col.name]}`] ?? '...') : String(row[col.name]) }}
                  </span>
                  <button v-if="!disabled" type="button" class="text-brand-blue hover:text-brand-error-text" @click="clearRelation(idx, col)">
                    <X class="h-3 w-3" :stroke-width="2" />
                  </button>
                </div>
                <div v-else-if="!disabled" class="relative">
                  <div class="flex items-center gap-1.5 rounded border border-brand-border px-2 py-1">
                    <Search class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
                    <input
                      type="text"
                      :placeholder="`Buscar ${col.label.toLowerCase()}...`"
                      class="min-w-0 flex-1 border-0 p-0 text-xs text-brand-text focus:outline-none focus:ring-0"
                      :value="stateFor(idx).query"
                      @input="onSearchInput(idx, col, ($event.target as HTMLInputElement).value)"
                      @focus="stateFor(idx).open = true"
                      @blur="closeSuggestions(idx)"
                    />
                  </div>
                  <div
                    v-if="stateFor(idx).open && (stateFor(idx).loading || stateFor(idx).results.length > 0 || stateFor(idx).query)"
                    class="absolute z-10 mt-1 w-56 max-w-xs rounded border border-brand-border-light bg-brand-surface py-1 shadow-xl"
                  >
                    <p v-if="stateFor(idx).loading" class="px-2.5 py-1.5 text-xs text-brand-text-muted">Buscando...</p>
                    <p v-else-if="stateFor(idx).results.length === 0" class="px-2.5 py-1.5 text-xs text-brand-text-muted">Sin resultados</p>
                    <button
                      v-for="r in stateFor(idx).results"
                      :key="r.id"
                      type="button"
                      class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-brand-text hover:bg-brand-bg"
                      @mousedown.prevent="selectSuggestion(idx, col, r)"
                    >
                      <Package class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
                      {{ r.label }}
                    </button>
                  </div>
                </div>
                <span v-else class="text-xs text-brand-text-muted">-</span>
              </template>

              <!-- columna de solo lectura calculada en vivo (ej. subtotal) -->
              <div v-else-if="col.readonly" class="flex items-center gap-1 rounded bg-brand-bg px-2 py-1">
                <Sigma class="h-3 w-3 text-brand-text-muted" :stroke-width="1.75" />
                <span class="text-xs text-brand-text-secondary">{{ formatNumber(Number(row[col.name]) || 0) }}</span>
              </div>

              <!-- copiada y sin marcar editable: valor fijo, no es un input -->
              <span v-else-if="col.copyFrom && !col.editable" class="text-xs text-brand-text">{{ row[col.name] }}</span>

              <!-- boolean -->
              <input
                v-else-if="col.type === 'boolean'"
                type="checkbox"
                :disabled="disabled"
                :checked="Boolean(row[col.name])"
                class="h-4 w-4 rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange"
                @change="updateRow(idx, col.name, ($event.target as HTMLInputElement).checked)"
              />

              <!-- date -->
              <input
                v-else-if="col.type === 'date'"
                type="date"
                :disabled="disabled"
                :value="row[col.name] ?? ''"
                class="w-full rounded border-0 bg-transparent px-1 py-0.5 text-xs text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:text-brand-text-muted"
                @input="updateRow(idx, col.name, ($event.target as HTMLInputElement).value)"
              />

              <!-- number (plana o copiada+editable) -->
              <input
                v-else-if="col.type === 'number'"
                type="number"
                :disabled="disabled"
                :value="row[col.name] ?? ''"
                class="w-full rounded border-0 bg-transparent px-1 py-0.5 text-xs text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:text-brand-text-muted"
                @input="updateRow(idx, col.name, ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value))"
              />

              <!-- text (plana o copiada+editable) -->
              <input
                v-else
                type="text"
                :disabled="disabled"
                :value="row[col.name] ?? ''"
                class="w-full rounded border-0 bg-transparent px-1 py-0.5 text-xs text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:text-brand-text-muted"
                @input="updateRow(idx, col.name, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td v-if="!disabled" class="px-2 py-1.5 text-right">
              <button type="button" title="Quitar fila" class="text-brand-text-muted hover:text-brand-error-text" @click="removeRow(idx)">
                <X class="h-3.5 w-3.5" :stroke-width="1.75" />
              </button>
            </td>
          </tr>
          <tr v-if="modelValue.length === 0">
            <td :colspan="columns.length + (disabled ? 0 : 1)" class="px-2 py-3 text-center text-xs text-brand-text-muted">Sin filas todavía.</td>
          </tr>
        </tbody>
        <tfoot v-if="total !== null && modelValue.length > 0">
          <tr class="border-t border-brand-border-light">
            <td :colspan="columns.length - 1" class="px-2 py-1.5 text-right text-xs font-semibold text-brand-text-secondary">Total</td>
            <td class="px-2 py-1.5 text-sm font-bold text-brand-text">{{ formatNumber(total) }}</td>
            <td v-if="!disabled" />
          </tr>
        </tfoot>
      </table>
    </div>

    <button v-if="!disabled" type="button" class="flex items-center gap-1.5 self-start rounded border border-brand-border px-3 py-1.5 text-xs font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="addRow">
      <Plus class="h-3.5 w-3.5" :stroke-width="2" />
      Agregar línea
    </button>

    <p v-if="disabled && modelValue.length > 0" class="flex items-center gap-1.5 rounded bg-brand-bg px-2.5 py-2 text-xs text-brand-text-muted">
      <Info class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
      Estos valores se guardaron en su momento y no reflejan el estado actual de los registros relacionados.
    </p>
  </div>
</template>

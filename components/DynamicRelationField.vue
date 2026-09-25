<script setup lang="ts">
// Campo "relation" de nivel superior (no dentro de un campo Tabla) - hasta
// ahora DynamicForm.vue lo renderizaba como una caja de texto plana pidiendo
// pegar a mano el uuid del registro relacionado ("uuid del registro
// relacionado"), la misma limitacion que HU-ERD-72 ya habia resuelto para las
// columnas de relacion DENTRO de un campo Tabla (DynamicTableField.vue:
// buscador con autocomplete + chip con la etiqueta resuelta).
//
// Se construye este componente hermano (mismo patron ya establecido de
// delegar tipos de campo complejos a su propio componente: DynamicSelectField.vue
// HU-ERD-73, DynamicTableField.vue HU-ERD-72) en vez de generalizar
// DynamicTableField.vue para una sola celda, porque ese componente esta
// armado alrededor de filas/columnas de una tabla, no de un campo suelto -
// forzarlo a un caso "una fila, una columna" seria mas rebuscado que
// reimplementar el mismo buscador (search + debounce + chip + resolucion de
// etiqueta ya guardada) para un solo valor. La logica de busqueda es
// deliberadamente la misma: GET /api/records/:entity?search=... (ERD-72) +
// utils/recordLabel.ts (ERD-74, la misma heuristica de "primer campo text").
//
// Necesario para poder construir el flujo Recepcion -> Empaque -> Embarque
// (pedido 2026-09-01) con una UX real: un campo relation ahi (ej. "Recepcion
// de origen" en Empaque) no es razonable pedirselo al usuario como un uuid
// escrito a mano.
import { computed, onMounted, reactive, ref } from 'vue'
import { Link2, Search, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

const props = defineProps<{
  field: EntityFieldMeta
  modelValue: unknown
  disabled?: boolean
  detail?: boolean
  initialLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

const relationEntity = computed<string | null>(() => {
  const rules = (props.field.validationRules ?? {}) as Record<string, unknown>
  return typeof rules.relationEntity === 'string' && rules.relationEntity ? rules.relationEntity : null
})

const currentValue = computed<string>(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))

const labelCache = reactive<Record<string, string>>({})
function cacheKey(id: string): string {
  return `${relationEntity.value}:${id}`
}

interface SearchResult { id: string; label: string }
const query = ref('')
const open = ref(false)
const loading = ref(false)
const results = ref<SearchResult[]>([])
let debounceTimer: ReturnType<typeof setTimeout> | undefined

// Reportado por el usuario (2026-09-03): ademas de los campos, se cachea
// entity.labelField (la eleccion explicita, si existe - ver comentario largo
// en server/db/schema.ts) para pasarselo a labelForRecord() como override -
// mismo criterio que DynamicTableField.vue.
interface RelationEntityMeta {
  fields: EntityFieldMeta[]
  labelField: string | null
  isActive: boolean
}
let metaCache: RelationEntityMeta | null = null
const targetDisabled = ref(false)

async function ensureRelationFields(): Promise<RelationEntityMeta> {
  if (metaCache) return metaCache
  if (!relationEntity.value) return { fields: [], labelField: null, isActive: true }
  try {
    const res = await $fetch<{ entity: { labelField: string | null; isActive: boolean; deletedAt?: string | null }; fields: EntityFieldMeta[] }>(`/api/entities/${relationEntity.value}/fields`)
    metaCache = { fields: res.fields, labelField: res.entity.labelField ?? null, isActive: res.entity.isActive && !res.entity.deletedAt }
    targetDisabled.value = !metaCache.isActive
  } catch {
    metaCache = { fields: [], labelField: null, isActive: false }
    targetDisabled.value = true
  }
  return metaCache
}

function onSearchInput(value: string) {
  query.value = value
  open.value = true
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void runSearch(), 250)
}

async function runSearch() {
  if (!relationEntity.value) {
    results.value = []
    return
  }
  loading.value = true
  try {
    const meta = await ensureRelationFields()
    if (!meta.isActive) { results.value = []; return }
    const res = await $fetch<{ data: Array<{ id: string; customData: Record<string, unknown> }> }>(`/api/records/${relationEntity.value}`, {
        query: { search: query.value.trim() || undefined, pageSize: 20, sortBy: 'createdAt', sortDir: 'desc' }
      })
    results.value = res.data.map((r) => ({ id: r.id, label: labelForRecord(meta.fields, r.customData, r.id, meta.labelField) }))
    for (const r of results.value) labelCache[cacheKey(r.id)] = r.label
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

function selectResult(result: SearchResult) {
  labelCache[cacheKey(result.id)] = result.label
  emit('update:modelValue', result.id)
  open.value = false
  query.value = ''
}

function clearValue() {
  emit('update:modelValue', null)
}

// Al enfocar se despliegan las opciones disponibles sin exigir escribir;
// escribir solo filtra.
function onFocus() {
  open.value = true
  if (!results.value.length) void runSearch()
}

function closeSuggestions() {
  // Deja que el mousedown de una sugerencia se procese antes de cerrar la lista.
  setTimeout(() => {
    open.value = false
  }, 150)
}

// Resuelve la etiqueta de un valor ya guardado (solo tenemos el uuid al
// cargar el formulario) - una vez al montar, del lado del cliente, mismo
// criterio que resolveExistingLabel() de DynamicTableField.vue.
async function resolveExistingLabel(id: string) {
  if (!relationEntity.value) return
  const key = cacheKey(id)
  if (labelCache[key]) return
  try {
    const [meta, record] = await Promise.all([
      ensureRelationFields(),
      $fetch<{ customData: Record<string, unknown> }>(`/api/records/${relationEntity.value}/${id}`)
    ])
    labelCache[key] = labelForRecord(meta.fields, record.customData, id, meta.labelField)
  } catch {
    labelCache[key] = id.slice(0, 8)
  }
}
onMounted(() => {
  if (currentValue.value && !props.initialLabel) void resolveExistingLabel(currentValue.value)
  else if (relationEntity.value) void ensureRelationFields()
})
</script>

<template>
  <div :class="{ 'detail-relation': detail }">
    <!-- sin relationEntity configurado (campo relation "crudo", ERD-17 previo a ERD-74): fallback al input de uuid original -->
    <input
      v-if="!relationEntity"
      :id="`field-${field.name}`"
      type="text"
      :disabled="disabled"
      placeholder="uuid del registro relacionado"
      class="w-full rounded border border-brand-border px-3 py-[9px] font-mono text-sm text-brand-text placeholder:text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
      :value="currentValue"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />

    <div v-else-if="currentValue" class="flex items-center gap-2 rounded border border-brand-border bg-brand-blue-bg px-3 py-[7px]">
      <Link2 class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="1.75" />
      <span class="flex-1 truncate text-sm font-semibold text-brand-blue">{{ labelCache[cacheKey(currentValue)] ?? initialLabel ?? '...' }}</span>
      <button v-if="!disabled" type="button" class="text-brand-blue hover:text-brand-error-text" @click="clearValue">
        <X class="h-3.5 w-3.5" :stroke-width="2" />
      </button>
    </div>

    <p v-else-if="targetDisabled" class="text-sm text-brand-text-muted">El módulo relacionado está deshabilitado.</p>
    <div v-else-if="!disabled" class="relative">
      <div class="flex items-center gap-2 rounded border border-brand-border px-3 py-[7px] focus-within:border-brand-blue focus-within:ring-1 focus-within:ring-brand-blue">
        <Search class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
        <input
          :id="`field-${field.name}`"
          type="text"
          :placeholder="`Buscar ${field.label.toLowerCase()}...`"
          class="min-w-0 flex-1 border-0 p-0 text-sm text-brand-text focus:outline-none focus:ring-0"
          :value="query"
          @input="onSearchInput(($event.target as HTMLInputElement).value)"
          @focus="onFocus"
          @blur="closeSuggestions"
        />
      </div>
      <div
        v-if="open"
        class="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded border border-brand-border-light bg-brand-surface py-1 shadow-xl"
      >
        <p v-if="loading" class="px-3 py-1.5 text-xs text-brand-text-muted">Buscando...</p>
        <p v-else-if="results.length === 0" class="px-3 py-1.5 text-xs text-brand-text-muted">Sin resultados</p>
        <button
          v-for="r in results"
          :key="r.id"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg"
          @mousedown.prevent="selectResult(r)"
        >
          <Link2 class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
          {{ r.label }}
        </button>
      </div>
    </div>

    <span v-else class="text-sm text-brand-text-muted">-</span>
  </div>
</template>

<style scoped>
.detail-relation > input,
.detail-relation > div {
  font-size:13px;
}
</style>

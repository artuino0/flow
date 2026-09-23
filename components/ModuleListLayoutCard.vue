<script setup lang="ts">
// HU-ERD-75: card "Listado de registros" - configurador del "Diseño del
// listado" (Table Builder, Screen/Table Builder del .pen). Tres secciones:
// COLUMNAS VISIBLES (que campos propios se muestran en DynamicTable.vue y en
// que orden), FILTROS DISPONIBLES (subconjunto curado de los campos Select/
// Multiselect que se ofrecen como filtro en el listado real, ver
// server/utils/listLayout.ts) y ORDEN POR DEFECTO (campo + direccion).
//
// Reportado por el usuario (2026-09-03, "no mames ni se parece al pencil"):
// la primera version de esta tarjeta simplificaba el reorder a botones ↑/↓ y
// usaba checkboxes nativos - revisando el mock real con las herramientas de
// Pencil (Get con depth:6 sobre el frame completo) salio que el diseño real
// usa drag-and-drop (igual que "El organizador" de ModuleFieldsCard.vue,
// mismo patron nativo copiado tal cual aca) y checkboxes cuadrados rellenos
// (mismo patron ya usado en la matriz de permisos de pages/roles/index.vue:
// boton `rounded-[3px]` con `<Check>` adentro, no un `<input type=checkbox>`).
//
// Ademas el mock trae algo que la primera version no tenia: para una columna
// de tipo Relación, un pill "Campo a mostrar" que abre un menu para elegir
// (por esa entidad, no por este modulo) que campo de texto usar como
// etiqueta en cualquier lugar donde se muestre un registro relacionado con
// ella (entities.labelField, ver comentario largo en server/db/schema.ts) -
// pedido explicito del usuario tras ver uuids crudos en Screen/Listado
// Recepción ("necesitamos poder decidir que se muestra de la relacion").
import { Check, ChevronDown, GripVertical } from '@lucide/vue'
import type { BoardConfig, EntityFieldMeta, ListLayout } from '~/composables/useEntityFields'
import { isListFilterable } from '~/utils/listFilters'

const props = defineProps<{
  fields: EntityFieldMeta[]
  modelValue: ListLayout
  boardConfig?: BoardConfig
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ListLayout]
  'update:boardConfig': [value: BoardConfig]
}>()

function fieldMeta(name: string): EntityFieldMeta | undefined {
  return props.fields.find((f) => f.name === name)
}

const filterableCandidates = computed(() => props.fields.filter((f) => f.name !== 'id' && isListFilterable(f.dataType)))

// Reportado por el usuario (2026-09-03): props.fields ahora siempre trae el
// campo sintetico "id" (ver fields.get.ts) - listLayout.defaultSort.field
// nunca puede ser "id" server-side (resolveListLayout() lo valida contra los
// campos reales, sin id) asi que ofrecerlo en "Orden por defecto" seria una
// opcion que nunca llega a guardarse.
const sortableFields = computed(() => props.fields.filter((f) => f.name !== 'id'))
const boardStatusFields = computed(() => props.fields.filter(field => field.dataType === 'select'))
const boardDisplayFields = computed(() => props.fields.filter(field => field.name !== 'id'))

function updateBoard(patch: Partial<BoardConfig>) {
  if (!props.boardConfig) return
  emit('update:boardConfig', { ...props.boardConfig, ...patch })
}
function toggleBoardSecondary(name: string) {
  if (!props.boardConfig) return
  const included = props.boardConfig.secondaryFields.includes(name)
  updateBoard({ secondaryFields: included ? props.boardConfig.secondaryFields.filter(field => field !== name) : [...props.boardConfig.secondaryFields, name].slice(0, 3) })
}

function toggleColumnVisible(name: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    columns: props.modelValue.columns.map((c) => (c.name === name ? { ...c, visible: !c.visible } : c))
  })
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

// Drag-and-drop del orden de columnas - mismo patron nativo (sin libreria)
// que "El organizador" de ModuleFieldsCard.vue, adaptado para reordenar
// SOLO el array local `modelValue.columns` (no hay un endpoint de reorder
// aparte aca: listLayout entero se guarda de una con "Guardar diseño", igual
// que cualquier otro cambio de esta tarjeta).
const draggingIndex = ref<number | null>(null)
const dropIndicator = ref<{ index: number; position: 'before' | 'after' } | null>(null)

function onDragStart(index: number, event: DragEvent) {
  draggingIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOverRow(index: number, event: DragEvent) {
  if (draggingIndex.value === null) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const position = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
  dropIndicator.value = { index, position }
}

function onDragLeaveRow(index: number) {
  if (dropIndicator.value?.index === index) dropIndicator.value = null
}

function onDragEnd() {
  draggingIndex.value = null
  dropIndicator.value = null
}

function onDrop() {
  const from = draggingIndex.value
  const indicator = dropIndicator.value
  draggingIndex.value = null
  dropIndicator.value = null
  if (from === null || !indicator) return

  let to = indicator.position === 'after' ? indicator.index + 1 : indicator.index
  if (from < to) to -= 1
  if (to === from) return

  const next = [...props.modelValue.columns]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  emit('update:modelValue', { ...props.modelValue, columns: next })
}

// "Campo a mostrar" (entities.labelField) - vive en la entidad DESTINO de la
// relacion, no en este modulo (ver comentario largo en server/db/schema.ts),
// asi que hace falta resolver/editar esa OTRA entidad en contexto. Se busca
// solo al abrir el picker de una columna puntual (mismo criterio "lazy" que
// DynamicRelationField.vue con ensureRelationFields()), cacheado por slug
// para no repetir el fetch si hay mas de una columna apuntando a la misma
// entidad relacionada.
interface RelatedMeta {
  id: string
  labelField: string | null
  labelCandidateFields: EntityFieldMeta[]
}

// Bug reportado por el usuario (2026-09-04, viendo un uuid truncado
// "86b28200" en el buscador de un campo relacion): este picker solo listaba
// dataType 'text', dejando afuera 'incremental' (folio/numero autogenerado -
// justo el campo que identifica un registro como una Recepcion) - ni
// aparecia como opcion, aunque fuera el unico campo legible de la entidad.
// Mismo criterio que LABEL_CANDIDATE_TYPES de utils/recordLabel.ts.
const LABEL_CANDIDATE_TYPES = new Set(['text', 'incremental'])
const relatedMeta = reactive<Record<string, RelatedMeta | 'loading' | 'error'>>({})
const openPickerFor = ref<string | null>(null)
const pickerError = ref<string | null>(null)
const pickerSaving = ref<string | null>(null)

function relationSlug(field: EntityFieldMeta): string | null {
  const rules = (field.validationRules ?? {}) as Record<string, unknown>
  return typeof rules.relationEntity === 'string' && rules.relationEntity ? rules.relationEntity : null
}

async function ensureRelatedMeta(slug: string) {
  if (relatedMeta[slug]) return
  relatedMeta[slug] = 'loading'
  try {
    const res = await $fetch<{ entity: { id: string; labelField: string | null }; fields: EntityFieldMeta[] }>(`/api/entities/${slug}/fields`)
    relatedMeta[slug] = {
      id: res.entity.id,
      labelField: res.entity.labelField ?? null,
      labelCandidateFields: res.fields.filter((f) => LABEL_CANDIDATE_TYPES.has(f.dataType) && f.name !== 'id')
    }
  } catch {
    relatedMeta[slug] = 'error'
  }
}

async function togglePicker(field: EntityFieldMeta) {
  const slug = relationSlug(field)
  if (!slug) return
  if (openPickerFor.value === field.name) {
    openPickerFor.value = null
    return
  }
  pickerError.value = null
  openPickerFor.value = field.name
  await ensureRelatedMeta(slug)
}

// Solo un picker puede estar abierto a la vez - se resuelve la metadata del
// picker ABIERTO una sola vez aca, en vez de repetir fieldMeta()+relationSlug()
// en cada expresion del template (menos ruido, y evita el TS narrowing raro
// de indexar relatedMeta[...] varias veces con casts distintos).
const openPickerMeta = computed<RelatedMeta | 'loading' | 'error' | null>(() => {
  if (!openPickerFor.value) return null
  const field = fieldMeta(openPickerFor.value)
  if (!field) return null
  const slug = relationSlug(field)
  if (!slug) return null
  return relatedMeta[slug] ?? null
})

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts. Esta accion se auto-guarda al elegir una
// opcion (sin boton "Guardar" propio) y solo cierra el picker en exito - sin
// el toast no quedaria NINGUNA confirmacion visible de que el cambio se
// aplico.
const toast = useToast()

async function chooseLabelField(field: EntityFieldMeta, value: string | null) {
  const slug = relationSlug(field)
  if (!slug) return
  const meta = relatedMeta[slug]
  if (!meta || meta === 'loading' || meta === 'error') return

  pickerError.value = null
  pickerSaving.value = field.name
  try {
    await $fetch(`/api/entities/${meta.id}`, { method: 'PUT', body: { labelField: value } })
    relatedMeta[slug] = { ...meta, labelField: value }
    openPickerFor.value = null
    toast.updated('Campo actualizado', 'El campo a mostrar en las relaciones se guardó correctamente.')
  } catch (err: any) {
    pickerError.value = err?.data?.statusMessage || 'No se pudo guardar el campo a mostrar'
    toast.error('No se pudo guardar el campo a mostrar', pickerError.value)
  } finally {
    pickerSaving.value = null
  }
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
      <h2 class="text-[15px] font-bold text-brand-text">Listado de registros</h2>
      <p class="text-sm text-brand-text-secondary">Elige las columnas, filtros disponibles y el orden por defecto</p>
    </div>

    <div class="flex flex-col gap-5 p-5">
      <div class="flex flex-col gap-1.5">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Columnas visibles</p>
        <p v-if="modelValue.columns.length === 0" class="text-xs text-brand-text-muted">Este módulo todavía no tiene campos.</p>

        <div
          v-for="(col, index) in modelValue.columns"
          :key="col.name"
          class="relative flex items-center gap-2.5 rounded px-1.5 py-1.5 transition-opacity hover:bg-brand-bg"
          :class="draggingIndex === index ? 'opacity-40' : ''"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover.prevent="onDragOverRow(index, $event)"
          @dragleave="onDragLeaveRow(index)"
          @drop.prevent="onDrop"
          @dragend="onDragEnd"
        >
          <div v-if="dropIndicator && dropIndicator.index === index && dropIndicator.position === 'before'" class="absolute inset-x-0 top-0 h-0.5 rounded-full bg-brand-orange" />
          <div v-if="dropIndicator && dropIndicator.index === index && dropIndicator.position === 'after'" class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-orange" />

          <GripVertical class="h-4 w-4 shrink-0 cursor-grab text-brand-text-muted active:cursor-grabbing" :stroke-width="1.75" />

          <button
            type="button"
            class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border"
            :class="col.visible ? 'border-brand-orange bg-brand-orange' : 'border-brand-border bg-brand-surface'"
            @click="toggleColumnVisible(col.name)"
          >
            <Check v-if="col.visible" class="h-3 w-3 text-white" :stroke-width="3" />
          </button>

          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">{{ fieldMeta(col.name)?.label ?? col.name }}</span>

          <!-- Reportado por el usuario (2026-09-03): picker "Campo a mostrar"
               para columnas de relación - ver comentario largo arriba. -->
          <div v-if="fieldMeta(col.name)?.dataType === 'relation'" class="relative shrink-0">
            <button
              type="button"
              class="flex items-center gap-1 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text hover:bg-brand-border-light"
              :disabled="pickerSaving === col.name"
              @click.stop="togglePicker(fieldMeta(col.name)!)"
            >
              Campo a mostrar
              <ChevronDown class="h-3 w-3" :stroke-width="2" />
            </button>

            <div v-if="openPickerFor === col.name" class="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-brand-border-light bg-brand-surface py-1 shadow-lg">
              <p v-if="openPickerMeta === 'loading'" class="px-3 py-1.5 text-xs text-brand-text-muted">Cargando...</p>
              <p v-else-if="openPickerMeta === 'error'" class="px-3 py-1.5 text-xs text-brand-error-text">No se pudo cargar la entidad relacionada.</p>
              <template v-else-if="openPickerMeta">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-brand-bg"
                  @click="chooseLabelField(fieldMeta(col.name)!, null)"
                >
                  <span class="flex flex-col">
                    <span class="text-sm text-brand-text">Automático</span>
                    <span class="text-xs text-brand-text-muted">Primer campo de texto o incremental</span>
                  </span>
                  <Check v-if="!openPickerMeta.labelField" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
                </button>
                <button
                  v-for="tf in openPickerMeta.labelCandidateFields"
                  :key="tf.id"
                  type="button"
                  class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg"
                  @click="chooseLabelField(fieldMeta(col.name)!, tf.name)"
                >
                  {{ tf.label }}
                  <Check v-if="openPickerMeta.labelField === tf.name" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
                </button>
                <p v-if="openPickerMeta.labelCandidateFields.length === 0" class="px-3 py-1.5 text-xs text-brand-text-muted">Esa entidad no tiene campos de texto ni incremental.</p>
              </template>
            </div>
          </div>

          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">
            {{ fieldTypeLabel(fieldMeta(col.name)?.dataType) }}
          </span>
        </div>

        <p v-if="pickerError" class="text-xs text-brand-error-text">{{ pickerError }}</p>
      </div>

      <div class="flex flex-col gap-1.5 border-t border-brand-border-light pt-4">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Filtros disponibles</p>
        <p v-if="filterableCandidates.length === 0" class="text-xs text-brand-text-muted">
          Este módulo todavía no tiene campos compatibles con filtros.
        </p>
        <label
          v-for="f in filterableCandidates"
          :key="f.id"
          class="flex cursor-pointer items-center gap-2.5 rounded px-1.5 py-1.5 hover:bg-brand-bg"
        >
          <button
            type="button"
            class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border"
            :class="modelValue.filterFields.includes(f.name) ? 'border-brand-orange bg-brand-orange' : 'border-brand-border bg-brand-surface'"
            @click="toggleFilterField(f.name)"
          >
            <Check v-if="modelValue.filterFields.includes(f.name)" class="h-3 w-3 text-white" :stroke-width="3" />
          </button>
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">{{ f.label }}</span>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">{{ fieldTypeLabel(f.dataType) }}</span>
        </label>
      </div>

      <div v-if="boardConfig" class="flex flex-col gap-3 border-t border-brand-border-light pt-4">
        <div class="flex items-start justify-between gap-4">
          <div><p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Modo de vista del módulo</p><p class="mt-1 text-xs leading-5 text-brand-text-muted">Activa Tabla o Kanban para decidir cómo se consultan los registros.</p></div>
          <button type="button" role="switch" :aria-checked="boardConfig.enabled" class="relative h-6 w-11 shrink-0 rounded-full transition-colors" :class="boardConfig.enabled ? 'bg-brand-blue' : 'bg-brand-border'" @click="updateBoard({ enabled: !boardConfig.enabled })"><span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" :class="boardConfig.enabled ? 'translate-x-5' : 'translate-x-0.5'" /></button>
        </div>
        <template v-if="boardConfig.enabled">
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-brand-text">Campo de columnas
            <select :value="boardConfig.statusField ?? ''" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" @change="updateBoard({ statusField: ($event.target as HTMLSelectElement).value || null })"><option value="" disabled>Selecciona un campo</option><option v-for="field in boardStatusFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
          </label>
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-brand-text">Título de la tarjeta
            <select :value="boardConfig.titleField ?? ''" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" @change="updateBoard({ titleField: ($event.target as HTMLSelectElement).value || null })"><option value="" disabled>Selecciona un campo</option><option v-for="field in boardDisplayFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
          </label>
          <div class="flex flex-col gap-1.5"><p class="text-xs font-semibold text-brand-text">Datos secundarios <span class="font-normal text-brand-text-muted">(máximo 3)</span></p><label v-for="field in boardDisplayFields.filter(field => field.name !== boardConfig?.titleField)" :key="field.id" class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-brand-bg"><button type="button" class="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border" :class="boardConfig.secondaryFields.includes(field.name) ? 'border-brand-blue bg-brand-blue' : 'border-brand-border'" @click="toggleBoardSecondary(field.name)"><Check v-if="boardConfig.secondaryFields.includes(field.name)" class="h-3 w-3 text-white" /></button><span class="truncate text-sm">{{ field.label }}</span></label></div>
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-brand-text">Vista inicial
            <select :value="boardConfig.defaultView" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" @change="updateBoard({ defaultView: ($event.target as HTMLSelectElement).value as 'table' | 'board' })"><option value="board">Tablero</option><option value="table">Tabla</option></select>
          </label>
        </template>
        <p v-else-if="boardStatusFields.length === 0" class="rounded bg-brand-warning-bg px-3 py-2 text-xs text-brand-warning-text">Crea un campo de tipo Selección para usarlo como columnas.</p>
      </div>

      <div class="flex flex-col gap-2 border-t border-brand-border-light pt-4">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Orden por defecto</p>
        <select
          :value="modelValue.defaultSort?.field ?? ''"
          class="w-full rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          @change="setDefaultSortField(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Sin orden por defecto (fecha de creación, descendente)</option>
          <option v-for="f in sortableFields" :key="f.id" :value="f.name">{{ f.label }}</option>
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

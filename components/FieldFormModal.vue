<script setup lang="ts">
// HU-ERD-70: modal "Agregar/Editar campo" - sigue Screen/Editor de Campos -
// Agregar Campo del .pen (revisado con las herramientas de Pencil): nombre
// tecnico + etiqueta, tarjetas de tipo, toggle "obligatorio" y reglas de
// validacion segun el tipo elegido.
//
// HU-ERD-71 suma dos secciones nuevas (revisadas en el .pen: Screen/Agregar
// Campo - Opciones (Select) para el builder de opciones, y el ColumnsList +
// RelationConfig de Screen/Agregar Campo - Relación (1:N) como referencia
// visual mas cercana para el builder de columnas - no hay una pantalla propia
// de "Editor de columnas Tabla" en el .pen, la HU en Jira solo referencia la
// de Opciones (Select)):
//
// - Tarjeta de tipo "Select" (icono list) - unica en el picker, tal como
//   muestra el diseno: la eleccion "Selección única" / "Selección múltiple"
//   vive DENTRO del builder de opciones (SelectionTypeToggle del .pen), no
//   como dos tarjetas separadas - el dataType real que se envia es 'select'
//   o 'multiselect' segun ese toggle.
// - Tarjeta de tipo "Tabla" (icono table-2, sin referencia directa en el
//   picker del .pen ya que esa pantalla es anterior a HU-ERD-68 - se sigue
//   el mismo patron visual que las otras 6 tarjetas).
//
// Simplificacion documentada sobre el diseno: el selector de color de cada
// opcion en el .pen es un dropdown con paleta expandible (OptionRowExpanded);
// aca es un <select> nativo con las mismas 7 paletas de color de marca ya
// usadas en TYPE_BADGE (ModuleFieldsCard.vue) - funcionalmente equivalente
// (7 colores, accesible por teclado), visualmente mas simple que una paleta
// flotante. El "grip-vertical" de cada fila (drag handle en el diseno) se
// resuelve con botones ↑/↓ en vez de arrastrar-y-soltar - mismo alcance
// funcional ("reordenar", DOCS/Diseno_Pantallas_Faltantes_Fase2.md punto 4)
// sin sumar una libreria de drag-and-drop para esto.
//
// "Relacion" sigue sin reglas de validacion configurables aca (ver HU-ERD-70,
// Screen/Agregar Campo - Relación (1:N) completa sigue fuera de alcance). El
// builder de columnas de "Tabla" SI permite marcar una columna como de tipo
// relación (entidad destino) y, para las DEMAS columnas, elegir si copian un
// campo de esa entidad relacionada (copyFrom "entidad.campo", ver DOCS
// "Semántica de copia") y si quedan editables despues de copiar - eso es
// justamente el alcance literal de esta HU, no la relación 1:N completa.
import { computed, reactive, ref, watch } from 'vue'
import { Braces, Calendar, Check, ChevronDown, GripVertical, Hash, Link2, List, Plus, Table2, ToggleLeft, Type as TypeIcon, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

export interface FieldDraft {
  name: string
  label: string
  dataType: string
  validationRules: Record<string, unknown>
  isRequired: boolean
}

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  initialField?: FieldDraft | null
  saving?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [draft: FieldDraft]
}>()

interface TypeOption {
  value: string
  label: string
  icon: typeof TypeIcon
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: 'text', label: 'Texto', icon: TypeIcon },
  { value: 'number', label: 'Número', icon: Hash },
  { value: 'boolean', label: 'Booleano', icon: ToggleLeft },
  { value: 'date', label: 'Fecha', icon: Calendar },
  { value: 'json', label: 'JSON', icon: Braces },
  { value: 'relation', label: 'Relación', icon: Link2 },
  { value: 'select', label: 'Select', icon: List },
  { value: 'tabla', label: 'Tabla', icon: Table2 }
]

// HU-ERD-71: mismas 7 paletas de color de marca que TYPE_BADGE
// (ModuleFieldsCard.vue) - reusadas aca para las opciones de Select/
// Multiselect, y consumibles despues por HU-ERD-73 (badges/chips reales en
// el formulario y el filtro de listado) con la misma convencion de nombre.
const OPTION_COLORS = [
  { value: 'neutral', label: 'Gris', dot: 'bg-brand-neutral-text' },
  { value: 'blue', label: 'Azul', dot: 'bg-brand-blue' },
  { value: 'success', label: 'Verde', dot: 'bg-brand-success-text' },
  { value: 'warning', label: 'Amarillo', dot: 'bg-brand-warning-text' },
  { value: 'error', label: 'Rojo', dot: 'bg-brand-error-text' },
  { value: 'purple', label: 'Morado', dot: 'bg-brand-purple-text' },
  { value: 'pink', label: 'Rosa', dot: 'bg-brand-pink-text' }
] as const

function colorDot(color: string): string {
  return OPTION_COLORS.find((c) => c.value === color)?.dot ?? 'bg-brand-neutral-text'
}

const TABLE_COLUMN_TYPES: Array<{ value: string; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'boolean', label: 'Booleano' },
  { value: 'date', label: 'Fecha' },
  { value: 'relation', label: 'Relación' }
]

interface OptionDraft {
  label: string
  value: string
  color: string
  valueTouched: boolean
}

interface ColumnDraft {
  name: string
  label: string
  type: string
  nameTouched: boolean
  relationEntity: string
  copyFrom: string
  editable: boolean
  // HU-ERD-72: columna "calculada" (ej. subtotal) - DynamicTableField.vue la
  // calcula en vivo (producto de las demas columnas numericas de la fila,
  // sin formula/eval, ver comentario en ese componente) y la persiste como
  // numero fijo. Excluyente con copyFrom (una columna se copia de una
  // relacion O se calcula, no las dos cosas).
  readonly: boolean
}

const form = reactive({
  name: '',
  label: '',
  dataType: 'text',
  isRequired: false,
  minLength: null as number | null,
  maxLength: null as number | null,
  min: null as number | null,
  max: null as number | null,
  integer: false,
  dateMin: '',
  dateMax: '',
  options: [] as OptionDraft[],
  columns: [] as ColumnDraft[]
})

// Entidades del tenant, para el picker "Entidad relacionada" de una columna
// tipo Tabla (HU-ERD-71) - cargadas una sola vez, bajo demanda (no todo
// campo Tabla necesita una columna de relación).
const relatedEntities = ref<Array<{ id: string; slug: string; name: string }>>([])
let relatedEntitiesLoaded = false
async function ensureRelatedEntitiesLoaded() {
  if (relatedEntitiesLoaded) return
  relatedEntitiesLoaded = true
  try {
    const res = await $fetch<{ entities: Array<{ id: string; slug: string; name: string }> }>('/api/entities')
    relatedEntities.value = res.entities
  } catch {
    // Sin admin o el fetch falla: el picker queda vacío, el resto del
    // builder de columnas sigue funcionando igual para columnas no-relación.
  }
}

// Campos de cada entidad relacionada ya elegida en alguna columna, para
// armar las opciones de "Copiar desde" (copyFrom) de las DEMAS columnas.
const relatedFieldsByEntity = reactive<Record<string, EntityFieldMeta[]>>({})
async function ensureRelatedFieldsLoaded(slug: string) {
  if (!slug || relatedFieldsByEntity[slug]) return
  try {
    const res = await $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${slug}/fields`)
    relatedFieldsByEntity[slug] = res.fields
  } catch {
    relatedFieldsByEntity[slug] = []
  }
}

function onColumnRelationEntityChange(col: ColumnDraft) {
  if (col.relationEntity) void ensureRelatedFieldsLoaded(col.relationEntity)
}

// Columnas ya marcadas como "de relación" con una entidad elegida - fuente
// de las opciones de copyFrom para las demás columnas del mismo campo Tabla.
const relationColumns = computed(() => form.columns.filter((c) => c.type === 'relation' && c.relationEntity))

interface CopyFromOption {
  value: string
  label: string
}
function copyFromOptions(currentColumnName: string): CopyFromOption[] {
  const opts: CopyFromOption[] = []
  for (const relCol of relationColumns.value) {
    if (relCol.name === currentColumnName) continue
    const relatedEntity = relatedEntities.value.find((e) => e.slug === relCol.relationEntity)
    const fields = relatedFieldsByEntity[relCol.relationEntity] ?? []
    for (const f of fields) {
      opts.push({ value: `${relCol.relationEntity}.${f.name}`, label: `${relatedEntity?.name ?? relCol.relationEntity} → ${f.label}` })
    }
  }
  return opts
}

watch(
  () => [props.open, props.initialField] as const,
  ([open, field]) => {
    if (!open) return
    const rules = (field?.validationRules ?? {}) as Record<string, unknown>
    form.name = field?.name ?? ''
    form.label = field?.label ?? ''
    form.dataType = field?.dataType ?? 'text'
    form.isRequired = field?.isRequired ?? false
    form.minLength = typeof rules.minLength === 'number' ? rules.minLength : null
    form.maxLength = typeof rules.maxLength === 'number' ? rules.maxLength : null
    form.min = typeof rules.min === 'number' ? rules.min : null
    form.max = typeof rules.max === 'number' ? rules.max : null
    form.integer = rules.integer === true
    form.dateMin = typeof rules.min === 'string' ? rules.min : ''
    form.dateMax = typeof rules.max === 'string' ? rules.max : ''

    const rawOptions = Array.isArray(rules.options) ? (rules.options as Array<{ label?: string; value?: string; color?: string }>) : []
    form.options =
      form.dataType === 'select' || form.dataType === 'multiselect'
        ? rawOptions.length > 0
          ? rawOptions.map((o) => ({ label: o.label ?? '', value: o.value ?? '', color: o.color ?? 'neutral', valueTouched: true }))
          : [{ label: '', value: '', color: 'neutral', valueTouched: false }]
        : []

    const rawColumns = Array.isArray(rules.columns)
      ? (rules.columns as Array<{ name?: string; label?: string; type?: string; relationEntity?: string; copyFrom?: string; editable?: boolean; readonly?: boolean }>)
      : []
    form.columns =
      form.dataType === 'tabla'
        ? rawColumns.length > 0
          ? rawColumns.map((c) => ({
              name: c.name ?? '',
              label: c.label ?? '',
              type: c.type ?? 'text',
              nameTouched: true,
              relationEntity: c.relationEntity ?? '',
              copyFrom: c.copyFrom ?? '',
              editable: c.editable ?? false,
              readonly: c.readonly ?? false
            }))
          : [{ name: '', label: '', type: 'text', nameTouched: false, relationEntity: '', copyFrom: '', editable: false, readonly: false }]
        : []

    if (form.dataType === 'tabla' && form.columns.some((c) => c.relationEntity)) {
      void ensureRelatedEntitiesLoaded()
      for (const c of form.columns) if (c.relationEntity) void ensureRelatedFieldsLoaded(c.relationEntity)
    }
  },
  { immediate: true }
)

function selectDataType(value: string) {
  if (value === 'select') {
    // Conserva select/multiselect si ya estaba en ese tipo (el toggle de
    // selección única/múltiple vive dentro del builder, no en la tarjeta).
    form.dataType = form.dataType === 'multiselect' ? 'multiselect' : 'select'
    if (form.options.length === 0) form.options = [{ label: '', value: '', color: 'neutral', valueTouched: false }]
    return
  }
  form.dataType = value
  if (value === 'tabla') {
    void ensureRelatedEntitiesLoaded()
    if (form.columns.length === 0) form.columns = [{ name: '', label: '', type: 'text', nameTouched: false, relationEntity: '', copyFrom: '', editable: false, readonly: false }]
  }
}

function addOption() {
  form.options.push({ label: '', value: '', color: 'neutral', valueTouched: false })
}
function removeOption(index: number) {
  form.options.splice(index, 1)
}
function moveOption(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= form.options.length) return
  const [item] = form.options.splice(index, 1)
  form.options.splice(target, 0, item)
}
function onOptionLabelInput(opt: OptionDraft, value: string) {
  opt.label = value
  if (!opt.valueTouched) opt.value = slugifyIdentifier(value)
}
function onOptionValueInput(opt: OptionDraft, value: string) {
  opt.valueTouched = true
  opt.value = value
}

function addColumn() {
  form.columns.push({ name: '', label: '', type: 'text', nameTouched: false, relationEntity: '', copyFrom: '', editable: false, readonly: false })
}
function removeColumn(index: number) {
  form.columns.splice(index, 1)
}
function moveColumn(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= form.columns.length) return
  const [item] = form.columns.splice(index, 1)
  form.columns.splice(target, 0, item)
}
function onColumnLabelInput(col: ColumnDraft, value: string) {
  col.label = value
  if (!col.nameTouched) col.name = slugifyIdentifier(value)
}
function onColumnNameInput(col: ColumnDraft, value: string) {
  col.nameTouched = true
  col.name = value
}
function onColumnTypeChange(col: ColumnDraft) {
  if (col.type !== 'relation') {
    col.relationEntity = ''
  } else {
    col.copyFrom = ''
    col.editable = false
    col.readonly = false
    void ensureRelatedEntitiesLoaded()
  }
}
function onColumnReadonlyToggle(col: ColumnDraft, value: boolean) {
  col.readonly = value
  if (value) {
    col.copyFrom = ''
    col.editable = false
  }
}

function validationRulesForSubmit(): Record<string, unknown> {
  switch (form.dataType) {
    case 'text': {
      const rules: Record<string, unknown> = {}
      if (form.minLength !== null) rules.minLength = form.minLength
      if (form.maxLength !== null) rules.maxLength = form.maxLength
      return rules
    }
    case 'number': {
      const rules: Record<string, unknown> = {}
      if (form.min !== null) rules.min = form.min
      if (form.max !== null) rules.max = form.max
      if (form.integer) rules.integer = true
      return rules
    }
    case 'date': {
      const rules: Record<string, unknown> = {}
      if (form.dateMin) rules.min = form.dateMin
      if (form.dateMax) rules.max = form.dateMax
      return rules
    }
    case 'select':
    case 'multiselect':
      return { options: form.options.map((o) => ({ value: o.value, label: o.label, color: o.color })) }
    case 'tabla':
      return {
        columns: form.columns.map((c) => {
          const col: Record<string, unknown> = { name: c.name, label: c.label, type: c.type }
          if (c.type === 'relation') {
            if (c.relationEntity) col.relationEntity = c.relationEntity
          } else if (c.readonly) {
            col.readonly = true
          } else {
            if (c.copyFrom) col.copyFrom = c.copyFrom
            if (c.copyFrom && c.editable) col.editable = true
          }
          return col
        })
      }
    default:
      return {}
  }
}

const nameError = computed(() => {
  if (!form.name) return null
  return /^[a-z][a-z0-9_]*$/.test(form.name)
    ? null
    : 'Solo minúsculas, números y guion bajo, debe empezar con una letra'
})

const optionsHaveDuplicateValues = computed(() => {
  const values = form.options.map((o) => o.value).filter((v) => v)
  return new Set(values).size !== values.length
})
const optionsValid = computed(
  () => form.options.length > 0 && form.options.every((o) => o.label.length > 0 && o.value.length > 0) && !optionsHaveDuplicateValues.value
)

function columnNameInvalid(name: string): boolean {
  return name.length > 0 && !/^[a-z][a-z0-9_]*$/.test(name)
}
const columnsHaveDuplicateNames = computed(() => {
  const names = form.columns.map((c) => c.name).filter((v) => v)
  return new Set(names).size !== names.length
})
const columnsValid = computed(
  () =>
    form.columns.length > 0 &&
    form.columns.every((c) => c.name.length > 0 && c.label.length > 0 && !columnNameInvalid(c.name) && (c.type !== 'relation' || c.relationEntity.length > 0)) &&
    !columnsHaveDuplicateNames.value
)

const canSubmit = computed(() => {
  if (form.name.length === 0 || nameError.value || form.label.length === 0) return false
  if (form.dataType === 'select' || form.dataType === 'multiselect') return optionsValid.value
  if (form.dataType === 'tabla') return columnsValid.value
  return true
})

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    name: form.name,
    label: form.label,
    dataType: form.dataType,
    validationRules: validationRulesForSubmit(),
    isRequired: form.isRequired
  })
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-lg bg-brand-surface shadow-xl">
      <div class="flex items-start justify-between border-b border-brand-border-light p-5">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-[17px] font-bold text-brand-text">{{ mode === 'create' ? 'Agregar campo' : 'Editar campo' }}</h2>
          <p class="text-sm text-brand-text-secondary">Define las propiedades de este campo</p>
        </div>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg" @click="emit('close')">
          <X class="h-4 w-4" :stroke-width="1.75" />
        </button>
      </div>

      <div class="flex flex-col gap-5 p-5">
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="field-name" class="text-[13px] font-semibold text-brand-text">Nombre técnico</label>
            <input
              id="field-name"
              v-model="form.name"
              type="text"
              :disabled="mode === 'edit'"
              class="w-full rounded border border-brand-border px-3 py-[9px] font-mono text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:bg-brand-bg disabled:text-brand-text-muted"
            />
            <p v-if="nameError" class="text-xs text-brand-error-text">{{ nameError }}</p>
            <p v-else class="text-xs text-brand-text-muted">{{ mode === 'edit' ? 'No se puede cambiar una vez creado.' : 'Sin espacios, usado en la API' }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="field-label" class="text-[13px] font-semibold text-brand-text">Etiqueta visible</label>
            <input
              id="field-label"
              v-model="form.label"
              type="text"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Tipo de dato</p>
          <div class="grid grid-cols-3 gap-2.5">
            <button
              v-for="opt in TYPE_OPTIONS"
              :key="opt.value"
              type="button"
              class="relative flex flex-col items-start gap-2 rounded border p-3 text-left"
              :class="
                form.dataType === opt.value || (opt.value === 'select' && form.dataType === 'multiselect')
                  ? 'border-2 border-brand-blue bg-brand-blue-bg'
                  : 'border-brand-border bg-brand-surface'
              "
              @click="selectDataType(opt.value)"
            >
              <Check
                v-if="form.dataType === opt.value || (opt.value === 'select' && form.dataType === 'multiselect')"
                class="absolute right-2.5 top-2.5 h-[15px] w-[15px] text-brand-blue"
                :stroke-width="2"
              />
              <div
                class="flex h-[26px] w-[26px] items-center justify-center rounded"
                :class="form.dataType === opt.value || (opt.value === 'select' && form.dataType === 'multiselect') ? 'bg-brand-surface' : 'bg-brand-neutral-bg'"
              >
                <component
                  :is="opt.icon"
                  class="h-3.5 w-3.5"
                  :class="form.dataType === opt.value || (opt.value === 'select' && form.dataType === 'multiselect') ? 'text-brand-blue' : 'text-brand-neutral-text'"
                  :stroke-width="1.75"
                />
              </div>
              <span
                class="text-[13px]"
                :class="form.dataType === opt.value || (opt.value === 'select' && form.dataType === 'multiselect') ? 'font-bold text-brand-blue' : 'font-semibold text-brand-text'"
              >{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between rounded border border-brand-border-light p-3">
          <div class="flex flex-col gap-0.5">
            <p class="text-sm font-semibold text-brand-text">Campo obligatorio</p>
            <p class="text-xs text-brand-text-muted">El usuario no podrá guardar el registro sin completarlo</p>
          </div>
          <button
            type="button"
            class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
            :class="form.isRequired ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
            @click="form.isRequired = !form.isRequired"
          >
            <span class="h-[18px] w-[18px] rounded-full bg-white shadow" />
          </button>
        </div>

        <div v-if="form.dataType === 'text'" class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Reglas de validación</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Longitud mínima</label>
              <input v-model.number="form.minLength" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Longitud máxima</label>
              <input v-model.number="form.maxLength" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
          </div>
        </div>

        <div v-else-if="form.dataType === 'number'" class="flex flex-col gap-3">
          <p class="text-[13px] font-semibold text-brand-text">Reglas de validación</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Valor mínimo</label>
              <input v-model.number="form.min" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Valor máximo</label>
              <input v-model.number="form.max" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-brand-text">
            <input v-model="form.integer" type="checkbox" class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange" />
            Solo permitir números enteros
          </label>
        </div>

        <div v-else-if="form.dataType === 'date'" class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Reglas de validación</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Fecha mínima</label>
              <input v-model="form.dateMin" type="date" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Fecha máxima</label>
              <input v-model="form.dateMax" type="date" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
          </div>
        </div>

        <!-- HU-ERD-71: builder de opciones (Select/Multiselect) - sigue
             Screen/Agregar Campo - Opciones (Select) del .pen: toggle
             Selección única/múltiple, lista de opciones (etiqueta + color +
             quitar), botón agregar. -->
        <div v-else-if="form.dataType === 'select' || form.dataType === 'multiselect'" class="flex flex-col gap-3">
          <p class="text-[13px] font-semibold text-brand-text">Opciones</p>

          <div class="flex rounded border border-brand-border-light bg-brand-bg p-1">
            <button
              type="button"
              class="flex-1 rounded px-3 py-1.5 text-[13px] font-semibold"
              :class="form.dataType === 'select' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              @click="form.dataType = 'select'"
            >
              Selección única
            </button>
            <button
              type="button"
              class="flex-1 rounded px-3 py-1.5 text-[13px] font-semibold"
              :class="form.dataType === 'multiselect' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              @click="form.dataType = 'multiselect'"
            >
              Selección múltiple
            </button>
          </div>

          <div class="flex flex-col gap-2">
            <div v-for="(opt, index) in form.options" :key="index" class="flex items-center gap-2">
              <GripVertical class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
              <span class="h-4 w-4 shrink-0 rounded-full" :class="colorDot(opt.color)" />
              <select
                :value="opt.color"
                class="w-[92px] shrink-0 rounded border border-brand-border bg-brand-surface px-1.5 py-[7px] text-xs text-brand-text focus:border-brand-blue focus:outline-none"
                @change="opt.color = ($event.target as HTMLSelectElement).value"
              >
                <option v-for="c in OPTION_COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
              <input
                type="text"
                :value="opt.label"
                placeholder="Etiqueta"
                class="min-w-0 flex-1 rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                @input="onOptionLabelInput(opt, ($event.target as HTMLInputElement).value)"
              />
              <input
                type="text"
                :value="opt.value"
                placeholder="valor"
                class="w-[100px] shrink-0 rounded border border-brand-border px-2 py-[7px] font-mono text-xs text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                @input="onOptionValueInput(opt, ($event.target as HTMLInputElement).value)"
              />
              <div class="flex shrink-0 gap-0.5">
                <button type="button" title="Mover arriba" :disabled="index === 0" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveOption(index, -1)">
                  <ChevronDown class="h-3.5 w-3.5 rotate-180" :stroke-width="1.75" />
                </button>
                <button type="button" title="Mover abajo" :disabled="index === form.options.length - 1" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveOption(index, 1)">
                  <ChevronDown class="h-3.5 w-3.5" :stroke-width="1.75" />
                </button>
              </div>
              <button type="button" title="Quitar opción" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-text-muted hover:bg-brand-error-bg hover:text-brand-error-text" @click="removeOption(index)">
                <X class="h-3.5 w-3.5" :stroke-width="1.75" />
              </button>
            </div>
          </div>
          <p v-if="optionsHaveDuplicateValues" class="text-xs text-brand-error-text">Hay valores repetidos entre las opciones - cada uno debe ser único.</p>

          <button type="button" class="flex items-center gap-1.5 self-start rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="addOption">
            <Plus class="h-3.5 w-3.5" :stroke-width="2" />
            Agregar opción
          </button>
        </div>

        <!-- HU-ERD-71: builder de columnas (Tabla) - referencia visual mas
             cercana en el .pen: ColumnsList ("Campos propios de la
             relación") dentro de Screen/Agregar Campo - Relación (1:N).
             Nombre técnico/Etiqueta/Tipo por columna; si el tipo es
             "Relación", elegir la entidad destino; para las demas columnas,
             opcionalmente copiar un campo de una columna de relación ya
             elegida (copyFrom) y si queda editable despues de copiar. -->
        <div v-else-if="form.dataType === 'tabla'" class="flex flex-col gap-3">
          <p class="text-[13px] font-semibold text-brand-text">Columnas</p>

          <div class="flex flex-col gap-3">
            <div v-for="(col, index) in form.columns" :key="index" class="flex flex-col gap-2 rounded border border-brand-border-light p-3">
              <div class="flex items-center gap-2">
                <GripVertical class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
                <input
                  type="text"
                  :value="col.label"
                  placeholder="Etiqueta"
                  class="min-w-0 flex-1 rounded border border-brand-border px-3 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  @input="onColumnLabelInput(col, ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="text"
                  :value="col.name"
                  placeholder="nombre_tecnico"
                  class="w-[130px] shrink-0 rounded border border-brand-border px-2 py-[7px] font-mono text-xs text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  @input="onColumnNameInput(col, ($event.target as HTMLInputElement).value)"
                />
                <select
                  :value="col.type"
                  class="w-[110px] shrink-0 rounded border border-brand-border bg-brand-surface px-1.5 py-[7px] text-xs text-brand-text focus:border-brand-blue focus:outline-none"
                  @change="col.type = ($event.target as HTMLSelectElement).value; onColumnTypeChange(col)"
                >
                  <option v-for="t in TABLE_COLUMN_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
                <div class="flex shrink-0 gap-0.5">
                  <button type="button" title="Mover arriba" :disabled="index === 0" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveColumn(index, -1)">
                    <ChevronDown class="h-3.5 w-3.5 rotate-180" :stroke-width="1.75" />
                  </button>
                  <button type="button" title="Mover abajo" :disabled="index === form.columns.length - 1" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveColumn(index, 1)">
                    <ChevronDown class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                </div>
                <button type="button" title="Quitar columna" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-text-muted hover:bg-brand-error-bg hover:text-brand-error-text" @click="removeColumn(index)">
                  <X class="h-3.5 w-3.5" :stroke-width="1.75" />
                </button>
              </div>
              <p v-if="columnNameInvalid(col.name)" class="text-xs text-brand-error-text">Nombre técnico inválido: minúsculas, números y guion bajo, debe empezar con una letra.</p>

              <div v-if="col.type === 'relation'" class="flex flex-col gap-1.5 pl-6">
                <label class="text-xs font-semibold text-brand-text-secondary">Entidad relacionada</label>
                <select
                  :value="col.relationEntity"
                  class="w-full max-w-xs rounded border border-brand-border bg-brand-surface px-2 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none"
                  @change="col.relationEntity = ($event.target as HTMLSelectElement).value; onColumnRelationEntityChange(col)"
                >
                  <option value="" disabled>Elegir entidad...</option>
                  <option v-for="e in relatedEntities" :key="e.slug" :value="e.slug">{{ e.name }}</option>
                </select>
              </div>

              <template v-else>
                <!-- HU-ERD-72: columna "calculada" (ej. subtotal) - la
                     calcula en vivo DynamicTableField.vue (producto de las
                     demas columnas numericas de la fila, sin formula/eval) y
                     la persiste como numero fijo. Solo tiene sentido en
                     columnas numericas, y es excluyente con copyFrom. -->
                <label v-if="col.type === 'number'" class="flex items-center gap-2 pl-6 text-sm text-brand-text">
                  <input
                    :checked="col.readonly"
                    type="checkbox"
                    class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange"
                    @change="onColumnReadonlyToggle(col, ($event.target as HTMLInputElement).checked)"
                  />
                  Columna calculada (solo lectura) - producto de las demás columnas numéricas de la fila
                </label>

                <div v-if="!col.readonly && relationColumns.length > 0" class="flex flex-col gap-1.5 pl-6">
                  <label class="text-xs font-semibold text-brand-text-secondary">Copiar desde (opcional)</label>
                  <select
                    :value="col.copyFrom"
                    class="w-full max-w-xs rounded border border-brand-border bg-brand-surface px-2 py-[7px] text-sm text-brand-text focus:border-brand-blue focus:outline-none"
                    @change="col.copyFrom = ($event.target as HTMLSelectElement).value"
                  >
                    <option value="">Sin copiar (valor propio)</option>
                    <option v-for="o in copyFromOptions(col.name)" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <label v-if="col.copyFrom" class="flex items-center gap-2 text-sm text-brand-text">
                    <input v-model="col.editable" type="checkbox" class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange" />
                    Editable después de copiar
                  </label>
                </div>
              </template>
            </div>
          </div>
          <p v-if="columnsHaveDuplicateNames" class="text-xs text-brand-error-text">Hay columnas con el mismo nombre técnico - cada una debe ser única.</p>

          <button type="button" class="flex items-center gap-1.5 self-start rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="addColumn">
            <Plus class="h-3.5 w-3.5" :stroke-width="2" />
            Agregar columna
          </button>
        </div>

        <p v-if="error" class="text-sm text-brand-error-text">{{ error }}</p>
      </div>

      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="emit('close')">
          Cancelar
        </button>
        <button
          type="button"
          :disabled="!canSubmit || saving"
          class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onSubmit"
        >
          {{ saving ? 'Guardando...' : mode === 'create' ? 'Agregar campo' : 'Guardar campo' }}
        </button>
      </div>
    </div>
  </div>
</template>

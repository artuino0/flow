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
import { Braces, Calendar, Check, ChevronDown, CircleDollarSign, GripVertical, Hash, Link2, List, ListOrdered, Paperclip, Plus, Table2, ToggleLeft, Type as TypeIcon, X } from '@lucide/vue'
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
  // Pedido directo del usuario (2026-09-04): campos YA existentes de esta
  // MISMA entidad (sin el "id" sintetico) - el panel de "Incremental" con
  // prefijo necesita ofrecer, para elegir, los campos 'relation' que este
  // modulo ya tiene configurados (no se crea uno nuevo aca). Opcional/default
  // vacio: si no se pasa, el modo "Con prefijo de relación" queda sin
  // opciones (el resto del modal sigue funcionando igual para los demas tipos).
  existingFields?: EntityFieldMeta[]
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
  { value: 'currency', label: 'Monto', icon: CircleDollarSign },
  { value: 'boolean', label: 'Booleano', icon: ToggleLeft },
  { value: 'date', label: 'Fecha', icon: Calendar },
  { value: 'json', label: 'JSON', icon: Braces },
  { value: 'relation', label: 'Relación', icon: Link2 },
  { value: 'select', label: 'Select', icon: List },
  { value: 'tabla', label: 'Tabla', icon: Table2 },
  // HU-ERD-78: sin referencia en el picker del .pen (revisado antes de
  // construir - ningun Screen del diseño menciona "archivo"/"adjunto") -
  // mismo patron visual que la tarjeta de "Tabla" de arriba (HU-ERD-68),
  // tambien sin mock propio en su momento.
  { value: 'file', label: 'Archivo', icon: Paperclip },
  // Pedido directo del usuario (2026-09-04): sin mock en el .pen (confirmado
  // antes de construir - "incremental"/"autonumerico" no existe en ningun
  // nodo del archivo) - mismo criterio visual que "Archivo"/"Tabla" de arriba.
  { value: 'incremental', label: 'Incremental', icon: ListOrdered }
]

// HU-ERD-71: mismas 7 paletas de color de marca que TYPE_BADGE
// (ModuleFieldsCard.vue). HU-ERD-73: extraida a utils/optionColors.ts
// (auto-importado) para que el renderizado real del campo (DynamicForm.vue)
// y el panel de Filtros del listado lean la MISMA fuente de verdad en vez de
// duplicar el mapeo color -> clases - mismo criterio que utils/slugify.ts.
// OPTION_COLORS y colorDotClass() quedan disponibles por auto-import.

const TABLE_COLUMN_TYPES: Array<{ value: string; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'boolean', label: 'Booleano' },
  { value: 'date', label: 'Fecha' },
  { value: 'relation', label: 'Relación' }
]

const MONEY_CURRENCIES = ['MXN', 'USD', 'EUR', 'CAD', 'GBP', 'BRL', 'ARS', 'COP', 'CLP', 'PEN', 'GTQ']

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

// Bug real reportado por el usuario (2026-09-01): "agrego campos y no hace
// nada" - el boton "Agregar campo" se queda deshabilitado en silencio
// (canSubmit exige form.name no vacio) si el usuario solo completa "Etiqueta
// visible" sin tocar "Nombre técnico" - a diferencia del builder de Opciones
// (onOptionLabelInput) y del de Columnas (onColumnLabelInput), que SI
// auto-generan el nombre tecnico desde la etiqueta. Se corrige con el mismo
// patron nameTouched/slugifyIdentifier ya usado ahi, aplicado ahora tambien
// al campo principal (name/label) del formulario.
const nameTouched = ref(false)

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
  currency: 'tenant',
  currencyDecimals: 2,
  allowNegative: false,
  dateMin: '',
  dateMax: '',
  options: [] as OptionDraft[],
  columns: [] as ColumnDraft[],
  // HU-ERD-74: entidad destino de un campo "Relación" de nivel superior -
  // hasta esta HU un campo relation no registraba a que entidad apuntaba
  // (solo exigia forma de uuid, ver dynamicSchema.ts). Opcional (un campo
  // relation viejo sin esto sigue funcionando igual) - se usa para calcular
  // las "relaciones inversas" de otra entidad (ver server/utils/detailLayout.ts)
  // y para resolver la etiqueta del registro relacionado en la ficha de detalle.
  relationEntity: '',
  // Pedido directo del usuario (2026-09-04): "Incremental" - digitos del
  // correlativo (relleno con ceros a la izquierda) y, opcionalmente, un
  // prefijo sacado de un campo de texto de la entidad relacionada por un
  // campo 'relation' propio de este mismo modulo (ej. Mercado -> "N"/"E").
  incrementalDigits: 6 as number | null,
  incrementalMode: 'simple' as 'simple' | 'prefixed',
  incrementalRelationField: '',
  incrementalSourceField: ''
})

// Campos 'relation' propios de esta entidad, con entidad relacionada ya
// configurada (sin eso no hay forma de saber donde buscar el prefijo) -
// opciones del picker "Campo de relación" del modo "Con prefijo de relación".
const ownRelationFields = computed(() => (props.existingFields ?? []).filter((f) => f.dataType === 'relation' && typeof f.validationRules?.relationEntity === 'string' && f.validationRules.relationEntity))

function relationEntitySlugFor(fieldName: string): string | null {
  const field = ownRelationFields.value.find((f) => f.name === fieldName)
  const slug = field?.validationRules?.relationEntity
  return typeof slug === 'string' && slug ? slug : null
}

// Campos de TEXTO (nunca "id") de la entidad relacionada por el campo de
// relación elegido - opciones del picker "Campo de la entidad relacionada".
const incrementalSourceFieldOptions = computed<EntityFieldMeta[]>(() => {
  const slug = relationEntitySlugFor(form.incrementalRelationField)
  if (!slug) return []
  return (relatedFieldsByEntity[slug] ?? []).filter((f) => f.dataType === 'text' && f.name !== 'id')
})

function onIncrementalRelationFieldChange() {
  form.incrementalSourceField = ''
  const slug = relationEntitySlugFor(form.incrementalRelationField)
  if (slug) void ensureRelatedFieldsLoaded(slug)
}

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
    nameTouched.value = !!field?.name
    form.dataType = field?.dataType ?? 'text'
    form.isRequired = field?.isRequired ?? false
    form.minLength = typeof rules.minLength === 'number' ? rules.minLength : null
    form.maxLength = typeof rules.maxLength === 'number' ? rules.maxLength : null
    form.min = typeof rules.min === 'number' ? rules.min : null
    form.max = typeof rules.max === 'number' ? rules.max : null
    form.integer = rules.integer === true
    form.currency = typeof rules.currency === 'string' ? rules.currency : 'tenant'
    form.currencyDecimals = typeof rules.decimals === 'number' ? rules.decimals : 2
    form.allowNegative = rules.allowNegative === true
    form.dateMin = typeof rules.min === 'string' ? rules.min : ''
    form.dateMax = typeof rules.max === 'string' ? rules.max : ''
    form.relationEntity = typeof rules.relationEntity === 'string' ? rules.relationEntity : ''
    if (form.dataType === 'relation') void ensureRelatedEntitiesLoaded()

    // Pedido directo del usuario (2026-09-04): "Incremental".
    const prefixSource = rules.prefixSource as { relationField?: unknown; sourceField?: unknown } | undefined
    form.incrementalDigits = typeof rules.digits === 'number' ? rules.digits : 6
    form.incrementalRelationField = typeof prefixSource?.relationField === 'string' ? prefixSource.relationField : ''
    form.incrementalSourceField = typeof prefixSource?.sourceField === 'string' ? prefixSource.sourceField : ''
    form.incrementalMode = form.incrementalRelationField ? 'prefixed' : 'simple'
    if (form.dataType === 'incremental' && form.incrementalRelationField) {
      // No se usa onIncrementalRelationFieldChange() aca a proposito: esa
      // funcion resetea incrementalSourceField (pensada para cuando el
      // usuario CAMBIA el campo de relación a mano) - aca se esta restaurando
      // un campo ya guardado, hay que conservar form.incrementalSourceField
      // tal cual se acaba de leer arriba.
      const slug = relationEntitySlugFor(form.incrementalRelationField)
      if (slug) void ensureRelatedFieldsLoaded(slug)
    }

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

function onFieldLabelInput(value: string) {
  form.label = value
  if (!nameTouched.value) form.name = slugifyIdentifier(value)
}
function onFieldNameInput(value: string) {
  nameTouched.value = true
  form.name = value
}

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
  if (value === 'relation') void ensureRelatedEntitiesLoaded()
  // Pedido directo del usuario (2026-09-04): "100% automatico y de solo
  // lectura" - un campo Incremental nunca tiene sentido como "obligatorio"
  // (el usuario jamas lo completa a mano), se fuerza a false igual que se
  // oculta el toggle en el template.
  if (value === 'incremental') {
    form.isRequired = false
    if (!form.incrementalDigits) form.incrementalDigits = 6
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
    case 'currency': {
      const rules: Record<string, unknown> = {
        currency: form.currency,
        decimals: form.currencyDecimals,
        allowNegative: form.allowNegative
      }
      if (form.min !== null) rules.min = form.min
      if (form.max !== null) rules.max = form.max
      return rules
    }
    case 'date': {
      const rules: Record<string, unknown> = {}
      if (form.dateMin) rules.min = form.dateMin
      if (form.dateMax) rules.max = form.dateMax
      return rules
    }
    case 'relation':
      return form.relationEntity ? { relationEntity: form.relationEntity } : {}
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
    case 'incremental': {
      const rules: Record<string, unknown> = { digits: form.incrementalDigits ?? 6 }
      if (form.incrementalMode === 'prefixed' && form.incrementalRelationField && form.incrementalSourceField) {
        rules.prefixSource = { relationField: form.incrementalRelationField, sourceField: form.incrementalSourceField }
      }
      return rules
    }
    default:
      return {}
  }
}

const nameError = computed(() => {
  if (!form.name) return null
  if (!/^[a-z][a-z0-9_]*$/.test(form.name)) {
    return 'Solo minúsculas, números y guion bajo, debe empezar con una letra'
  }
  // Reportado por el usuario (2026-09-01): "id" es el identificador implicito
  // del registro (uuid autogenerado) - se bloquea aca ademas del backend
  // (fields.post.ts) para que el error aparezca al tipear, no recien al
  // enviar. Solo aplica en modo creacion: en edicion el nombre ya viene
  // deshabilitado (no se puede cambiar una vez creado).
  if (props.mode === 'create' && form.name === 'id') {
    return '"id" es un nombre reservado: el identificador del registro ya existe automáticamente'
  }
  return null
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

const incrementalValid = computed(() => {
  if (!form.incrementalDigits || form.incrementalDigits < 1) return false
  if (form.incrementalMode === 'prefixed') return Boolean(form.incrementalRelationField && form.incrementalSourceField)
  return true
})

const canSubmit = computed(() => {
  if (form.name.length === 0 || nameError.value || form.label.length === 0) return false
  if (form.dataType === 'select' || form.dataType === 'multiselect') return optionsValid.value
  if (form.dataType === 'tabla') return columnsValid.value
  if (form.dataType === 'incremental') return incrementalValid.value
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
        <!-- Pedido por el usuario (2026-09-01): el primer campo a escribir
             debe ser el nombre visible del campo, no el nombre tecnico - la
             logica de auto-generado (onFieldLabelInput -> slugifyIdentifier,
             ver el comentario junto a nameTouched mas arriba) ya funcionaba
             asi desde el fix del bug de ERD-70; solo faltaba que el ORDEN
             VISUAL de las dos columnas del grid reflejara ese flujo (antes
             "Nombre técnico" aparecia primero, a la izquierda). -->
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="field-label" class="text-[13px] font-semibold text-brand-text">Etiqueta visible</label>
            <input
              id="field-label"
              :value="form.label"
              type="text"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              @input="onFieldLabelInput(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="field-name" class="text-[13px] font-semibold text-brand-text">Nombre técnico</label>
            <input
              id="field-name"
              :value="form.name"
              type="text"
              :disabled="mode === 'edit'"
              class="w-full rounded border border-brand-border px-3 py-[9px] font-mono text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:bg-brand-bg disabled:text-brand-text-muted"
              @input="onFieldNameInput(($event.target as HTMLInputElement).value)"
            />
            <p v-if="nameError" class="text-xs text-brand-error-text">{{ nameError }}</p>
            <p v-else class="text-xs text-brand-text-muted">{{ mode === 'edit' ? 'No se puede cambiar una vez creado.' : 'Se completa automáticamente a partir de la etiqueta; puede ajustarse si hace falta.' }}</p>
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

        <!-- Pedido directo del usuario (2026-09-04): un campo Incremental es
             siempre automatico - "obligatorio" no aplica (el usuario nunca lo
             completa a mano), se oculta el toggle en vez de dejarlo confuso. -->
        <div v-if="form.dataType !== 'incremental'" class="flex items-center justify-between rounded border border-brand-border-light p-3">
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

        <div v-else-if="form.dataType === 'currency'" class="flex flex-col gap-3">
          <div>
            <p class="text-[13px] font-semibold text-brand-text">Formato monetario</p>
            <p class="mt-0.5 text-xs text-brand-text-muted">Se mostrará con símbolo, separadores y centavos en formularios, listados y reportes.</p>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Moneda</label>
              <select v-model="form.currency" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue">
                <option value="tenant">Predeterminada de la empresa</option>
                <option v-for="code in MONEY_CURRENCIES" :key="code" :value="code">{{ code }}</option>
              </select>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Decimales</label>
              <select v-model.number="form.currencyDecimals" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue">
                <option :value="0">Sin decimales</option><option :value="2">2 decimales</option><option :value="3">3 decimales</option><option :value="4">4 decimales</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5"><label class="text-[13px] font-semibold text-brand-text">Monto mínimo</label><input v-model.number="form.min" type="number" step="any" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" /></div>
            <div class="flex flex-col gap-1.5"><label class="text-[13px] font-semibold text-brand-text">Monto máximo</label><input v-model.number="form.max" type="number" step="any" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" /></div>
          </div>
          <label class="flex items-center gap-2 text-sm text-brand-text"><input v-model="form.allowNegative" type="checkbox" class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange" />Permitir montos negativos</label>
          <div class="rounded border border-brand-border-light bg-brand-bg px-3 py-2 text-sm text-brand-text-secondary">Vista previa: {{ new Intl.NumberFormat('es-MX', { style: 'currency', currency: form.currency === 'tenant' ? 'MXN' : form.currency, minimumFractionDigits: form.currencyDecimals, maximumFractionDigits: form.currencyDecimals }).format(1250.5) }}</div>
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

        <!-- HU-ERD-74: entidad destino de un campo Relación - antes de esta
             HU un campo relation no tenia forma de saber a que entidad
             apuntaba (solo exigia forma de uuid). Opcional: un campo relation
             sin esto sigue guardando/validando igual, solo no participa de
             las "relaciones inversas" en Diseño del Detalle de otra entidad. -->
        <div v-else-if="form.dataType === 'relation'" class="flex flex-col gap-1.5">
          <label class="text-[13px] font-semibold text-brand-text">Entidad relacionada</label>
          <select
            v-model="form.relationEntity"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            @focus="ensureRelatedEntitiesLoaded()"
          >
            <option value="">Sin especificar</option>
            <option v-for="e in relatedEntities" :key="e.id" :value="e.slug">{{ e.name }}</option>
          </select>
          <p class="text-xs text-brand-text-muted">Permite mostrar este campo como relación inversa en la ficha de detalle de la entidad elegida (HU-ERD-74).</p>
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
              <span class="h-4 w-4 shrink-0 rounded-full" :class="colorDotClass(opt.color)" />
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

        <!-- Pedido directo del usuario (2026-09-04): "quisiera un campo nuevo
             que sea como un incremental... 10 digitos... o un campo
             incremental que use un campo de una relacion para completarse,
             ej. mercado nacional/extranjero, y 6 0 con el incremental,
             E003902 o N002356". Sin mock en el .pen (confirmado antes de
             construir) - mismo lenguaje visual que el resto de paneles de
             esta tarjeta (toggle de dos opciones ya usado arriba para
             Selección única/múltiple). -->
        <div v-else-if="form.dataType === 'incremental'" class="flex flex-col gap-3">
          <p class="text-[13px] font-semibold text-brand-text">Configuración del correlativo</p>

          <div class="flex flex-col gap-1.5">
            <label for="incremental-digits" class="text-[13px] font-semibold text-brand-text">Cantidad de dígitos</label>
            <input
              id="incremental-digits"
              v-model.number="form.incrementalDigits"
              type="number"
              min="1"
              max="15"
              class="w-full max-w-[140px] rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
            <p class="text-xs text-brand-text-muted">Se rellena con ceros a la izquierda (ej. 6 dígitos: "003902").</p>
          </div>

          <div class="flex rounded border border-brand-border-light bg-brand-bg p-1">
            <button
              type="button"
              class="flex-1 rounded px-3 py-1.5 text-[13px] font-semibold"
              :class="form.incrementalMode === 'simple' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              @click="form.incrementalMode = 'simple'"
            >
              Simple
            </button>
            <button
              type="button"
              class="flex-1 rounded px-3 py-1.5 text-[13px] font-semibold"
              :class="form.incrementalMode === 'prefixed' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              @click="form.incrementalMode = 'prefixed'"
            >
              Con prefijo de relación
            </button>
          </div>

          <template v-if="form.incrementalMode === 'prefixed'">
            <p v-if="ownRelationFields.length === 0" class="text-xs text-brand-error-text">
              Este módulo todavía no tiene ningún campo de tipo Relación configurado - agregá uno primero (con su entidad relacionada elegida) para poder usarlo como prefijo.
            </p>
            <template v-else>
              <div class="flex flex-col gap-1.5">
                <label class="text-[13px] font-semibold text-brand-text">Campo de relación</label>
                <select
                  v-model="form.incrementalRelationField"
                  class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                  @change="onIncrementalRelationFieldChange"
                >
                  <option value="" disabled>Elegir campo...</option>
                  <option v-for="f in ownRelationFields" :key="f.id" :value="f.name">{{ f.label }}</option>
                </select>
              </div>

              <div v-if="form.incrementalRelationField" class="flex flex-col gap-1.5">
                <label class="text-[13px] font-semibold text-brand-text">Campo de la entidad relacionada (prefijo)</label>
                <select
                  v-model="form.incrementalSourceField"
                  class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                >
                  <option value="" disabled>Elegir campo...</option>
                  <option v-for="f in incrementalSourceFieldOptions" :key="f.id" :value="f.name">{{ f.label }}</option>
                </select>
                <p v-if="incrementalSourceFieldOptions.length === 0" class="text-xs text-brand-error-text">
                  La entidad relacionada no tiene ningún campo de texto para usar como prefijo.
                </p>
                <p v-else class="text-xs text-brand-text-muted">
                  Ej. si el valor de ese campo es "N", el correlativo queda "N{{ '0'.repeat(Math.max((form.incrementalDigits ?? 6) - 1, 0)) }}1", incrementando por separado para cada valor distinto.
                </p>
              </div>
            </template>
          </template>
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

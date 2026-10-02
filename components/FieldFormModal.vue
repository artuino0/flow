<script setup lang="ts">
import FieldValidationParameter from '~/components/FieldValidationParameter.vue'
import FieldDateValue from '~/components/FieldDateValue.vue'
import { datePresentation, datePreviewDays, formattedFieldDate, type FieldDateFormat } from '~/utils/relativeDate'
import { loadFieldValidationCatalog, parameterError, STRUCTURAL_RULES, type FieldValidationCatalog } from '~/utils/fieldValidationCatalog'
import { collectFieldRefs, parseExpression } from '~/utils/calcExpression'
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
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { OPTION_COLORS, colorDotClass } from '~/utils/optionColors'
import type { FieldFormSource } from '~/utils/designerFieldForm'
import { Braces, Calendar, Check, ChevronDown, CircleDollarSign, CircleHelp, GripVertical, Hash, Link2, List, ListOrdered, LockKeyhole, Paperclip, Plus, Table2, ToggleLeft, Type as TypeIcon, UserRound, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

export interface FieldDraft {
  name: string
  label: string
  dataType: string
  validationRules: Record<string, unknown>
  isRequired: boolean
  isOwnerField?: boolean
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
  entityId?: string
  // Opcional: el diseñador resuelve todos los selectores desde su plano local.
  fieldSource?: FieldFormSource
  readOnly?: boolean
  allowSchemaEditing?: boolean
  hasValues?: boolean
  usedOptionValues?: string[]
  loadingUsage?: boolean
  usageUnavailable?: boolean
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
  { value: 'user', label: 'Usuario', icon: UserRound },
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
  isOwnerField: false,
  userMultiple: false,
  userUnique: false,
  userRoles: '',
  userDefaultCurrent: false,
  catalogRules: {} as Record<string, unknown>,
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
  incrementalMode: 'simple' as 'simple' | 'fixed' | 'prefixed',
  incrementalPrefix: '',
  incrementalRelationField: '',
  incrementalSourceField: '',
  calculationMode: 'manual' as 'manual' | 'formula' | 'rollup' | 'expression',
  expressionText: '',
  formulaOperator: 'subtract' as 'add' | 'subtract' | 'multiply' | 'divide',
  formulaLeftField: '',
  formulaRightField: '',
  rollupSourceEntity: '',
  rollupRelationField: '',
  rollupValueField: '',
  rollupAggregate: 'sum' as 'sum' | 'count' | 'avg' | 'min' | 'max',
  rollupFilterField: '',
  rollupFilterOperator: 'eq' as 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
  rollupFilterValue: ''
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
  return (relatedFieldsByEntity.value[slug] ?? []).filter((f) => f.dataType === 'text' && f.name !== 'id')
})

function onIncrementalRelationFieldChange() {
  form.incrementalSourceField = ''
  const slug = relationEntitySlugFor(form.incrementalRelationField)
  if (slug) void ensureRelatedFieldsLoaded(slug)
}

// Entidades del tenant, para el picker "Entidad relacionada" de una columna
// tipo Tabla (HU-ERD-71) - cargadas una sola vez, bajo demanda (no todo
// campo Tabla necesita una columna de relación).
const tenantEntities = ref<Array<{ id: string; slug: string; name: string }>>([])
const relatedEntities = computed(() => props.fieldSource?.entities ?? tenantEntities.value)
let relatedEntitiesLoaded = false
async function ensureRelatedEntitiesLoaded() {
  if (props.fieldSource || relatedEntitiesLoaded) return
  relatedEntitiesLoaded = true
  try {
    const res = await $fetch<{ entities: Array<{ id: string; slug: string; name: string }> }>('/api/entities')
    tenantEntities.value = res.entities
  } catch {
    // Sin admin o el fetch falla: el picker queda vacío, el resto del
    // builder de columnas sigue funcionando igual para columnas no-relación.
  }
}

// Campos de cada entidad relacionada ya elegida en alguna columna, para
// armar las opciones de "Copiar desde" (copyFrom) de las DEMAS columnas.
const tenantFieldsByEntity = reactive<Record<string, EntityFieldMeta[]>>({})
const relatedFieldsByEntity = computed(() => props.fieldSource?.fieldsByEntity ?? tenantFieldsByEntity)
async function ensureRelatedFieldsLoaded(slug: string) {
  if (props.fieldSource || !slug || relatedFieldsByEntity.value[slug]) return
  try {
    const res = await $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${slug}/fields`)
    tenantFieldsByEntity[slug] = res.fields
  } catch {
    tenantFieldsByEntity[slug] = []
  }
}

const numericOwnFields = computed(() => (props.existingFields ?? []).filter(field =>
  field.name !== form.name && (field.dataType === 'number' || field.dataType === 'currency')
))
// Campos de este módulo que puede usar una expresión (todos menos el propio y los tipos sin valor simple).
const expressionOwnFields = computed(() => (props.existingFields ?? []).filter(field =>
  field.name !== form.name && !['tabla', 'file', 'json', 'multiselect'].includes(field.dataType)
))
const expressionError = computed(() => {
  if (form.calculationMode !== 'expression') return ''
  if (!form.expressionText.trim()) return 'Escribe una expresión'
  try {
    const refs = collectFieldRefs(parseExpression(form.expressionText))
    const known = new Set(expressionOwnFields.value.map(field => field.name))
    const unknown = [...refs].find(ref => !known.has(ref))
    return unknown ? `"${unknown}" no es un campo de este módulo` : ''
  } catch (error) {
    return (error as Error).message
  }
})
const expressionInput = ref<HTMLTextAreaElement | null>(null)
function insertIntoExpression(text: string) {
  const el = expressionInput.value
  const start = el?.selectionStart ?? form.expressionText.length
  const end = el?.selectionEnd ?? start
  form.expressionText = form.expressionText.slice(0, start) + text + form.expressionText.slice(end)
  void nextTick(() => { el?.focus(); const pos = start + text.length; el?.setSelectionRange(pos, pos) })
}
const rollupFilterFields = computed(() => rollupSourceFields.value.filter(field => !['tabla', 'file', 'json', 'multiselect'].includes(field.dataType) && field.name !== 'id'))
const rollupFilterSelectOptions = computed(() => {
  const field = rollupSourceFields.value.find(item => item.name === form.rollupFilterField)
  return field?.dataType === 'select' && Array.isArray(field.validationRules?.options) ? field.validationRules.options as Array<{ value: string; label: string }> : []
})
const currentEntitySlug = computed(() => relatedEntities.value.find(entity => entity.id === props.entityId)?.slug ?? '')
const rollupSourceFields = computed(() => relatedFieldsByEntity.value[form.rollupSourceEntity] ?? [])
const rollupRelationFields = computed(() => rollupSourceFields.value.filter(field =>
  field.dataType === 'relation' && field.validationRules?.relationEntity === currentEntitySlug.value
))
const rollupValueFields = computed(() => rollupSourceFields.value.filter(field => field.dataType === 'number' || field.dataType === 'currency'))

function onCalculationModeChange() {
  form.isRequired = false
  if (form.calculationMode === 'rollup') void ensureRelatedEntitiesLoaded()
}
function onRollupSourceEntityChange() {
  form.rollupRelationField = ''
  form.rollupValueField = ''
  form.rollupFilterField = ''
  form.rollupFilterValue = ''
  if (form.rollupSourceEntity) void ensureRelatedFieldsLoaded(form.rollupSourceEntity)
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
    const fields = relatedFieldsByEntity.value[relCol.relationEntity] ?? []
    for (const f of fields) {
      opts.push({ value: `${relCol.relationEntity}.${f.name}`, label: `${relatedEntity?.name ?? relCol.relationEntity} → ${f.label}` })
    }
  }
  return opts
}


const typePickerOpen = ref(true)
const typeChangeNotice = ref(false)
const typeLocked = computed(() => !props.fieldSource && props.mode === 'edit' && (props.hasValues !== false || props.loadingUsage))
const chosenType = computed(() => TYPE_OPTIONS.find(t => t.value === (form.dataType === 'multiselect' ? 'select' : form.dataType)) ?? TYPE_OPTIONS[0])
function optionInUse(option: OptionDraft | undefined): boolean { return Boolean(option && !props.fieldSource && props.usedOptionValues?.includes(option.value)) }
function reopenTypes() {
  if (typeLocked.value || props.readOnly) return
  typeChangeNotice.value = props.mode === 'edit'
  typePickerOpen.value = true
  void nextTick(() => dialogElement.value?.querySelector<HTMLElement>('[data-type-grid] button')?.focus())
}
function changeSelectionType(value: string) {
  if (typeLocked.value || props.readOnly || form.dataType === value) return
  typeChangeNotice.value = props.mode === 'edit'
  form.catalogRules = {}
  form.dataType = value
}
const catalog = ref<FieldValidationCatalog | null>(null)
const catalogError = ref('')
const catalogLoading = ref(false)
async function ensureCatalogLoaded() {
  catalogLoading.value = true
  catalogError.value = ''
  try { catalog.value = await loadFieldValidationCatalog(() => $fetch<FieldValidationCatalog>('/api/field-validations')) }
  catch { catalogError.value = 'No se pudo cargar el catálogo de validaciones. Intenta de nuevo.' }
  finally { catalogLoading.value = false }
}
const applicableRules = computed(() => catalog.value?.validations.filter(r => r.types.includes(form.dataType) && !STRUCTURAL_RULES.has(r.id) && !['dateFormat', 'showRelative'].includes(r.id)) ?? [])
const selectedRules = computed(() => applicableRules.value.filter(r => r.id in form.catalogRules))
const availableRules = computed(() => applicableRules.value.filter(r => !(r.id in form.catalogRules)))
const dateFields = computed(() => (props.existingFields ?? []).filter(f => f.dataType === 'date' && f.name !== form.name))
const dateFormatCapability = computed(() => catalog.value?.validations.find(r => r.id === 'dateFormat'))
const { user: dateUser } = useAuth()
const previewNow = ref(new Date())
const previewZone = computed(() => dateUser.value?.timezone ?? 'America/Mexico_City')
const previewDays = computed(() => datePreviewDays(previewNow.value, previewZone.value))
const presentation = computed(() => datePresentation(form.catalogRules))
const dateFormatLabels: Record<string, string> = { short: 'Corta', medium: 'Intermedia', long: 'Larga' }
const dateHelpOpen = ref(false)
const dateHelpRoot = ref<HTMLElement | null>(null)
const dateHelpButton = ref<HTMLButtonElement | null>(null)
const dateHelpPopover = ref<HTMLElement | null>(null)
const dateHelpStyle = ref<Record<string, string>>({})
function positionDateHelp() {
  const button = dateHelpButton.value?.getBoundingClientRect()
  const dialog = dialogElement.value?.getBoundingClientRect()
  if (!button || !dialog) return
  const leftBound = Math.max(12, dialog.left + 12)
  const rightBound = Math.min(window.innerWidth - 12, dialog.right - 12)
  const width = Math.max(0, Math.min(320, rightBound - leftBound))
  const left = Math.max(leftBound, Math.min(button.right - width, rightBound - width))
  const below = Math.max(0, window.innerHeight - button.bottom - 20)
  const above = Math.max(0, button.top - 20)
  const height = dateHelpPopover.value?.getBoundingClientRect().height ?? 0
  const placeAbove = height > below && above > below
  dateHelpStyle.value = {
    width: `${width}px`, left: `${left}px`,
    top: placeAbove ? 'auto' : `${Math.max(12, button.bottom + 8)}px`,
    bottom: placeAbove ? `${Math.max(12, window.innerHeight - button.top + 8)}px` : 'auto',
    maxHeight: `${placeAbove ? above : below}px`
  }
}
function removeDateHelpListeners() {
  document.removeEventListener('click', onDateHelpOutside, true)
  document.removeEventListener('scroll', positionDateHelp, true)
  window.removeEventListener('resize', positionDateHelp)
}
function closeDateHelp() {
  if (!dateHelpOpen.value) return
  dateHelpOpen.value = false
  dateHelpButton.value?.focus()
}
function onDateHelpOutside(event: MouseEvent) {
  if (event.target instanceof Node && !dateHelpRoot.value?.contains(event.target) && !dateHelpPopover.value?.contains(event.target)) closeDateHelp()
}
watch(dateHelpOpen, async open => {
  removeDateHelpListeners()
  if (!open) return
  document.addEventListener('click', onDateHelpOutside, true)
  document.addEventListener('scroll', positionDateHelp, true)
  window.addEventListener('resize', positionDateHelp)
  positionDateHelp()
  await nextTick()
  if (dateHelpOpen.value) positionDateHelp()
})
watch(() => form.dataType, () => { dateHelpOpen.value = false })
const ruleErrors = computed(() => Object.fromEntries(selectedRules.value.map(r => [r.id, parameterError(r.parameters[form.dataType], form.catalogRules[r.id])])))
function addValidation(event: Event) {
  const select = event.target as HTMLSelectElement
  const rule = availableRules.value.find(r => r.id === select.value)
  if (rule) {
    const p = rule.parameters[form.dataType]
    form.catalogRules[rule.id] = JSON.parse(JSON.stringify(p.default ?? p.example))
    if (rule.id === 'after' || rule.id === 'before') form.catalogRules[rule.id] = dateFields.value[0]?.name ?? ''
    void nextTick(() => dialogElement.value?.querySelector<HTMLElement>(`#validation-${rule.id}`)?.focus())
  }
  select.value = ''
}
function removeValidation(id: string) {
  delete form.catalogRules[id]
  void nextTick(() => dialogElement.value?.querySelector<HTMLElement>('#add-validation')?.focus())
}
function ruleChoices(id: string) {
  if (id === 'after' || id === 'before') return dateFields.value.map(f => ({ value: f.name, label: f.label }))
  if (id === 'format') return catalog.value?.formats.map(f => ({ value: f.id, label: f.label }))
  if (id === 'allowedTypes') return catalog.value?.file.types.map(f => ({ value: f.id, label: f.label }))
  if (id === 'default' && ['select', 'multiselect'].includes(form.dataType)) return form.options.map(o => ({ value: o.value, label: o.label }))
  return undefined
}
const eligibleFields = computed(() => (relatedFieldsByEntity.value[form.relationEntity] ?? []).filter(f => f.name !== 'id' && !['relation', 'file', 'tabla', 'json', 'user', 'multiselect'].includes(f.dataType)).map(f => ({ value: f.name, label: f.label })))
watch(() => [form.relationEntity, 'eligibleFilter' in form.catalogRules] as const, ([slug, eligible]) => { if (slug && eligible) void ensureRelatedFieldsLoaded(slug) })
function ruleExample(id: string): string {
  if (id === 'format') return catalog.value?.formats.find(f => f.id === form.catalogRules.format)?.example ?? ''
  return JSON.stringify(applicableRules.value.find(r => r.id === id)?.parameters[form.dataType]?.example) ?? ''
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
    form.isOwnerField = field?.isOwnerField ?? false
    form.userMultiple = rules.multiple === true
    form.userUnique = rules.unique === true
    form.userRoles = Array.isArray(rules.roles) ? rules.roles.join(', ') : ''
    form.userDefaultCurrent = rules.defaultCurrentUser === true
    form.catalogRules = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(rules)) as Record<string, unknown>).filter(([id]) => !STRUCTURAL_RULES.has(id)))
    if (form.dataType === 'date' && rules.display !== undefined) {
      Object.assign(form.catalogRules, datePresentation(rules))
      delete form.catalogRules.display
    }
    previewNow.value = new Date()
    dateHelpOpen.value = false
    typePickerOpen.value = !field
    typeChangeNotice.value = false
    void ensureCatalogLoaded()
    form.relationEntity = typeof rules.relationEntity === 'string' ? rules.relationEntity : ''
    const calculation = rules.calculation as Record<string, unknown> | undefined
    form.calculationMode = calculation?.kind === 'formula' || calculation?.kind === 'rollup' || calculation?.kind === 'expression' ? calculation.kind : 'manual'
    form.expressionText = typeof calculation?.expression === 'string' ? calculation.expression : ''
    form.formulaOperator = ['add', 'subtract', 'multiply', 'divide'].includes(String(calculation?.operator)) ? calculation?.operator as typeof form.formulaOperator : 'subtract'
    form.formulaLeftField = typeof calculation?.leftField === 'string' ? calculation.leftField : ''
    form.formulaRightField = typeof calculation?.rightField === 'string' ? calculation.rightField : ''
    form.rollupSourceEntity = typeof calculation?.sourceEntity === 'string' ? calculation.sourceEntity : ''
    form.rollupRelationField = typeof calculation?.relationField === 'string' ? calculation.relationField : ''
    form.rollupValueField = typeof calculation?.valueField === 'string' ? calculation.valueField : ''
    form.rollupAggregate = ['count', 'avg', 'min', 'max'].includes(String(calculation?.aggregate)) ? calculation?.aggregate as typeof form.rollupAggregate : 'sum'
    const rollupFilter = calculation?.filter as Record<string, unknown> | undefined
    form.rollupFilterField = typeof rollupFilter?.field === 'string' ? rollupFilter.field : ''
    form.rollupFilterOperator = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(String(rollupFilter?.operator)) ? rollupFilter?.operator as typeof form.rollupFilterOperator : 'eq'
    form.rollupFilterValue = typeof rollupFilter?.value === 'string' ? rollupFilter.value : ''
    if (form.calculationMode === 'rollup') {
      void ensureRelatedEntitiesLoaded()
      if (form.rollupSourceEntity) void ensureRelatedFieldsLoaded(form.rollupSourceEntity)
    }
    if (form.dataType === 'relation') void ensureRelatedEntitiesLoaded()

    // Pedido directo del usuario (2026-09-04): "Incremental".
    const prefixSource = rules.prefixSource as { relationField?: unknown; sourceField?: unknown } | undefined
    const fixedPrefix = typeof rules.prefix === 'string' ? rules.prefix : ''
    form.incrementalDigits = typeof rules.digits === 'number' ? rules.digits : 6
    form.incrementalPrefix = fixedPrefix
    form.incrementalRelationField = typeof prefixSource?.relationField === 'string' ? prefixSource.relationField : ''
    form.incrementalSourceField = typeof prefixSource?.sourceField === 'string' ? prefixSource.sourceField : ''
    form.incrementalMode = form.incrementalRelationField ? 'prefixed' : fixedPrefix ? 'fixed' : 'simple'
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
  if (props.readOnly || typeLocked.value) return
  typePickerOpen.value = false
  void nextTick(() => dialogElement.value?.querySelector<HTMLElement>('[data-change-type]')?.focus())
  const next = value === 'select' && form.dataType === 'multiselect' ? 'multiselect' : value
  if (next !== form.dataType) form.catalogRules = {}
  if (value !== 'number' && value !== 'currency') form.calculationMode = 'manual'
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
  if (optionInUse(form.options[index])) return
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
  if (optionInUse(opt)) return
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
    case 'text':
    case 'date':
    case 'boolean':
    case 'file':
    case 'json':
      return {}
    case 'number':
    case 'currency': {
      const calculation = buildCalculation()
      return calculation ? { calculation } : {}
    }
    case 'relation':
      return form.relationEntity ? { relationEntity: form.relationEntity } : {}
    case 'user':
      return { multiple: form.userMultiple, unique: form.userUnique && !form.userMultiple, roles: form.userRoles.split(',').map(role => role.trim()).filter(Boolean), defaultCurrentUser: form.userDefaultCurrent }
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
      if (form.incrementalMode === 'fixed' && form.incrementalPrefix.trim()) {
        rules.prefix = form.incrementalPrefix.trim()
      } else if (form.incrementalMode === 'prefixed' && form.incrementalRelationField && form.incrementalSourceField) {
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
  if ((props.mode === 'create' || props.allowSchemaEditing) && form.name === 'id') {
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
  if (form.incrementalMode === 'fixed') return /^[A-Za-z0-9_-]+$/.test(form.incrementalPrefix.trim()) && form.incrementalPrefix.trim().length <= 20
  if (form.incrementalMode === 'prefixed') return Boolean(form.incrementalRelationField && form.incrementalSourceField)
  return true
})

function buildCalculation(): Record<string, unknown> | null {
  if (form.calculationMode === 'formula') return { kind: 'formula', operator: form.formulaOperator, leftField: form.formulaLeftField, rightField: form.formulaRightField }
  if (form.calculationMode === 'expression') return { kind: 'expression', expression: form.expressionText.trim() }
  if (form.calculationMode === 'rollup') {
    return {
      kind: 'rollup', aggregate: form.rollupAggregate, sourceEntity: form.rollupSourceEntity, relationField: form.rollupRelationField,
      ...(form.rollupAggregate !== 'count' ? { valueField: form.rollupValueField } : {}),
      ...(form.rollupFilterField ? { filter: { field: form.rollupFilterField, operator: form.rollupFilterOperator, value: form.rollupFilterValue } } : {})
    }
  }
  return null
}

const calculationValid = computed(() => {
  if (form.dataType !== 'number' && form.dataType !== 'currency') return true
  if (form.calculationMode === 'manual') return true
  if (form.calculationMode === 'formula') return Boolean(form.formulaLeftField && form.formulaRightField)
  if (form.calculationMode === 'expression') return !expressionError.value
  return Boolean(form.rollupSourceEntity && form.rollupRelationField && (form.rollupAggregate === 'count' || form.rollupValueField) && (!form.rollupFilterField || form.rollupFilterValue !== ''))
})

const canSubmit = computed(() => {
  if (props.loadingUsage || props.usageUnavailable || Object.values(ruleErrors.value).some(Boolean)) return false
  if (form.name.length === 0 || nameError.value || form.label.length === 0 || !calculationValid.value) return false
  if (form.dataType === 'select' || form.dataType === 'multiselect') return optionsValid.value
  if (form.dataType === 'tabla') return columnsValid.value
  if (form.dataType === 'incremental') return incrementalValid.value
  return true
})

function onSubmit() {
  if (props.readOnly || !canSubmit.value) return
  const rules = { ...form.catalogRules, ...validationRulesForSubmit() }
  if (form.dataType === 'date') {
    Object.assign(rules, presentation.value)
    delete rules.display
  }
  emit('submit', {
    name: form.name,
    label: form.label,
    dataType: form.dataType,
    validationRules: rules,
    isRequired: (form.dataType === 'number' || form.dataType === 'currency') && form.calculationMode !== 'manual' ? false : form.isRequired,
    isOwnerField: form.dataType === 'user' && form.isOwnerField
  })
}
const dialogElement = ref<HTMLElement | null>(null)
const { confirm: confirmDiscard, dialog: discardDialog } = useConfirm()
let returnFocus: HTMLElement | null = null
const baseline = ref('')
const closing = ref(false)
watch(() => props.open, async open => {
  if (open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    baseline.value = JSON.stringify(form)
    await nextTick()
    dialogElement.value?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus()
  } else {
    await nextTick()
    dateHelpOpen.value = false
    returnFocus?.focus()
  }
}, { flush: 'post' })
async function requestClose() {
  if (props.saving || closing.value) return
  if (!props.readOnly && JSON.stringify(form) !== baseline.value) {
    closing.value = true
    const accepted = await confirmDiscard({ title: 'Descartar cambios del campo', message: 'Hay cambios sin guardar. ¿Quieres descartarlos?', confirmLabel: 'Descartar', destructive: true })
    closing.value = false
    if (!accepted) { dialogElement.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(); return }
  }
  emit('close')
}
function onDialogKeydown(event: KeyboardEvent) {
  if (discardDialog.value) return
  if (event.key === 'Escape' && dateHelpOpen.value) { event.preventDefault(); event.stopPropagation(); closeDateHelp(); return }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void requestClose() }
  if (event.key !== 'Tab') return
  const items = Array.from(dialogElement.value?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]') ?? [])
    .filter(item => !item.matches(':disabled') && item.getClientRects().length > 0)
  const first = items[0]; const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onBeforeUnmount(() => { removeDateHelpListeners(); if (props.open) returnFocus?.focus() })
</script>

<template>
  <div v-if="open" :data-tour="mode === 'create' ? 'manual-field-modal' : undefined" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="requestClose()">
    <div ref="dialogElement" role="dialog" aria-modal="true" aria-labelledby="field-form-title" @keydown="onDialogKeydown" class="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-lg bg-brand-surface shadow-xl">
      <div class="flex items-start justify-between border-b border-brand-border-light p-5">
        <div class="flex flex-col gap-0.5">
          <h2 id="field-form-title" class="text-[17px] font-bold text-brand-text">{{ readOnly ? 'Detalle del campo' : mode === 'create' ? 'Agregar campo' : 'Editar campo' }}</h2>
          <p class="text-sm text-brand-text-secondary">Define las propiedades de este campo</p>
        </div>
        <button type="button" aria-label="Cerrar campo" class="flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg" @click="requestClose()">
          <X class="h-4 w-4" :stroke-width="1.75" />
        </button>
      </div>

      <p v-if="readOnly" class="px-5 pt-5 text-sm text-brand-text-secondary">Este campo ya existe; los campos existentes no se pueden cambiar desde el diseñador</p>
      <fieldset :disabled="readOnly || saving || loadingUsage || usageUnavailable" class="flex min-w-0 flex-col gap-5 border-0 p-5">
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
              :data-tour="mode === 'create' ? 'manual-field-label' : undefined"
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
              :disabled="mode === 'edit' && !allowSchemaEditing"
              class="w-full rounded border border-brand-border px-3 py-[9px] font-mono text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:bg-brand-bg disabled:text-brand-text-muted"
              @input="onFieldNameInput(($event.target as HTMLInputElement).value)"
            />
            <p v-if="nameError" class="text-xs text-brand-error-text">{{ nameError }}</p>
            <p v-else class="text-xs text-brand-text-muted">{{ mode === 'edit' && !allowSchemaEditing ? 'No se puede cambiar una vez creado.' : 'Se completa automáticamente a partir de la etiqueta; puede ajustarse si hace falta.' }}</p>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Tipo de dato</p>
          <div v-if="typePickerOpen && !typeLocked" data-type-grid :data-tour="mode === 'create' ? 'manual-field-type' : undefined" class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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
          <div v-else class="flex items-center gap-3 rounded border border-brand-border bg-brand-bg p-3">
            <component :is="chosenType.icon" class="h-5 w-5 shrink-0 text-brand-blue" />
            <div class="min-w-0 flex-1"><p class="text-sm font-semibold text-brand-text">{{ form.dataType === 'multiselect' ? 'Multiselect' : chosenType.label }}</p><p class="text-xs text-brand-text-muted">{{ form.dataType === 'date' ? 'Fecha de calendario' : `Campo de tipo ${chosenType.label.toLowerCase()}` }}</p></div>
            <button v-if="!typeLocked && !readOnly" data-change-type type="button" class="rounded px-2 py-1 text-sm font-semibold text-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" @click="reopenTypes">Cambiar</button>
          </div>
          <p v-if="loadingUsage" role="status" class="text-xs text-brand-text-muted">Consultando uso del campo…</p>
          <p v-else-if="usageUnavailable" class="text-xs text-brand-error-text">No se pudo comprobar el uso del campo.</p>
          <p v-else-if="typeLocked" class="flex items-center gap-1.5 text-xs text-brand-text-muted"><LockKeyhole class="h-3.5 w-3.5" />Este campo ya tiene datos; el tipo no se puede cambiar</p>
          <p v-if="typeChangeNotice" role="status" class="text-xs text-brand-warning-text">Al cambiar de tipo, las reglas del tipo anterior se descartarán.</p>
        </div>

        <!-- Pedido directo del usuario (2026-09-04): un campo Incremental es
             siempre automatico - "obligatorio" no aplica (el usuario nunca lo
             completa a mano), se oculta el toggle en vez de dejarlo confuso. -->
        <div v-if="form.dataType === 'number' || form.dataType === 'currency'" class="flex flex-col gap-3 rounded border border-brand-border-light bg-brand-bg p-3">
          <div>
            <p class="text-[13px] font-semibold text-brand-text">Valor del campo</p>
            <p class="mt-0.5 text-xs text-brand-text-muted">Puede capturarse, calcularse con otros campos o acumular registros relacionados.</p>
          </div>
          <select v-model="form.calculationMode" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" @change="onCalculationModeChange">
            <option value="manual">Captura manual</option>
            <option value="formula">Fórmula entre dos campos</option>
            <option value="expression">Expresión (varios campos y condicionales)</option>
            <option value="rollup">Acumulado de registros relacionados</option>
          </select>

          <div v-if="form.calculationMode === 'formula'" class="grid grid-cols-[1fr_120px_1fr] gap-2">
            <select v-model="form.formulaLeftField" class="min-w-0 rounded border border-brand-border px-2 py-2 text-sm text-brand-text"><option value="">Primer campo</option><option v-for="field in numericOwnFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
            <select v-model="form.formulaOperator" class="rounded border border-brand-border px-2 py-2 text-sm text-brand-text"><option value="add">Sumar</option><option value="subtract">Restar</option><option value="multiply">Multiplicar</option><option value="divide">Dividir</option></select>
            <select v-model="form.formulaRightField" class="min-w-0 rounded border border-brand-border px-2 py-2 text-sm text-brand-text"><option value="">Segundo campo</option><option v-for="field in numericOwnFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
          </div>

          <div v-else-if="form.calculationMode === 'expression'" class="flex flex-col gap-2">
            <textarea ref="expressionInput" v-model="form.expressionText" rows="3" spellcheck="false" placeholder="sueldo + bonos - isr - imss" class="w-full rounded border border-brand-border px-3 py-2 font-mono text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            <div class="flex flex-wrap gap-1.5">
              <button v-for="field in expressionOwnFields" :key="field.id" type="button" :title="field.label" class="rounded-full border border-brand-border px-2 py-0.5 font-mono text-xs text-brand-text-secondary hover:bg-white hover:text-brand-blue" @click="insertIntoExpression(field.name)">{{ field.name }}</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="snippet in ['SI(condición; valor_si; valor_no)', 'Y(a; b)', 'O(a; b)', 'REDONDEAR(valor; 2)', 'MAX(a; b)', 'MIN(a; b)']" :key="snippet" type="button" class="rounded border border-dashed border-brand-border px-2 py-0.5 font-mono text-xs text-brand-text-muted hover:bg-white hover:text-brand-blue" @click="insertIntoExpression(snippet)">{{ snippet }}</button>
            </div>
            <p v-if="expressionError && form.expressionText.trim()" class="text-xs text-brand-error-text" role="alert">{{ expressionError }}</p>
            <p class="text-xs text-brand-text-muted">Usa los nombres técnicos de los campos, + − × ÷, comparaciones (= &lt;&gt; &lt; &gt; &lt;= &gt;=) y textos entre comillas, como <span class="font-mono">SI(tipo = 'salida'; -cantidad; cantidad)</span>. En un campo de lista se compara con el valor técnico de la opción.</p>
          </div>

          <div v-else-if="form.calculationMode === 'rollup'" class="flex flex-col gap-2">
            <select v-model="form.rollupSourceEntity" class="w-full rounded border border-brand-border px-3 py-2 text-sm text-brand-text" @focus="ensureRelatedEntitiesLoaded" @change="onRollupSourceEntityChange"><option value="">Módulo que contiene los registros</option><option v-for="entity in relatedEntities.filter(item => item.id !== entityId)" :key="entity.id" :value="entity.slug">{{ entity.name }}</option></select>
            <div class="grid grid-cols-2 gap-2">
              <select v-model="form.rollupRelationField" class="min-w-0 rounded border border-brand-border px-3 py-2 text-sm text-brand-text"><option value="">Relación hacia este módulo</option><option v-for="field in rollupRelationFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
              <select v-model="form.rollupAggregate" class="min-w-0 rounded border border-brand-border px-3 py-2 text-sm text-brand-text"><option value="sum">Sumar valores</option><option value="avg">Promedio</option><option value="min">Mínimo</option><option value="max">Máximo</option><option value="count">Contar registros</option></select>
            </div>
            <select v-if="form.rollupAggregate !== 'count'" v-model="form.rollupValueField" class="w-full rounded border border-brand-border px-3 py-2 text-sm text-brand-text"><option value="">Campo que se acumulará</option><option v-for="field in rollupValueFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
            <div v-if="form.rollupSourceEntity" class="flex flex-col gap-1.5 rounded border border-dashed border-brand-border p-2">
              <p class="text-xs font-semibold text-brand-text-secondary">Solo registros que cumplan (opcional)</p>
              <div class="grid grid-cols-[1fr_110px_1fr] gap-2">
                <select v-model="form.rollupFilterField" class="min-w-0 rounded border border-brand-border px-2 py-2 text-sm text-brand-text" @change="form.rollupFilterValue = ''"><option value="">Sin filtro</option><option v-for="field in rollupFilterFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
                <select v-model="form.rollupFilterOperator" :disabled="!form.rollupFilterField" class="rounded border border-brand-border px-2 py-2 text-sm text-brand-text"><option value="eq">es igual a</option><option value="neq">es distinto de</option><option value="gt">mayor que</option><option value="gte">mayor o igual</option><option value="lt">menor que</option><option value="lte">menor o igual</option></select>
                <select v-if="rollupFilterSelectOptions.length" v-model="form.rollupFilterValue" :disabled="!form.rollupFilterField" class="min-w-0 rounded border border-brand-border px-2 py-2 text-sm text-brand-text"><option value="">Valor</option><option v-for="option in rollupFilterSelectOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
                <input v-else v-model="form.rollupFilterValue" :disabled="!form.rollupFilterField" placeholder="Valor" class="min-w-0 rounded border border-brand-border px-2 py-2 text-sm text-brand-text">
              </div>
            </div>
            <p v-if="form.rollupSourceEntity && !rollupRelationFields.length" class="text-xs text-brand-warning-text">El módulo elegido necesita un campo Relación que apunte a este módulo.</p>
          </div>
          <p v-if="form.calculationMode !== 'manual'" class="text-xs text-brand-blue">El sistema mantendrá este valor actualizado y no podrá editarse manualmente.</p>
        </div>

        <div v-if="form.dataType !== 'incremental' && (!(form.dataType === 'number' || form.dataType === 'currency') || form.calculationMode === 'manual')" :data-tour="mode === 'create' ? 'manual-field-required' : undefined" class="flex items-center justify-between rounded border border-brand-border-light p-3">
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

        <div v-if="form.dataType === 'user'" class="flex flex-col gap-3 rounded border border-brand-border-light p-3">
          <label class="flex items-center gap-2 text-sm"><input v-model="form.userMultiple" type="checkbox">Permitir varios usuarios</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="form.userUnique" type="checkbox" :disabled="form.userMultiple">Valor único: cada usuario solo puede aparecer en un registro</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="form.isOwnerField" type="checkbox">Responsable del registro</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="form.userDefaultCurrent" type="checkbox">Usuario actual al crear</label>
          <label class="text-sm">Roles permitidos (nombres o ID, separados por coma)<input v-model="form.userRoles" class="mt-1 w-full rounded border border-brand-border px-3 py-2" placeholder="Doctor, Técnico"></label>
        </div>
        <div class="flex flex-col gap-2" data-validations>
          <label for="add-validation" class="text-[13px] font-semibold text-brand-text">Validaciones</label>
          <select id="add-validation" aria-label="Agregar validación" :disabled="catalogLoading || !availableRules.length" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue" @change="addValidation">
            <option value="">{{ catalogLoading ? 'Cargando validaciones…' : 'Agregar validación' }}</option>
            <option v-for="rule in availableRules" :key="rule.id" :value="rule.id">{{ rule.label }}</option>
          </select>
          <p v-if="catalogError" role="alert" class="text-xs text-brand-error-text">{{ catalogError }} <button type="button" class="underline" @click="ensureCatalogLoaded">Reintentar</button></p>
          <div v-for="rule in selectedRules" :key="rule.id" :data-validation="rule.id" class="flex flex-col gap-1 border-b border-brand-border-light py-2">
            <div class="flex flex-wrap items-center gap-2">
              <label :for="`validation-${rule.id}`" class="min-w-[120px] flex-1 text-xs font-semibold text-brand-text">{{ rule.label }}</label>
              <div class="min-w-0 flex-[2]" :class="ruleErrors[rule.id] ? 'rounded ring-1 ring-brand-error-text' : ''">
                <FieldValidationParameter :id="`validation-${rule.id}`" :label="rule.label" :parameter="rule.parameters[form.dataType]" v-model="form.catalogRules[rule.id]" :choices="ruleChoices(rule.id)" :object-fields="rule.id === 'eligibleFilter' ? eligibleFields : undefined" :invalid="Boolean(ruleErrors[rule.id])" :date="form.dataType === 'date' && ['min', 'max', 'default'].includes(rule.id)" />
              </div>
              <button type="button" :aria-label="`Quitar ${rule.label}`" class="rounded p-1 text-brand-text-muted hover:text-brand-error-text focus:outline-none focus:ring-1 focus:ring-brand-blue" @click="removeValidation(rule.id)"><X class="h-4 w-4" /></button>
            </div>
            <p class="text-xs text-brand-text-muted">{{ rule.description }} <span v-if="ruleExample(rule.id)">Ejemplo: {{ ruleExample(rule.id) }}</span></p>
            <p v-if="ruleErrors[rule.id]" :id="`validation-${rule.id}-error`" role="alert" class="text-xs text-brand-error-text">{{ ruleErrors[rule.id] }}</p>
          </div>
        </div>
        <div v-if="form.dataType === 'date' && dateFormatCapability" data-date-presentation class="flex flex-col gap-5 rounded border border-brand-border-light p-3">
          <div ref="dateHelpRoot" class="flex items-center justify-between gap-2">
            <h3 class="text-[13px] font-semibold text-brand-text">Presentación</h3>
            <button ref="dateHelpButton" type="button" aria-label="Ayuda sobre presentación de fechas" :aria-expanded="dateHelpOpen" aria-controls="date-presentation-help" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand-text-secondary hover:bg-brand-bg focus:outline-none focus:ring-1 focus:ring-brand-blue" @click="dateHelpOpen = !dateHelpOpen"><CircleHelp class="h-4 w-4" aria-hidden="true" :stroke-width="1.75" /></button>
          </div>
          <!-- El panel fijo se monta directamente en el diálogo para escapar del contenido desplazable y conservar su árbol accesible. -->
          <Teleport v-if="dateHelpOpen && dialogElement" :to="dialogElement">
            <div ref="dateHelpPopover" id="date-presentation-help" role="note" :style="dateHelpStyle" class="fixed z-10 overflow-y-auto break-words rounded border border-brand-border bg-brand-surface p-3 text-sm text-brand-text shadow-lg">
              El formato cambia solo cómo se ve la fecha; el dato guardado no cambia. El tiempo relativo agrega cuánto falta o cuánto pasó respecto a hoy (por ejemplo, «hace 12 días» o «en 1 mes») y se calcula al abrir la pantalla.
            </div>
          </Teleport>
          <div class="flex flex-col gap-1.5">
            <label for="date-format" class="text-[13px] font-semibold text-brand-text">{{ dateFormatCapability.label }}</label>
            <select id="date-format" :value="presentation.dateFormat" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue" @change="form.catalogRules.dateFormat = ($event.target as HTMLSelectElement).value">
              <option v-for="value in dateFormatCapability.parameters.date.values" :key="value" :value="value">{{ dateFormatLabels[value] }} · {{ formattedFieldDate(previewDays.today, value as FieldDateFormat, previewZone) }}</option>
            </select>
          </div>
          <div class="flex items-center justify-between gap-3 border-t border-brand-border-light pt-5">
            <div class="min-w-0 flex flex-col gap-0.5">
              <p id="date-show-relative-label" class="text-sm font-semibold text-brand-text">Mostrar tiempo relativo</p>
              <p id="date-show-relative-description" class="text-xs text-brand-text-secondary">Agrega cuánto falta o cuánto pasó junto a la fecha.</p>
            </div>
            <button id="date-show-relative" type="button" role="switch" aria-labelledby="date-show-relative-label" aria-describedby="date-show-relative-description" :aria-checked="presentation.showRelative" class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors focus:outline-none focus:ring-1 focus:ring-brand-blue" :class="presentation.showRelative ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'" @click="form.catalogRules.showRelative = !presentation.showRelative">
              <span class="h-[18px] w-[18px] rounded-full bg-brand-surface shadow" />
            </button>
          </div>
          <div data-date-preview class="min-w-0 rounded border border-brand-border-light bg-brand-bg p-3 text-sm text-brand-text">
            <p class="mb-2 text-xs font-semibold text-brand-text-secondary">Así se verá</p>
            <dl class="divide-y divide-brand-border-light">
              <div data-date-preview-row class="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3">
                <dt class="text-xs text-brand-text-secondary">Fecha pasada</dt>
                <dd class="min-w-0 break-words sm:text-right"><FieldDateValue :value="previewDays.past" :rules="presentation" :now="previewNow" :timezone="previewZone" /></dd>
              </div>
              <div data-date-preview-row class="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3">
                <dt class="text-xs text-brand-text-secondary">Fecha futura</dt>
                <dd class="min-w-0 break-words sm:text-right"><FieldDateValue :value="previewDays.future" :rules="presentation" :now="previewNow" :timezone="previewZone" /></dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- HU-ERD-74: entidad destino de un campo Relación - antes de esta
             HU un campo relation no tenia forma de saber a que entidad
             apuntaba (solo exigia forma de uuid). Opcional: un campo relation
             sin esto sigue guardando/validando igual, solo no participa de
             las "relaciones inversas" en Diseño del Detalle de otra entidad. -->
        <div v-if="form.dataType === 'relation'" class="flex flex-col gap-1.5">
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
        <div v-else-if="form.dataType === 'select' || form.dataType === 'multiselect'" :data-tour="mode === 'create' ? 'manual-field-options' : undefined" class="flex flex-col gap-3">
          <p class="text-[13px] font-semibold text-brand-text">Opciones</p>

          <div class="flex rounded border border-brand-border-light bg-brand-bg p-1">
            <button
              type="button"
              class="flex-1 rounded px-3 py-1.5 text-[13px] font-semibold"
              :class="form.dataType === 'select' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              :disabled="typeLocked"
              @click="changeSelectionType('select')"
            >
              Selección única
            </button>
            <button
              type="button"
              class="flex-1 rounded px-3 py-1.5 text-[13px] font-semibold"
              :class="form.dataType === 'multiselect' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              :disabled="typeLocked"
              @click="changeSelectionType('multiselect')"
            >
              Selección múltiple
            </button>
          </div>

          <div class="flex flex-col gap-2">
            <div v-for="(opt, index) in form.options" :key="index" class="flex flex-wrap items-center gap-2">
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
                :disabled="optionInUse(opt)"
                :aria-label="`Valor interno de ${opt.label}`"
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
              <LockKeyhole v-if="optionInUse(opt)" class="h-4 w-4 text-brand-text-muted" aria-label="Opción en uso" />
              <button type="button" :disabled="optionInUse(opt)" :title="optionInUse(opt) ? 'Opción en uso: no se puede quitar' : 'Quitar opción'" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-text-muted hover:bg-brand-error-bg hover:text-brand-error-text" @click="removeOption(index)">
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
              <div class="flex flex-wrap items-center gap-2">
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
              :class="form.incrementalMode === 'fixed' ? 'bg-brand-surface text-brand-text shadow-sm' : 'text-brand-text-secondary'"
              @click="form.incrementalMode = 'fixed'"
            >
              Prefijo fijo
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

          <template v-if="form.incrementalMode === 'fixed'">
            <div class="flex flex-col gap-1.5">
              <label for="incremental-prefix" class="text-[13px] font-semibold text-brand-text">Prefijo</label>
              <input
                id="incremental-prefix"
                v-model="form.incrementalPrefix"
                type="text"
                maxlength="20"
                placeholder="Ej. FAC-"
                class="w-full max-w-[220px] rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
              <p class="text-xs text-brand-text-muted">
                Se antepone al consecutivo (ej. {{ form.incrementalPrefix.trim() || 'FAC-' }}{{ String(1).padStart(form.incrementalDigits ?? 6, '0') }}).
                Usa letras, números, guion o guion bajo.
              </p>
              <p v-if="form.incrementalPrefix.trim() && !/^[A-Za-z0-9_-]+$/.test(form.incrementalPrefix.trim())" class="text-xs text-brand-error-text">
                El prefijo solo puede contener letras, números, guion y guion bajo.
              </p>
            </div>
          </template>

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

      </fieldset>
      <p v-if="error" role="alert" class="px-5 pb-5 text-sm text-brand-error-text">{{ error }}</p>

      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button type="button" :data-tour="mode === 'create' ? 'manual-field-cancel' : undefined" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="requestClose()">
          {{ readOnly ? 'Cerrar' : 'Cancelar' }}
        </button>
        <button
          v-if="!readOnly"
          :data-tour="mode === 'create' ? 'manual-field-save' : undefined"
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

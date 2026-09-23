<script setup lang="ts">
import { ArrowLeft, Bell, ChevronDown, CircleCheck, CircleHelp, CircleX, ClipboardList, CopyPlus, Flag, GitBranch, Mail, MousePointerClick, Pause, Pencil, Play, Plus, RefreshCw, Save, Trash2, Webhook, X, Zap } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import { workflowValue, workflowInputType } from '~/utils/workflowFields'

definePageMeta({ layout: 'default', editorFullscreen: true })

interface TriggerActionRow {
  id: string
  actionType: 'webhook' | 'email' | 'notification' | 'update_field' | 'upsert_record'
  config: Record<string, unknown>
  executionOrder: number
}

interface TriggerDetail {
  id: string
  name: string
  entityId: string
  entitySlug: string
  entityName: string
  triggerEvent: string
  condition: unknown
  decisionCondition: unknown
  isActive: boolean
  createdAt: string
  updatedAt: string
  actions: TriggerActionRow[]
}



const CONDITION_OPERATORS = [
  { value: 'eq', label: 'es igual a' },
  { value: 'neq', label: 'es distinto de' },
  { value: 'gt', label: 'es mayor que' },
  { value: 'gte', label: 'es mayor o igual a' },
  { value: 'lt', label: 'es menor que' },
  { value: 'lte', label: 'es menor o igual a' },
  { value: 'contains', label: 'contiene' },
  { value: 'changed', label: 'cambió' }
] as const

const ACTION_TYPE_META = {
  webhook: { label: 'Webhook', icon: Webhook, color: 'text-brand-blue', bg: 'bg-brand-blue-bg' },
  email: { label: 'Enviar correo', icon: Mail, color: 'text-brand-success-text', bg: 'bg-brand-success-bg' },
  notification: { label: 'Notificación', icon: Bell, color: 'text-brand-purple-text', bg: 'bg-brand-purple-bg' },
  update_field: { label: 'Actualizar campo', icon: Pencil, color: 'text-brand-warning-text', bg: 'bg-brand-warning-bg' },
  upsert_record: { label: 'Crear o actualizar registro', icon: CopyPlus, color: 'text-brand-blue', bg: 'bg-brand-blue-bg' }
} as const

const STATUS_LABELS: Record<string, string> = {
  success: 'Éxito',
  failed: 'Fallido',
  retrying: 'Reintentando',
  dead_letter: 'Agotado'
}
const STATUS_CLASSES: Record<string, string> = {
  success: 'bg-brand-success-bg text-brand-success-text',
  failed: 'bg-brand-error-bg text-brand-error-text',
  retrying: 'bg-brand-warning-bg text-brand-warning-text',
  dead_letter: 'bg-brand-error-bg text-brand-error-text'
}

const route = useRoute()
const router = useRouter()
const triggerId = route.params.id as string

const TABS = [{ key: 'flujo', label: 'Constructor' }, { key: 'historial', label: 'Historial' }] as const
type StepKey = (typeof TABS)[number]['key']
const step = ref<StepKey>('flujo')
const panel = ref<'trigger' | 'conditions' | 'decision' | 'action' | 'test' | null>(null)

const { data, pending, error: fetchError, refresh } = await useFetch<TriggerDetail>(`/api/triggers/${triggerId}`, {
  key: `trigger-${triggerId}`,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const entitySlug = computed(() => data.value?.entitySlug ?? '')
const { data: fieldsData } = await useFetch<{ fields: EntityFieldMeta[] }>(
  () => `/api/entities/${entitySlug.value}/fields`,
  {
    key: computed(() => `trigger-entity-fields-${entitySlug.value}`),
    immediate: !!entitySlug.value,
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  }
)
const entityFields = computed(() => fieldsData.value?.fields ?? [])

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts.
const toast = useToast()

// ---- Encabezado: nombre, evento, activo ----
const name = ref('')
const triggerEvent = ref<'on_create' | 'on_update' | 'on_delete'>('on_create')
const isActive = ref(false)
watch(() => JSON.stringify([data.value?.name, data.value?.triggerEvent, data.value?.isActive]), () => {
  if (data.value) {
    name.value = data.value.name
    triggerEvent.value = data.value.triggerEvent as 'on_create' | 'on_update' | 'on_delete'
    isActive.value = data.value.isActive
  }
}, { immediate: true })

const saveError = ref<string | null>(null)
const saving = ref(false)
async function onSaveHeader() {
  saveError.value = null
  saving.value = true
  try {
    await $fetch(`/api/triggers/${triggerId}`, {
      method: 'PUT',
      body: { name: name.value, triggerEvent: triggerEvent.value, isActive: isActive.value, condition: conditionPayload.value, decisionCondition: decisionPayload.value }
    })
    await refresh()
    toast.updated('Automatización actualizada', `"${name.value}" se guardó correctamente.`)
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo guardar la automatización'
    toast.error('No se pudo guardar la automatización', saveError.value)
  } finally {
    saving.value = false
  }
}

const deleting = ref(false)
async function onDeleteTrigger() {
  if (!data.value) return
  if (!confirm(`Eliminar la automatización "${data.value.name}"? Esta acción no se puede deshacer.`)) return
  deleting.value = true
  try {
    const triggerName = data.value.name
    await $fetch(`/api/triggers/${triggerId}`, { method: 'DELETE' })
    toast.success('Automatización eliminada', `"${triggerName}" se eliminó correctamente.`)
    await router.push('/triggers')
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudo eliminar la automatización'
    toast.error('No se pudo eliminar la automatización', saveError.value)
  } finally {
    deleting.value = false
  }
}

// ---- Condición (constructor visual campo/operador/valor) ----
interface ConditionRow {
  field: string
  operator: (typeof CONDITION_OPERATORS)[number]['value']
  value: string
}

function isLeaf(n: unknown): n is { field: string; operator: string; value: unknown } {
  return !!n && typeof n === 'object' && 'field' in (n as object) && 'operator' in (n as object)
}

function parseCondition(condition: unknown): { rows: ConditionRow[]; combinator: 'and' | 'or' } {
  if (condition && typeof condition === 'object') {
    const c = condition as Record<string, unknown>
    if (Array.isArray(c.and)) return { rows: c.and.filter(isLeaf).map(toRow), combinator: 'and' }
    if (Array.isArray(c.or)) return { rows: c.or.filter(isLeaf).map(toRow), combinator: 'or' }
    if (isLeaf(c)) return { rows: [toRow(c)], combinator: 'and' }
  }
  return { rows: [], combinator: 'and' }
}
function toRow(leaf: { field: string; operator: string; value: unknown }): ConditionRow {
  return { field: leaf.field, operator: leaf.operator as ConditionRow['operator'], value: leaf.value === undefined || leaf.value === null ? '' : String(leaf.value) }
}

const conditionRows = ref<ConditionRow[]>([])
const allRecords = ref(false)
const decisionRows = ref<ConditionRow[]>([])
const conditionCombinator = ref<'and' | 'or'>('and')
watch(() => JSON.stringify(data.value?.condition), () => {
  if (data.value) {
    allRecords.value = !!(data.value.condition && typeof data.value.condition === 'object' && 'always' in data.value.condition)
    const parsed = parseCondition(data.value.condition)
    conditionRows.value = parsed.rows
    conditionCombinator.value = parsed.combinator
  }
}, { immediate: true })

watch(() => JSON.stringify(data.value?.decisionCondition), () => {
  decisionRows.value = parseCondition(data.value?.decisionCondition).rows
}, { immediate: true })

function addConditionRow() {
  conditionRows.value.push({ field: entityFields.value[0]?.name ?? '', operator: 'eq', value: '' })
}
function removeConditionRow(index: number) {
  conditionRows.value.splice(index, 1)
}

// Preserve text identifiers and convert only according to field metadata.
function fieldMeta(name: string) {
  return entityFields.value.find(field => field.name === name)
}
function availableOperators(name: string) {
  const type = fieldMeta(name)?.dataType
  return CONDITION_OPERATORS.filter(op => {
    if (op.value === 'changed') return triggerEvent.value === 'on_update'
    if (['gt', 'gte', 'lt', 'lte'].includes(op.value)) return type === 'number'
    if (op.value === 'contains') return type === 'text' || type === 'textarea'
    return true
  })
}
function actionConfig(type: string, config: Record<string, unknown>) {
  return type === 'update_field' ? { ...config, value: workflowValue(config.value, fieldMeta(String(config.field))) } : config
}

const conditionPayload = computed<unknown>(() => {
  if (allRecords.value) return { always: true }
  const leaves = conditionRows.value
    .filter((r) => r.field && r.operator)
    .map((r) => ({ field: r.field, operator: r.operator, value: r.operator === 'changed' ? null : workflowValue(r.value, fieldMeta(r.field)) }))
  if (leaves.length === 0) return {}
  if (leaves.length === 1) return leaves[0]
  return { [conditionCombinator.value]: leaves }
})
const decisionPayload = computed<unknown>(() => {
  const row = decisionRows.value[0]
  if (!row?.field || !row.operator) return {}
  return { field: row.field, operator: row.operator, value: row.operator === 'changed' ? null : workflowValue(row.value, fieldMeta(row.field)) }
})

// ---- Acciones ----
const actions = ref<TriggerActionRow[]>([])
watchEffect(() => {
  if (data.value) actions.value = [...data.value.actions].sort((a, b) => a.executionOrder - b.executionOrder)
})

const actionsError = ref<string | null>(null)
const editingActionId = ref<string | null>(null)
const editDraft = ref<{ actionType: TriggerActionRow['actionType']; config: Record<string, unknown> }>({ actionType: 'webhook', config: {} })
const savingAction = ref(false)

function startEditAction(row: TriggerActionRow) {
  panel.value = 'action'
  showAddAction.value = false
  editingActionId.value = row.id
  editDraft.value = { actionType: row.actionType, config: { ...row.config } }
}
function cancelEditAction() {
  editingActionId.value = null
}
async function saveEditAction(row: TriggerActionRow) {
  actionsError.value = null
  savingAction.value = true
  try {
    await $fetch(`/api/trigger-actions/${row.id}`, {
      method: 'PUT',
      body: { actionType: editDraft.value.actionType, config: actionConfig(editDraft.value.actionType, editDraft.value.config) }
    })
    editingActionId.value = null
    await refresh()
    panel.value = null
    toast.updated('Acción actualizada', 'Los cambios se guardaron correctamente.')
  } catch (err: any) {
    actionsError.value = err?.data?.statusMessage || 'No se pudo guardar la acción'
    toast.error('No se pudo guardar la acción', actionsError.value)
  } finally {
    savingAction.value = false
  }
}

async function deleteAction(row: TriggerActionRow) {
  if (!confirm('Eliminar esta acción?')) return
  actionsError.value = null
  try {
    // Cast a string plano: Nitro infiere los metodos permitidos de esta URL
    // dinamica intersectando TODOS los archivos que matchean el mismo
    // prefijo bajo distintas profundidades - `/api/trigger-actions/reorder`
    // (solo PUT, HU-ERD-51) tambien matchea el patron `${string}` de este
    // template literal, asi que el DELETE real de `[id].delete.ts` queda
    // fuera de la interseccion en tiempo de compilacion aunque exista en
    // runtime. Mismo tipo de colision ya documentada (a nivel de ROUTING de
    // Nitro/rou3, no solo de tipos) en server/utils/moduleEntityFields.ts.
    await $fetch(`/api/trigger-actions/${row.id}` as string, { method: 'DELETE' })
    await refresh()
    toast.success('Acción eliminada', 'La acción se eliminó correctamente.')
  } catch (err: any) {
    actionsError.value = err?.data?.statusMessage || 'No se pudo eliminar la acción'
    toast.error('No se pudo eliminar la acción', actionsError.value)
  }
}

// Reordenar via drag-equivalente (flechas arriba/abajo): sin toast de exito -
// un toast por cada click de flecha seria ruido, la UI ya se reordena al
// instante (mismo criterio que ModuleFieldsCard.vue). Si falla, el error SI
// se avisa por toast porque la UI ya cambio de forma optimista y luego se
// revierte con el refresh().
async function moveAction(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= actions.value.length) return
  const reordered = [...actions.value]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
  actions.value = reordered
  actionsError.value = null
  try {
    await $fetch('/api/trigger-actions/reorder', {
      method: 'PUT',
      body: { triggerId, order: reordered.map((a) => a.id) }
    })
    await refresh()
  } catch (err: any) {
    actionsError.value = err?.data?.statusMessage || 'No se pudo reordenar las acciones'
    toast.error('No se pudo reordenar las acciones', actionsError.value)
    await refresh()
  }
}

const showAddAction = ref(false)
const newActionType = ref<TriggerActionRow['actionType']>('webhook')
const newActionConfig = ref<Record<string, unknown>>({})
const newActionBranch = ref<'yes' | 'no' | undefined>(undefined)
function openAddAction() {
  newActionType.value = 'webhook'
  newActionConfig.value = {}
  newActionBranch.value = undefined
  actionsError.value = null
  editingActionId.value = null
  panel.value = 'action'
  showAddAction.value = true
}
function openBranchAction(branch: 'yes' | 'no') {
  step.value = 'flujo'
  openAddAction()
  newActionBranch.value = branch
}
watch(newActionType, () => {
  newActionConfig.value = newActionType.value === 'notification' ? { recipients: [], title: 'Nueva notificación', message: '' } : {}
})
async function onAddAction() {
  actionsError.value = null
  savingAction.value = true
  try {
    await $fetch('/api/trigger-actions', {
      method: 'POST',
      body: { triggerId, actionType: newActionType.value, config: { ...actionConfig(newActionType.value, newActionConfig.value), ...(newActionBranch.value ? { branch: newActionBranch.value } : {}) } }
    })
    showAddAction.value = false
    await refresh()
    panel.value = null
    toast.success('Acción agregada', 'La acción se agregó correctamente.')
  } catch (err: any) {
    actionsError.value = err?.data?.statusMessage || 'No se pudo agregar la acción'
    toast.error('No se pudo agregar la acción', actionsError.value)
  } finally {
    savingAction.value = false
  }
}

function actionSummary(row: TriggerActionRow): string {
  if (row.actionType === 'webhook') return String(row.config.url ?? 'Sin URL configurada')
  if (row.actionType === 'email') return 'Para: ' + String(row.config.to ?? '—') + '\n' + String(row.config.subject ?? '')
  if (row.actionType === 'upsert_record') return 'Crear o actualizar un registro en el módulo configurado'
  if (row.actionType === 'notification') {
    const recipients = Array.isArray(row.config.recipients)
      ? (row.config.recipients as Array<{ type?: string; label?: string }>).map(recipient => `${recipient.type === 'role' ? '&' : '@'}${recipient.label ?? 'destinatario'}`).join(', ')
      : 'Sin destinatarios'
    return 'Notificar a: ' + (recipients || 'Sin destinatarios') + '\n' + String(row.config.title ?? '')
  }
  return (fieldMeta(String(row.config.field))?.label ?? row.config.field ?? 'Campo') + ' = ' + displayValue(row.config.value)
}

const yesActions = computed(() => actions.value.filter(action => (action.config as { branch?: string }).branch === 'yes'))
const noActions = computed(() => actions.value.filter(action => (action.config as { branch?: string }).branch === 'no'))
const linearActions = computed(() => actions.value.filter(action => !(action.config as { branch?: string }).branch))
const decisionSummary = computed(() => {
  const row = decisionRows.value[0]
  if (!row?.field) return 'Configura una decisión para abrir dos caminos'
  const field = fieldMeta(row.field)?.label ?? row.field
  return row.operator === 'changed' ? `${field} cambió` : `${field} ${CONDITION_OPERATORS.find(op => op.value === row.operator)?.label ?? row.operator} ${row.value || '…'}`
})

const sampleValues = ref<Record<string, string>>({})
const previousValues = ref<Record<string, string>>({})
const testing = ref(false)
const previewError = ref('')
const preview = ref<{ matches: boolean; decision?: boolean | null; actions: Array<{ id: string; actionType: string; executionOrder: number }> } | null>(null)
const sampleFields = computed(() => entityFields.value.filter(field => [...conditionRows.value, ...decisionRows.value].some(row => row.field === field.name)))
watch([conditionPayload, decisionPayload, sampleValues, previousValues, triggerEvent, actions], () => { preview.value = null }, { deep: true })
async function testWorkflow() {
  testing.value = true
  previewError.value = ''
  preview.value = null
  try {
    const values = (source: Record<string, string>) => Object.fromEntries(sampleFields.value.map(field => [field.name, workflowValue(source[field.name] ?? '', field)]))
    preview.value = await $fetch<NonNullable<typeof preview.value>>('/api/trigger-preview' as string, {
      method: 'POST',
      body: { triggerId, condition: conditionPayload.value, decisionCondition: decisionPayload.value, data: values(sampleValues.value), previousData: triggerEvent.value === 'on_update' ? values(previousValues.value) : undefined }
    })
  } catch (err: any) {
    previewError.value = err?.data?.statusMessage || 'Configura las condiciones antes de probar el flujo.'
  } finally {
    testing.value = false
  }
}

// ---- Historial (trigger_logs) ----
const { data: logsData, pending: logsPending, refresh: refreshLogs } = await useFetch<
  Array<{ id: string; recordId: string | null; status: string; attemptCount: number; lastError: string | null; createdAt: string }>
>(`/api/trigger-logs`, {
  key: `trigger-logs-${triggerId}`,
  query: { triggerId, limit: 50 },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const retryingId = ref<string | null>(null)
const retryError = ref<string | null>(null)
async function onRetry(logId: string) {
  retryError.value = null
  retryingId.value = logId
  try {
    await $fetch(`/api/trigger-logs/${logId}/retry`, { method: 'POST' })
    await refreshLogs()
    toast.success('Reintento enviado', 'La ejecución se volvió a encolar.')
  } catch (err: any) {
    retryError.value = err?.data?.statusMessage || 'No se pudo reintentar'
    toast.error('No se pudo reintentar', retryError.value)
  } finally {
    retryingId.value = null
  }
}

function displayValue(value: unknown): string {
  return value === true || value === 'true' ? 'Sí' : value === false || value === 'false' ? 'No' : String(value ?? '…')
}
function conditionText(row: ConditionRow): string {
  const label = fieldMeta(row.field)?.label ?? row.field
  return row.operator === 'changed' ? '“' + label + '” cambió' : '“' + label + '” ' + (CONDITION_OPERATORS.find(op => op.value === row.operator)?.label ?? row.operator) + ' “' + displayValue(row.value) + '”'
}
const hasDecision = computed(() => decisionRows.value.length > 0 || yesActions.value.length > 0 || noActions.value.length > 0)
const eventSummary = computed(() => ({ on_create: 'Cuando se crea un registro', on_update: 'Cuando se actualiza un registro', on_delete: 'Cuando se elimina un registro' })[triggerEvent.value])
const panelTitle = computed(() => ({ trigger: 'Configurar disparador', conditions: 'Condiciones de entrada', decision: 'Configurar decisión', action: showAddAction.value ? 'Agregar acción' : 'Configurar acción', test: 'Probar flujo' })[panel.value ?? 'trigger'])
const currentAction = computed(() => actions.value.find(action => action.id === editingActionId.value))
const panelActionType = computed({
  get: () => showAddAction.value ? newActionType.value : editDraft.value.actionType,
  set: value => {
    if (showAddAction.value) newActionType.value = value
    else editDraft.value = {
      actionType: value,
      config: value === 'notification'
        ? { branch: editDraft.value.config.branch, recipients: [], title: 'Nueva notificación', message: '' }
        : { branch: editDraft.value.config.branch }
    }
  }
})
const panelActionConfig = computed(() => showAddAction.value ? newActionConfig.value : editDraft.value.config)
interface WorkflowNotificationRecipient { type: 'user' | 'role'; id: string; label: string }
function replacePanelActionConfig(value: Record<string, unknown>) {
  if (showAddAction.value) newActionConfig.value = value
  else editDraft.value.config = value
}
function setPanelActionConfig(key: string, value: unknown) {
  if (showAddAction.value) newActionConfig.value = { ...newActionConfig.value, [key]: value }
  else editDraft.value.config = { ...editDraft.value.config, [key]: value }
}
const notificationRecipients = computed<WorkflowNotificationRecipient[]>({
  get: () => {
    const recipients = panelActionConfig.value.recipients
    if (!Array.isArray(recipients)) return []
    return recipients.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      if ((value.type !== 'user' && value.type !== 'role') || typeof value.id !== 'string') return []
      return [{ type: value.type, id: value.id, label: typeof value.label === 'string' && value.label ? value.label : value.id } as WorkflowNotificationRecipient]
    })
  },
  set: value => setPanelActionConfig('recipients', value)
})
const notificationTitle = computed({
  get: () => String(panelActionConfig.value.title ?? ''),
  set: value => setPanelActionConfig('title', value)
})
const notificationMessage = computed({
  get: () => String(panelActionConfig.value.message ?? ''),
  set: value => setPanelActionConfig('message', value)
})
const panelActionBranch = computed({
  get: () => showAddAction.value ? newActionBranch.value ?? '' : String(editDraft.value.config.branch ?? ''),
  set: value => {
    if (showAddAction.value) newActionBranch.value = value === 'yes' || value === 'no' ? value : undefined
    else editDraft.value.config.branch = value || undefined
  }
})
const dirty = computed(() => !!data.value && (
  name.value !== data.value.name || triggerEvent.value !== data.value.triggerEvent ||
  JSON.stringify(conditionPayload.value) !== JSON.stringify(data.value.condition) ||
  JSON.stringify(decisionPayload.value) !== JSON.stringify(data.value.decisionCondition ?? {})
))
const actionDirty = computed(() => showAddAction.value || (!!currentAction.value && (
  editDraft.value.actionType !== currentAction.value.actionType || JSON.stringify(editDraft.value.config) !== JSON.stringify(currentAction.value.config)
)))
function selectPanel(next: typeof panel.value) {
  panel.value = next
  if (next !== 'action') { showAddAction.value = false; editingActionId.value = null }
}
async function saveActionPanel() {
  if (showAddAction.value) await onAddAction()
  else if (currentAction.value) await saveEditAction(currentAction.value)
}
async function saveEverything() {
  if (panel.value === 'action' && actionDirty.value) {
    await saveActionPanel()
    if (actionsError.value) return
  }
  await onSaveHeader()
}
async function toggleActive() {
  if (data.value?.isActive) {
    saving.value = true
    saveError.value = null
    try {
      await $fetch('/api/triggers/' + triggerId, { method: 'PUT', body: { isActive: false } })
      await refresh()
      toast.success('Automatización desactivada', 'El flujo quedó inactivo.')
    } catch (err: any) { saveError.value = err?.data?.statusMessage || 'No se pudo desactivar.' }
    finally { saving.value = false }
  } else {
    isActive.value = true
    await saveEverything()
    isActive.value = data.value?.isActive ?? false
  }
}
function openDecision() {
  if (!decisionRows.value.length) {
    const field = entityFields.value.find(field => field.dataType === 'boolean') ?? entityFields.value[0]
    decisionRows.value = [{ field: field?.name ?? '', operator: 'eq', value: field?.dataType === 'boolean' ? 'true' : '' }]
  }
  selectPanel('decision')
}
async function moveBranchAction(row: TriggerActionRow, direction: -1 | 1) {
  const sameBranch = actions.value.filter(action => action.config.branch === row.config.branch)
  const sibling = sameBranch[sameBranch.findIndex(action => action.id === row.id) + direction]
  if (!sibling) return
  const reordered = [...actions.value]
  const a = reordered.findIndex(action => action.id === row.id)
  const b = reordered.findIndex(action => action.id === sibling.id)
  ;[reordered[a], reordered[b]] = [reordered[b], reordered[a]]
  actions.value = reordered
  try {
    await $fetch('/api/trigger-actions/reorder', { method: 'PUT', body: { triggerId, order: reordered.map(action => action.id) } })
    await refresh()
  } catch { await refresh(); toast.error('No se pudo mover la acción', 'Inténtalo de nuevo.') }
}
</script>

<template>
  <div class="workflow-editor">
    <p v-if="pending" class="editor-status">Cargando automatización…</p>
    <div v-else-if="fetchError" class="editor-status" role="alert">No se pudo cargar la automatización. <NuxtLink to="/triggers">Volver a Automatizaciones</NuxtLink></div>
    <template v-else-if="data">
      <header class="workflow-toolbar">
        <div class="toolbar-identity">
          <NuxtLink to="/triggers" class="back-link"><ArrowLeft />Automatizaciones</NuxtLink>
          <span class="toolbar-divider" />
          <div class="name-field"><input v-model="name" aria-label="Nombre de la automatización" /><Pencil /></div>
          <span class="module-chip"><ClipboardList />{{ data.entityName }}</span>
        </div>
        <div class="toolbar-actions">
          <span v-if="dirty || actionDirty" class="dirty-indicator">Sin guardar</span>
          <span class="status-badge" :class="data.isActive ? 'active' : 'draft'">{{ data.isActive ? 'Activa' : 'Borrador' }}</span>
          <button type="button" class="editor-button secondary" @click="step = 'flujo'; selectPanel('test')"><CircleHelp />Probar flujo</button>
          <button type="button" class="editor-button primary" :disabled="saving || savingAction" @click="saveEverything"><Save />{{ saving || savingAction ? 'Guardando…' : 'Guardar cambios' }}</button>
          <button type="button" class="editor-button activation" :disabled="saving || savingAction" @click="toggleActive"><Pause v-if="data.isActive" /><Play v-else />{{ data.isActive ? 'Desactivar' : 'Activar' }}</button>
        </div>
      </header>
      <div v-if="saveError" role="alert" class="toolbar-error">{{ saveError }}</div>
      <nav class="workflow-tabs" aria-label="Vista de automatización" role="tablist">
        <button v-for="tab in TABS" :id="'tab-' + tab.key" :key="tab.key" type="button" role="tab" :aria-selected="step === tab.key" :aria-controls="'view-' + tab.key" :class="{ active: step === tab.key }" @click="step = tab.key">{{ tab.label }}</button>
      </nav>
      <div v-if="step === 'flujo'" id="view-flujo" role="tabpanel" aria-labelledby="tab-flujo" class="workflow-body">
        <section class="workflow-canvas" aria-label="Diagrama de la automatización">
          <div class="workflow-tree">
            <button type="button" class="flow-node trunk-node" :class="{ selected: panel === 'trigger' }" @click="selectPanel('trigger')">
              <span class="flow-icon blue"><Zap /></span><span class="flow-copy"><strong>Disparador</strong><span>{{ eventSummary }} de {{ data.entityName }}</span></span>
            </button>
            <div class="flow-connector"><ChevronDown /></div>
            <button type="button" class="flow-node trunk-node" :class="{ selected: panel === 'conditions' }" @click="selectPanel('conditions')">
              <span class="flow-icon purple"><CircleHelp /></span>
              <span class="flow-copy"><strong>Condiciones de entrada</strong><span v-if="allRecords">Todos los registros del evento</span><span v-else-if="!conditionRows.length" class="incomplete">Sin configurar</span><span v-for="(row, index) in allRecords ? [] : conditionRows" :key="index">{{ index ? (conditionCombinator === 'and' ? 'Y ' : 'O ') : '' }}{{ conditionText(row) }}</span></span>
            </button>

            <template v-if="hasDecision">
              <div class="straight-connector" />
              <button type="button" class="flow-node decision-node" :class="{ selected: panel === 'decision' }" @click="selectPanel('decision')">
                <span class="flow-icon purple diamond"><GitBranch /></span><span class="flow-copy"><small>Decisión</small><strong>{{ decisionRows.length ? conditionText(decisionRows[0]) : 'Configura la decisión' }}</strong><span>El registro continúa por uno de los dos caminos</span></span>
              </button>
              <div class="decision-stem" />
              <div class="flow-branches">
                <section v-for="branch in (['yes', 'no'] as const)" :key="branch" class="flow-branch" :class="[branch, { dimmed: preview?.matches && preview.decision !== null && preview.decision !== undefined && preview.decision !== (branch === 'yes') }]" :aria-label="branch === 'yes' ? 'Rama Sí cumple' : 'Rama No cumple'">
                  <div class="branch-stem" />
                  <div class="branch-label"><CircleCheck v-if="branch === 'yes'" /><CircleX v-else />{{ branch === 'yes' ? 'Sí cumple' : 'No cumple' }}</div>
                  <div class="branch-link" />
                  <template v-for="(row, index) in branch === 'yes' ? yesActions : noActions" :key="row.id">
                    <WorkflowActionNode :title="'Acción ' + (index + 1) + ' · ' + ACTION_TYPE_META[row.actionType].label" :summary="actionSummary(row)" :action-type="row.actionType" :selected="editingActionId === row.id && panel === 'action'" :negative="branch === 'no'" :first="index === 0" :last="index === (branch === 'yes' ? yesActions : noActions).length - 1" @select="startEditAction(row)" @remove="deleteAction(row)" @move="moveBranchAction(row, $event)" />
                    <div class="branch-link action-gap" />
                  </template>
                  <button type="button" class="add-step" :aria-label="'Agregar acción en ' + (branch === 'yes' ? 'Sí cumple' : 'No cumple')" @click="openBranchAction(branch)"><Plus />Agregar acción</button>
                  <div class="branch-link" />
                  <span class="flow-end"><Flag />Fin</span>
                </section>
              </div>
            </template>
            <div v-else class="linear-path">
              <div class="straight-connector" />
              <button type="button" class="add-step" @click="openDecision"><GitBranch />Agregar decisión</button>
            </div>

            <div v-if="linearActions.length || !hasDecision" class="linear-path" :class="{ 'common-actions': hasDecision }">
              <p v-if="hasDecision" class="common-label">Acciones comunes a ambos caminos</p>
              <template v-for="(row, index) in linearActions" :key="row.id">
                <div class="straight-connector" />
                <WorkflowActionNode :title="'Acción ' + (index + 1) + ' · ' + ACTION_TYPE_META[row.actionType].label" :summary="actionSummary(row)" :action-type="row.actionType" :selected="editingActionId === row.id && panel === 'action'" :first="index === 0" :last="index === linearActions.length - 1" @select="startEditAction(row)" @remove="deleteAction(row)" @move="moveBranchAction(row, $event)" />
              </template>
              <div class="straight-connector" /><button type="button" class="add-step" @click="openAddAction"><Plus />Agregar acción</button><div class="straight-connector short" /><span class="flow-end neutral"><Flag />Fin</span>
            </div>
          </div>
        </section>

        <aside class="workflow-panel" :class="{ 'is-open': panel }" aria-label="Configuración del bloque">
          <div v-if="!panel" class="panel-empty">
            <span class="empty-icon"><MousePointerClick /></span>
            <strong>Selecciona un bloque para<br />configurarlo</strong>
            <p>Haz clic en el disparador, una condición o<br />una acción del flujo.</p>
          </div>
          <template v-else>
            <header class="panel-heading"><h2>{{ panelTitle }}</h2><button type="button" aria-label="Cerrar panel" @click="selectPanel(null)"><X /></button></header>
            <div class="panel-content">
              <template v-if="panel === 'trigger'">
                <p class="panel-description">Elige qué evento inicia esta automatización.</p>
                <label class="editor-field">Módulo<input :value="data.entityName" readonly /></label>
                <label class="editor-field">Cuándo iniciar<select v-model="triggerEvent"><option value="on_create">Al crear un registro</option><option value="on_update">Al actualizar un registro</option><option value="on_delete">Al eliminar un registro</option></select></label>
                <p class="panel-hint">Se evalúa cada vez que ocurre este evento.</p>
              </template>
              <template v-else-if="panel === 'conditions'">
                <p class="panel-description">Define qué registros pueden entrar al flujo.</p>
                <label class="radio-field"><input v-model="allRecords" type="radio" :value="true" name="entry" />Todos los registros del evento</label>
                <label class="radio-field"><input v-model="allRecords" type="radio" :value="false" name="entry" />Solo los que cumplan condiciones</label>
                <template v-if="!allRecords">
                  <label v-if="conditionRows.length > 1" class="editor-field">El registro debe cumplir<select v-model="conditionCombinator"><option value="and">Todas las condiciones</option><option value="or">Al menos una condición</option></select></label>
                  <WorkflowConditionRows v-model="conditionRows" :fields="entityFields" :event="triggerEvent" />
                </template>
                <p class="panel-hint">Los registros que no cumplan quedan fuera del flujo.</p>
              </template>
              <template v-else-if="panel === 'decision'">
                <p class="panel-description">La decisión elige el camino que seguirá el registro.</p>
                <WorkflowConditionRows v-model="decisionRows" :fields="entityFields" :event="triggerEvent" single />
                <div class="decision-legend"><span class="legend-yes"><CircleCheck />Sí cumple</span><p>Ejecuta las acciones de esta rama.</p><span class="legend-no"><CircleX />No cumple</span><p>Continúa por el otro camino.</p></div>
              </template>
              <template v-else-if="panel === 'action'">
                <label v-if="hasDecision" class="editor-field">Rama de ejecución<select v-model="panelActionBranch"><option value="">Flujo principal</option><option value="yes">Sí cumple</option><option value="no">No cumple</option></select></label>
                <label class="editor-field">Tipo de acción<select v-model="panelActionType"><option value="update_field">Actualizar campo</option><option value="upsert_record">Crear o actualizar registro</option><option value="email">Enviar correo</option><option value="notification">Notificación</option><option value="webhook">Webhook</option></select></label>
                <template v-if="panelActionType === 'update_field'">
                  <label class="editor-field">Campo<select v-model="panelActionConfig.field"><option value="" disabled>Selecciona un campo</option><option v-for="field in entityFields" :key="field.id" :value="field.name">{{ field.label }}</option></select></label>
                  <WorkflowFieldValue v-model="panelActionConfig.value" :field="fieldMeta(String(panelActionConfig.field))" label="Valor nuevo" />
                </template>
                <template v-else-if="panelActionType === 'upsert_record'">
                  <WorkflowUpsertRecordConfig :model-value="panelActionConfig" :source-entity-id="data.entityId" :source-fields="entityFields" @update:model-value="replacePanelActionConfig" />
                </template>
                <template v-else-if="panelActionType === 'email'">
                  <label class="editor-field">Para<VariableTextField :model-value="String(panelActionConfig.to ?? '')" :entity="entitySlug" label="Para" :rows="1" placeholder="correo@empresa.com" @update:model-value="panelActionConfig.to = $event" /></label>
                  <label class="editor-field">Asunto<VariableTextField :model-value="String(panelActionConfig.subject ?? '')" :entity="entitySlug" label="Asunto" :rows="1" @update:model-value="panelActionConfig.subject = $event" /></label>
                  <label class="editor-field">Mensaje<VariableTextField :model-value="String(panelActionConfig.body ?? '')" :entity="entitySlug" label="Mensaje" :rows="6" @update:model-value="panelActionConfig.body = $event" /></label>
                  <p v-pre class="panel-hint">Puedes usar {{nombre_del_campo}} para insertar datos del registro.</p>
                </template>
                <template v-else-if="panelActionType === 'notification'">
                  <div class="editor-field"><span>Notificar a</span><WorkflowNotificationRecipients v-model="notificationRecipients" /></div>
                  <div class="editor-field"><span>Título</span><VariableTextField v-model="notificationTitle" :entity="entitySlug" label="Título" :rows="1" placeholder="Nueva notificación" /></div>
                  <div class="editor-field"><span>Mensaje</span><VariableTextField v-model="notificationMessage" :entity="entitySlug" label="Mensaje" :rows="4" placeholder="Escribe el mensaje que recibirá el usuario…" /></div>
                  <p v-pre class="panel-hint">Escribe @ para insertar usuarios y &amp; para seleccionar roles. También puedes usar {{nombre_del_campo}} para mostrar datos del registro.</p>
                </template>
                <template v-else>
                  <label class="editor-field">URL de destino<input v-model="panelActionConfig.url" type="url" placeholder="https://..." /></label>
                  <label class="editor-field">Secreto<input v-model="panelActionConfig.secret" type="password" autocomplete="new-password" /></label>
                  <p class="panel-hint">Envía los datos del registro al sistema indicado.</p>
                </template>
                <p v-if="actionsError" role="alert" class="panel-error">{{ actionsError }}</p>
              </template>
              <template v-else-if="panel === 'test'">
                <p class="panel-description">Introduce datos de ejemplo para revisar el recorrido. No se ejecutarán acciones.</p>
                <div v-for="field in sampleFields" :key="field.name" class="sample-field">
                  <strong>{{ field.label }}</strong>
                  <WorkflowFieldValue v-if="triggerEvent === 'on_update'" v-model="previousValues[field.name]" :field="field" label="Antes" />
                  <WorkflowFieldValue v-model="sampleValues[field.name]" :field="field" :label="triggerEvent === 'on_update' ? 'Después' : 'Valor'" />
                </div>
                <p v-if="previewError" role="alert" class="panel-error">{{ previewError }}</p>
                <div v-if="preview" class="preview-result" role="status"><strong>{{ preview.matches ? 'El registro entraría al flujo' : 'El registro no cumple las condiciones' }}</strong><p v-if="preview.matches && preview.decision != null">Camino: {{ preview.decision ? 'Sí cumple' : 'No cumple' }}</p><ol v-if="preview.actions.length"><li v-for="action in preview.actions" :key="action.id">{{ ACTION_TYPE_META[action.actionType as keyof typeof ACTION_TYPE_META]?.label }}</li></ol><p v-else-if="preview.matches">Este recorrido no tiene acciones.</p><small>No se ejecutó ninguna acción.</small></div>
              </template>
            </div>
            <footer class="panel-footer">
              <template v-if="panel === 'action'"><button type="button" class="editor-button secondary" @click="selectPanel(null)">Cancelar</button><button type="button" class="editor-button primary" :disabled="savingAction" @click="saveActionPanel">{{ savingAction ? 'Guardando…' : showAddAction ? 'Agregar acción' : 'Guardar acción' }}</button></template>
              <button v-else-if="panel === 'test'" type="button" class="editor-button primary" :disabled="testing" @click="testWorkflow"><Play />{{ testing ? 'Probando…' : 'Simular recorrido' }}</button>
              <template v-else><span class="panel-hint">{{ dirty ? 'Cambios pendientes de guardar' : 'Configuración guardada' }}</span><button type="button" class="editor-button secondary" @click="selectPanel(null)">Listo</button></template>
            </footer>
          </template>
        </aside>
      </div>

      <section v-else id="view-historial" class="workflow-history" role="tabpanel" aria-labelledby="tab-historial">
        <div class="history-heading"><h2>Historial de ejecuciones</h2><button type="button" class="editor-button secondary" @click="refreshLogs()"><RefreshCw />Actualizar</button></div>
        <p v-if="retryError" role="alert" class="panel-error">{{ retryError }}</p>
        <p v-if="logsPending" class="editor-status">Cargando ejecuciones…</p>
        <div v-else-if="!logsData?.length" class="history-empty"><span class="empty-icon"><RefreshCw /></span><strong>Aún no hay ejecuciones</strong><p>Cuando el flujo se ejecute, verás aquí sus resultados.</p></div>
        <table v-else><thead><tr><th>Fecha</th><th>Estado</th><th>Intentos</th><th>Error</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody><tr v-for="log in logsData" :key="log.id"><td>{{ formatDateTime(log.createdAt) }}</td><td><span class="status-badge" :class="STATUS_CLASSES[log.status]">{{ STATUS_LABELS[log.status] ?? log.status }}</span></td><td>{{ log.attemptCount }}/5</td><td>{{ log.lastError || '—' }}</td><td><button v-if="log.status !== 'success'" type="button" class="editor-button secondary" :disabled="retryingId === log.id" @click="onRetry(log.id)"><RefreshCw />Reintentar</button></td></tr></tbody></table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.workflow-editor{height:calc(100dvh - 56px);display:flex;flex-direction:column;color:#33475b;background:#f5f8fa;font-size:13px}
.workflow-toolbar{display:flex;justify-content:space-between;align-items:center;gap:20px;background:#fff;padding:14px 32px;border-bottom:1px solid #e5eaf0;min-height:66px;flex-shrink:0}
.toolbar-identity,.toolbar-actions{display:flex;align-items:center;gap:12px;min-width:0}.toolbar-identity{flex:1}.toolbar-actions{flex-shrink:0}
.back-link{display:flex;align-items:center;gap:7px;color:#516f90;white-space:nowrap;font-size:13px;font-weight:600}.back-link svg{width:14px;height:14px}.toolbar-divider{height:24px;width:1px;background:#e5eaf0;margin:0 2px}
.name-field{display:flex;align-items:center;gap:5px;min-width:90px;max-width:390px;flex:1}.name-field input{width:100%;min-width:0;border:1px solid transparent;border-radius:3px;padding:4px;font-size:15px;font-weight:700;background:transparent;text-overflow:ellipsis}.name-field input:hover{border-color:#cbd6e2}.name-field>svg{width:13px;height:13px;color:#8da1b5;flex-shrink:0}
.module-chip{display:flex;align-items:center;gap:6px;white-space:nowrap;background:#eaf0f6;border-radius:999px;padding:4px 10px;font-size:11px;color:#516f90}.module-chip svg{width:12px;height:12px}
.status-badge{display:inline-flex;border-radius:999px;padding:4px 11px;font-size:11px;font-weight:600;white-space:nowrap}.status-badge.active{background:#ccf1de;color:#0a7a4f}.status-badge.draft{background:#eaf0f6;color:#516f90}
.dirty-indicator{font-size:11px;color:#b3720a;white-space:nowrap}.editor-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid transparent;border-radius:4px;padding:9px 13px;font-size:13px;font-weight:600;line-height:18px;white-space:nowrap;cursor:pointer}.editor-button svg{width:15px;height:15px;stroke-width:1.75}.editor-button.secondary{background:#fff;border-color:#cbd6e2;color:#33475b}.editor-button.primary{background:#ff7a59;color:#fff;border-color:#ff7a59}.editor-button.activation{background:#fff;border-color:#ff7a59;color:#e35432}.editor-button:hover{filter:brightness(.97)}.editor-button:disabled{opacity:.5;cursor:wait}
.workflow-tabs{display:flex;gap:28px;padding:0 32px;background:#fff;border-bottom:1px solid #e5eaf0;height:40px;flex-shrink:0}.workflow-tabs button{position:relative;padding:10px 4px;font-size:13px;font-weight:600;color:#516f90}.workflow-tabs button.active{color:#ff7a59}.workflow-tabs button.active:after{content:'';height:2px;position:absolute;bottom:-1px;left:0;right:0;background:#ff7a59}
.workflow-body{display:flex;flex:1;min-height:0;position:relative}.workflow-canvas{flex:1;min-width:0;overflow:auto;background-color:#f5f8fa;background-image:radial-gradient(circle,#cbd6e2 1px,transparent 1px);background-position:0 0;background-size:20px 20px}.workflow-tree{max-width:1200px;min-width:560px;margin:0 auto;padding:36px 40px 70px;display:flex;flex-direction:column;align-items:center}
.flow-node{display:flex;align-items:flex-start;gap:12px;padding:16px;border:1px solid #e5eaf0;background:#fff;border-radius:8px;box-shadow:0 1px 3px #33475b14;text-align:left;position:relative;z-index:1}.flow-node:hover{border-color:#a8cbd4}.flow-node.selected{border-color:#0091ae;box-shadow:0 0 0 1px #0091ae}.trunk-node{width:min(620px,100%)}.flow-icon{height:40px;width:40px;flex-shrink:0;border-radius:8px;display:flex;align-items:center;justify-content:center}.flow-icon svg{width:19px;height:19px;stroke-width:1.75}.blue{background:#eaf3f6;color:#0091ae}.purple{background:#ede7fb;color:#6d3fc4}
.flow-copy{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.flow-copy strong{font-size:14px;line-height:1.35;font-weight:700}.flow-copy>span{font-size:13px;color:#516f90;line-height:1.4;overflow-wrap:anywhere}.flow-copy>span.incomplete{color:#b3720a}.flow-copy small{font-size:12px;font-weight:600;color:#6d3fc4}
.flow-connector{width:2px;height:35px;position:relative;background:#cbd6e2}.flow-connector svg{position:absolute;bottom:-1px;left:-7px;width:16px;height:16px;background:#f5f8fa;color:#8da1b5;stroke-width:1.5}.straight-connector{width:2px;height:34px;background:#cbd6e2;flex-shrink:0}.straight-connector.short{height:16px}
.decision-node{width:min(420px,100%);min-height:106px;border-color:#d8c7f0;align-items:center;gap:22px;padding:20px 22px}.diamond{width:40px;height:40px;transform:rotate(45deg);margin:0 8px}.diamond svg{transform:rotate(-45deg)}.decision-node .flow-copy>span{font-size:12px}.decision-stem{height:18px;width:2px;background:#cbd6e2}
.flow-branches{display:flex;justify-content:space-between;gap:40px;width:100%;position:relative}.flow-branches:before{content:'';position:absolute;top:0;left:min(150px,22.5%);right:min(150px,22.5%);height:2px;background:#cbd6e2}
.flow-branch{width:300px;max-width:45%;display:flex;flex-direction:column;align-items:center;--branch-line:#a9dcc2;--branch-bg:#e6f7ee;--branch-color:#0a7a4f}.flow-branch.no{--branch-line:#e8b8b8;--branch-bg:#fce8e8;--branch-color:#c53030}.branch-stem{height:32px;width:2px;background:#cbd6e2}.branch-label{width:100%;display:flex;justify-content:center;align-items:center;gap:7px;border-radius:999px;background:var(--branch-bg);color:var(--branch-color);font-size:12px;font-weight:600;padding:8px 12px}.branch-label svg{width:14px;height:14px;stroke-width:1.75}.branch-link{width:2px;height:15px;background:var(--branch-line)}.branch-link.action-gap{height:30px}.flow-branch.dimmed{opacity:.4}
.add-step{display:flex;align-items:center;gap:6px;border:1px solid #cbd6e2;border-radius:999px;background:#fff;color:#0091ae;padding:6px 12px;font-size:12px;font-weight:600;z-index:1}.add-step:hover{background:#eaf3f6}.add-step svg{width:14px;height:14px}
.flow-end{display:flex;align-items:center;gap:6px;border-radius:999px;padding:7px 14px;background:var(--branch-bg,#eaf0f6);color:var(--branch-color,#516f90);font-size:12px;font-weight:600}.flow-end svg{width:13px;height:13px}.linear-path{width:min(620px,100%);display:flex;flex-direction:column;align-items:center}.common-actions{margin-top:32px}.common-label{font-size:12px;color:#8da1b5}
.workflow-panel{width:380px;flex-shrink:0;border-left:1px solid #e5eaf0;background:#fff;display:flex;flex-direction:column;min-height:0}.panel-empty{display:flex;flex:1;flex-direction:column;justify-content:center;align-items:center;padding:32px;gap:12px;text-align:center}.empty-icon{display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:#f5f8fa;color:#8da1b5}.empty-icon svg{width:24px;height:24px;stroke-width:1.5}.panel-empty strong{font-size:14px;line-height:1.4;color:#516f90;font-weight:600}.panel-empty p{font-size:12px;line-height:1.5;color:#8da1b5}
.panel-heading{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf0;padding:20px 24px;gap:12px}.panel-heading h2{font-size:16px;font-weight:700}.panel-heading button{padding:5px;color:#8da1b5;border-radius:4px}.panel-heading button:hover{background:#f5f8fa}.panel-heading svg{width:17px;height:17px}
.panel-content{padding:24px;display:flex;flex-direction:column;gap:20px;overflow-y:auto;flex:1}.panel-description{font-size:13px;color:#516f90;line-height:1.5}.panel-hint{font-size:12px;color:#8da1b5;line-height:1.5}.editor-field{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}.editor-field input,.editor-field select,.editor-field textarea{width:100%;min-width:0;padding:9px 12px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;font-size:13px;font-weight:400;color:#33475b;min-height:38px}.editor-field input[readonly]{background:#f5f8fa;color:#516f90}.editor-field textarea{resize:vertical}.radio-field{display:flex;align-items:center;gap:9px;font-size:13px;line-height:1.4}.radio-field input{accent-color:#0091ae}.panel-footer{display:flex;align-items:center;justify-content:flex-end;gap:12px;border-top:1px solid #e5eaf0;padding:18px 24px}.panel-footer .panel-hint{margin-right:auto;font-size:11px}
.decision-legend{display:flex;flex-direction:column;gap:7px;font-size:12px}.decision-legend span{display:flex;align-items:center;gap:6px;font-weight:600}.decision-legend svg{width:14px;height:14px}.legend-yes{color:#0a7a4f}.legend-no{color:#c53030}.decision-legend p{margin-bottom:8px;color:#516f90}.panel-error,.toolbar-error{color:#c53030;background:#fce8e8;padding:12px;font-size:13px}.toolbar-error{padding:10px 32px}
.sample-field{display:flex;flex-direction:column;gap:12px;border-top:1px solid #e5eaf0;padding-top:16px}.sample-field>strong{font-size:13px}.preview-result{padding:16px;background:#eaf3f6;border-radius:6px;font-size:13px;display:flex;flex-direction:column;gap:10px}.preview-result ol{list-style:decimal;padding-left:18px;line-height:1.7}.preview-result small{color:#516f90;font-size:11px}
.workflow-history{padding:28px 32px;overflow:auto;flex:1}.history-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}.history-heading h2{font-size:17px;font-weight:700}.history-empty{min-height:350px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#516f90}.history-empty p{font-size:13px;color:#8da1b5}.workflow-history table{width:100%;border-collapse:collapse;background:white;font-size:13px}.workflow-history th,.workflow-history td{text-align:left;padding:12px 16px;border-bottom:1px solid #e5eaf0}.workflow-history th{font-size:12px;color:#516f90;background:#eaf0f6}.editor-status{padding:40px;color:#516f90}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #0091ae;outline-offset:2px}
@media(min-width:1650px){.name-field{max-width:450px}}
@media(max-width:1200px){.workflow-toolbar{padding:12px 20px;gap:12px}.toolbar-actions{gap:8px}.module-chip{display:none}.name-field{max-width:280px}.editor-button{padding:8px 10px;font-size:12px}.workflow-panel{width:340px}.workflow-tree{padding:32px 32px 60px}.dirty-indicator{display:none}}
@media(max-width:900px){.toolbar-identity{flex-basis:100%;max-width:none}.name-field{max-width:none}.workflow-toolbar{flex-wrap:wrap;gap:8px}.toolbar-actions{margin-left:auto}.workflow-panel{display:none}.workflow-panel.is-open{display:flex;position:absolute;right:0;top:0;bottom:0;width:min(380px,100%);z-index:5;box-shadow:-8px 0 20px #33475b14}.workflow-tree{min-width:0;padding:28px 18px 50px}.flow-branch{max-width:46%}.flow-branches{gap:20px}.flow-branches:before{left:23%;right:23%}.trunk-node{max-width:100%}.workflow-tabs{padding:0 20px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style>


<script setup lang="ts">
// HU-ERD-51: editor de un trigger - constructor visual de condicion (campo/
// operador/valor, sin caja de texto libre para escribir codigo, criterio de
// aceptacion explicito de la HU), editor de acciones (webhook/email/
// update_field, en orden de ejecucion) y vista de trigger_logs con reintento
// manual. Sigue Screen/Editor de Trigger del ERPDinamico.pen (disenada para
// esta HU junto con Screen/Triggers, revisada/creada con las herramientas de
// Pencil antes de este cambio) - mismo patron de pestanas (Tab/Active-
// Tab/Default) que pages/modulos/[id]/editar.vue.
//
// Simplificacion deliberada (documentada, mismo espiritu que otras HUs de
// esta epica): el constructor de condicion arma una lista PLANA de
// condiciones combinadas por UN solo operador Y/O (no un arbol AND/OR
// anidado de profundidad arbitraria) - server/utils/triggers.ts (ERD-48)
// soporta el arbol completo via su DSL JSON, pero la UI cubre el caso de uso
// real (varias condiciones simples combinadas de la misma forma) sin la
// complejidad de un editor de arboles.
//
// Reportado por el usuario (2026-09-05, ver mismo comentario en
// pages/triggers/index.vue): texto visible renombrado de "Trigger" a
// "Automatización" siguiendo la version mas nueva de esta pantalla en el
// .pen (las dos versiones del diseño habian quedado desincronizadas entre
// si). Icono del encabezado tambien pasa de Webhook a Zap (generico, no
// depende del tipo de la primera accion) - coincide con el icono ya usado en
// AppNav.vue y en cada fila del listado.
//
// El constructor de condicion (titulo "Condición de disparo", fila Campo/
// Operador/Valor con label arriba de cada select, boton "+ Agregar
// condición", texto "Se combinan con Y/O") ya coincide con la version nueva
// del mock - la unica diferencia real son los selects de Campo/Operador de
// esa version, que muestran un icono "calendar" fijo dentro del valor
// (revisado con las herramientas de Pencil: mismo icono en AMBOS selects,
// sin relacion con el tipo de dato del campo elegido ni con el operador) -
// se interpreta como un resto de copiar el componente Field/Select sin
// terminar de configurarlo, no como una intencion de diseño real, asi que
// no se replica (agregar un icono que no significa nada seria peor que no
// tener icono).
import { ArrowDown, ArrowUp, Mail, Pencil, RefreshCw, Settings2, Trash2, Webhook, X, Zap } from '@lucide/vue'

definePageMeta({ layout: 'default' })

interface TriggerActionRow {
  id: string
  actionType: 'webhook' | 'email' | 'update_field'
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
  isActive: boolean
  createdAt: string
  updatedAt: string
  actions: TriggerActionRow[]
}

interface EntityFieldMeta {
  id: string
  name: string
  label: string
  dataType: string
}

const CONDITION_OPERATORS = [
  { value: 'eq', label: 'es igual a' },
  { value: 'neq', label: 'es distinto de' },
  { value: 'gt', label: 'es mayor que' },
  { value: 'gte', label: 'es mayor o igual a' },
  { value: 'lt', label: 'es menor que' },
  { value: 'lte', label: 'es menor o igual a' },
  { value: 'contains', label: 'contiene' }
] as const

const ACTION_TYPE_META = {
  webhook: { label: 'Webhook', icon: Webhook, color: 'text-brand-blue', bg: 'bg-brand-blue-bg' },
  email: { label: 'Enviar correo', icon: Mail, color: 'text-brand-success-text', bg: 'bg-brand-success-bg' },
  update_field: { label: 'Actualizar campo', icon: Pencil, color: 'text-brand-warning-text', bg: 'bg-brand-warning-bg' }
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

const TABS = [
  { key: 'condicion', label: 'Condición' },
  { key: 'acciones', label: 'Acciones' },
  { key: 'historial', label: 'Historial' }
] as const
type StepKey = (typeof TABS)[number]['key']
const step = ref<StepKey>('condicion')

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
const isActive = ref(true)
watchEffect(() => {
  if (data.value) {
    name.value = data.value.name
    triggerEvent.value = data.value.triggerEvent as 'on_create' | 'on_update' | 'on_delete'
    isActive.value = data.value.isActive
  }
})

const saveError = ref<string | null>(null)
const saving = ref(false)
async function onSaveHeader() {
  saveError.value = null
  saving.value = true
  try {
    await $fetch(`/api/triggers/${triggerId}`, {
      method: 'PUT',
      body: { name: name.value, triggerEvent: triggerEvent.value, isActive: isActive.value, condition: conditionPayload.value }
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
const conditionCombinator = ref<'and' | 'or'>('and')
watchEffect(() => {
  if (data.value) {
    const parsed = parseCondition(data.value.condition)
    conditionRows.value = parsed.rows
    conditionCombinator.value = parsed.combinator
  }
})

function addConditionRow() {
  conditionRows.value.push({ field: entityFields.value[0]?.name ?? '', operator: 'eq', value: '' })
}
function removeConditionRow(index: number) {
  conditionRows.value.splice(index, 1)
}

// Coerce numerica/booleana simple del valor de texto - misma logica en toda
// la fila, sin depender del operador elegido (documentado arriba).
function coerceValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

const conditionPayload = computed<unknown>(() => {
  const leaves = conditionRows.value
    .filter((r) => r.field && r.operator)
    .map((r) => ({ field: r.field, operator: r.operator, value: coerceValue(r.value) }))
  if (leaves.length === 0) return {}
  if (leaves.length === 1) return leaves[0]
  return { [conditionCombinator.value]: leaves }
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
      body: { actionType: editDraft.value.actionType, config: editDraft.value.config }
    })
    editingActionId.value = null
    await refresh()
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
function openAddAction() {
  newActionType.value = 'webhook'
  newActionConfig.value = {}
  actionsError.value = null
  showAddAction.value = true
}
watch(newActionType, () => {
  newActionConfig.value = {}
})
async function onAddAction() {
  actionsError.value = null
  savingAction.value = true
  try {
    await $fetch('/api/trigger-actions', {
      method: 'POST',
      body: { triggerId, actionType: newActionType.value, config: newActionConfig.value }
    })
    showAddAction.value = false
    await refresh()
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
  if (row.actionType === 'email') return `Para: ${row.config.to ?? '—'} · Asunto: ${row.config.subject ?? '—'}`
  return `${row.config.field ?? '—'} → "${row.config.value ?? '—'}"`
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
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <h1 class="text-[22px] font-bold text-brand-text">Editar automatización{{ data ? ` - ${data.name}` : '' }}</h1>
      <NuxtLink to="/triggers" class="text-sm font-semibold text-brand-text-secondary hover:underline">Volver al listado</NuxtLink>
    </div>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar la automatización{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded bg-brand-blue-bg">
            <Zap class="h-[18px] w-[18px] text-brand-blue" :stroke-width="1.75" />
          </div>
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2.5">
              <input
                v-model="name"
                type="text"
                class="rounded border border-transparent px-1 text-[18px] font-bold text-brand-text hover:border-brand-border focus:border-brand-blue focus:outline-none"
              />
              <button
                type="button"
                class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
                :class="isActive ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
                @click="isActive = !isActive"
              >
                <span class="h-[18px] w-[18px] rounded-full bg-white shadow" />
              </button>
            </div>
            <span class="text-xs text-brand-text-secondary">{{ data.entityName }} · {{ triggerEvent === 'on_create' ? 'Al crear' : triggerEvent === 'on_update' ? 'Al actualizar' : 'Al eliminar' }}</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="onDeleteTrigger">
            {{ deleting ? 'Eliminando...' : 'Eliminar' }}
          </button>
          <button
            type="button"
            :disabled="saving"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSaveHeader"
          >
            {{ saving ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </div>
      <p v-if="saveError" class="text-sm text-brand-error-text">{{ saveError }}</p>

      <div class="flex items-center gap-3">
        <select
          v-model="triggerEvent"
          class="rounded border border-brand-border bg-brand-surface px-3 py-1.5 text-sm text-brand-text focus:outline-none"
        >
          <option value="on_create">Al crear</option>
          <option value="on_update">Al actualizar</option>
          <option value="on_delete">Al eliminar</option>
        </select>
      </div>

      <div class="flex gap-8 border-b border-brand-border-light">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="relative flex flex-col items-center gap-2.5 pb-2.5 pt-1"
          @click="step = tab.key"
        >
          <span class="text-sm" :class="step === tab.key ? 'font-bold text-brand-orange' : 'font-semibold text-brand-text-secondary'">{{ tab.label }}</span>
          <span class="absolute inset-x-0 -bottom-px h-0.5 rounded-full" :class="step === tab.key ? 'bg-brand-orange' : 'bg-transparent'" />
        </button>
      </div>

      <!-- ---- Condición ---- -->
      <template v-if="step === 'condicion'">
        <div class="flex max-w-[900px] flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Condición de disparo</h2>
          </div>
          <div class="flex flex-col gap-3 p-5">
            <p v-if="conditionRows.length === 0" class="text-sm text-brand-text-muted">
              Sin condición configurada todavía - la automatización no disparará hasta que agregues al menos una.
            </p>
            <template v-for="(row, index) in conditionRows" :key="index">
              <div v-if="index > 0" class="flex items-center">
                <select
                  v-model="conditionCombinator"
                  class="rounded-full border-none bg-brand-neutral-bg px-2.5 py-0.5 text-xs font-bold text-brand-neutral-text focus:outline-none"
                >
                  <option value="and">Y (todas deben cumplirse)</option>
                  <option value="or">O (con una basta)</option>
                </select>
              </div>
              <div class="flex items-end gap-2.5">
                <div class="flex w-[220px] flex-col gap-1.5">
                  <label class="text-[13px] font-semibold text-brand-text">Campo</label>
                  <select v-model="row.field" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none">
                    <option v-for="f in entityFields" :key="f.id" :value="f.name">{{ f.label }}</option>
                  </select>
                </div>
                <div class="flex w-[190px] flex-col gap-1.5">
                  <label class="text-[13px] font-semibold text-brand-text">Operador</label>
                  <select v-model="row.operator" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none">
                    <option v-for="op in CONDITION_OPERATORS" :key="op.value" :value="op.value">{{ op.label }}</option>
                  </select>
                </div>
                <div class="flex w-[200px] flex-col gap-1.5">
                  <label class="text-[13px] font-semibold text-brand-text">Valor</label>
                  <input v-model="row.value" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none" />
                </div>
                <button type="button" class="flex h-9 w-9 items-center justify-center rounded text-brand-error-text hover:bg-brand-error-bg" @click="removeConditionRow(index)">
                  <Trash2 class="h-4 w-4" :stroke-width="1.75" />
                </button>
              </div>
            </template>
          </div>
          <div class="flex items-center justify-between border-t border-brand-border-light p-5">
            <button type="button" class="flex items-center gap-1.5 rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="addConditionRow">
              + Agregar condición
            </button>
            <p v-if="conditionRows.length > 1" class="text-xs text-brand-text-muted">Se combinan con {{ conditionCombinator === 'and' ? 'Y' : 'O' }}</p>
          </div>
        </div>
      </template>

      <!-- ---- Acciones ---- -->
      <template v-else-if="step === 'acciones'">
        <div class="flex max-w-[900px] flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Acciones (se ejecutan en este orden)</h2>
          </div>
          <p v-if="actionsError" class="mx-5 mt-4 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ actionsError }}</p>
          <div class="flex flex-col gap-2.5 p-5">
            <p v-if="actions.length === 0" class="text-sm text-brand-text-muted">Esta automatización todavía no tiene acciones configuradas.</p>
            <div v-for="(row, index) in actions" :key="row.id" class="flex flex-col rounded border border-brand-border-light bg-brand-bg">
              <template v-if="editingActionId === row.id">
                <div class="flex flex-col gap-3 p-3.5">
                  <select v-model="editDraft.actionType" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:outline-none">
                    <option value="webhook">Webhook</option>
                    <option value="email">Enviar correo</option>
                    <option value="update_field">Actualizar campo</option>
                  </select>

                  <template v-if="editDraft.actionType === 'webhook'">
                    <input v-model="(editDraft.config.url as any)" type="text" placeholder="https://..." class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                    <input v-model="(editDraft.config.secret as any)" type="text" placeholder="Secreto (opcional)" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                  </template>
                  <template v-else-if="editDraft.actionType === 'email'">
                    <input v-model="(editDraft.config.to as any)" type="text" placeholder="Para (admite {{campo}})" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                    <input v-model="(editDraft.config.subject as any)" type="text" placeholder="Asunto" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                    <textarea v-model="(editDraft.config.body as any)" rows="3" placeholder="Cuerpo (admite {{campo}})" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                  </template>
                  <template v-else>
                    <select v-model="(editDraft.config.field as any)" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none">
                      <option v-for="f in entityFields" :key="f.id" :value="f.name">{{ f.label }}</option>
                    </select>
                    <input v-model="(editDraft.config.value as any)" type="text" placeholder="Valor nuevo" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                  </template>

                  <div class="flex justify-end gap-2">
                    <button type="button" class="rounded border border-brand-border px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-surface" @click="cancelEditAction">Cancelar</button>
                    <button type="button" :disabled="savingAction" class="rounded bg-brand-orange px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-orange-hover" @click="saveEditAction(row)">Guardar</button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="flex items-center gap-3 p-3.5">
                  <div class="flex flex-col gap-0.5">
                    <button type="button" :disabled="index === 0" class="flex h-4 w-4 items-center justify-center text-brand-text-muted disabled:opacity-30" @click="moveAction(index, -1)">
                      <ArrowUp class="h-3.5 w-3.5" :stroke-width="2" />
                    </button>
                    <button type="button" :disabled="index === actions.length - 1" class="flex h-4 w-4 items-center justify-center text-brand-text-muted disabled:opacity-30" @click="moveAction(index, 1)">
                      <ArrowDown class="h-3.5 w-3.5" :stroke-width="2" />
                    </button>
                  </div>
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded" :class="ACTION_TYPE_META[row.actionType].bg">
                    <component :is="ACTION_TYPE_META[row.actionType].icon" class="h-4 w-4" :class="ACTION_TYPE_META[row.actionType].color" :stroke-width="1.75" />
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="text-sm font-semibold text-brand-text">{{ index + 1 }}. {{ ACTION_TYPE_META[row.actionType].label }}</span>
                    <span class="truncate text-xs text-brand-text-muted">{{ actionSummary(row) }}</span>
                  </div>
                  <button type="button" class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-text-secondary hover:bg-brand-bg" @click="startEditAction(row)">
                    <Settings2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                  <button type="button" class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-error-text hover:bg-brand-error-bg" @click="deleteAction(row)">
                    <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                </div>
              </template>
            </div>
          </div>
          <div class="border-t border-brand-border-light p-5">
            <button type="button" class="flex items-center gap-1.5 rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="openAddAction">
              + Agregar acción
            </button>
          </div>
        </div>

        <div v-if="showAddAction" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showAddAction = false">
          <div class="flex w-full max-w-[440px] flex-col rounded-lg bg-brand-surface shadow-xl">
            <div class="flex items-start justify-between border-b border-brand-border-light p-5">
              <h2 class="text-[17px] font-bold text-brand-text">Agregar acción</h2>
              <button type="button" class="flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg" @click="showAddAction = false">
                <X class="h-4 w-4" :stroke-width="1.75" />
              </button>
            </div>
            <div class="flex flex-col gap-3.5 p-5">
              <select v-model="newActionType" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:outline-none">
                <option value="webhook">Webhook</option>
                <option value="email">Enviar correo</option>
                <option value="update_field">Actualizar campo</option>
              </select>

              <template v-if="newActionType === 'webhook'">
                <input v-model="(newActionConfig.url as any)" type="text" placeholder="https://..." class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                <input v-model="(newActionConfig.secret as any)" type="text" placeholder="Secreto (opcional)" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
              </template>
              <template v-else-if="newActionType === 'email'">
                <input v-model="(newActionConfig.to as any)" type="text" placeholder="Para (admite {{campo}})" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                <input v-model="(newActionConfig.subject as any)" type="text" placeholder="Asunto" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
                <textarea v-model="(newActionConfig.body as any)" rows="3" placeholder="Cuerpo (admite {{campo}})" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
              </template>
              <template v-else>
                <select v-model="(newActionConfig.field as any)" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none">
                  <option v-for="f in entityFields" :key="f.id" :value="f.name">{{ f.label }}</option>
                </select>
                <input v-model="(newActionConfig.value as any)" type="text" placeholder="Valor nuevo" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm focus:outline-none" />
              </template>
            </div>
            <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
              <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="showAddAction = false">Cancelar</button>
              <button type="button" :disabled="savingAction" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60" @click="onAddAction">
                {{ savingAction ? 'Agregando...' : 'Agregar acción' }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ---- Historial ---- -->
      <template v-else>
        <p v-if="retryError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ retryError }}</p>
        <p v-if="logsPending" class="text-sm text-brand-text-muted">Cargando...</p>
        <p v-else-if="!logsData || logsData.length === 0" class="text-sm text-brand-text-muted">Esta automatización todavía no tiene ejecuciones registradas.</p>
        <div v-else class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <table class="min-w-full text-sm">
            <thead class="border-b border-brand-border-light bg-brand-bg">
              <tr>
                <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Fecha</th>
                <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Estado</th>
                <th class="px-4 py-2.5 text-right text-[12px] font-bold tracking-wide text-brand-text-secondary">Intentos</th>
                <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Error</th>
                <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary" />
              </tr>
            </thead>
            <tbody class="divide-y divide-brand-border-light">
              <tr v-for="log in logsData" :key="log.id" class="hover:bg-brand-bg">
                <td class="px-4 py-3 text-brand-text-secondary">{{ formatDateTime(log.createdAt) }}</td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS_CLASSES[log.status] ?? 'bg-brand-neutral-bg text-brand-neutral-text'">
                    {{ STATUS_LABELS[log.status] ?? log.status }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right text-brand-text">{{ log.attemptCount }}/5</td>
                <td class="max-w-[420px] truncate px-4 py-3 text-brand-text-muted" :title="log.lastError ?? ''">{{ log.lastError ?? '—' }}</td>
                <td class="px-4 py-3">
                  <button
                    v-if="log.status !== 'success'"
                    type="button"
                    :disabled="retryingId === log.id"
                    class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-60"
                    @click="onRetry(log.id)"
                  >
                    <RefreshCw class="h-3.5 w-3.5" :stroke-width="1.75" />
                    {{ retryingId === log.id ? 'Reintentando...' : 'Reintentar' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>

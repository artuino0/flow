<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, Coins, CreditCard, ExternalLink, LoaderCircle, Maximize2, MessageSquareText, Minimize2, PanelLeftClose, Plus, RotateCcw, Send, Sparkles, Trash2, X } from '@lucide/vue'
import type { Blueprint, BlueprintField } from '~/server/utils/blueprint/schema'
import { buildDesignerGraph, designerFieldTypeLabel, type DesignerDiff, type DesignerPositions, type DesignerRelationFilter } from '~/utils/designerGraph'
import { createDesignerClient, type CreditBalance, type DesignerApplication, type DesignerApply, type DesignerNavigation, type DesignerSession } from '~/utils/designerClient'
import { beginDesignerChat, canSendDesignerChat, designerChatEntries, designerExplanationBody, designerExplanationSummary, failDesignerChat, toggleDesignerFocus, type DesignerChatDraft } from '~/utils/designerChat'

definePageMeta({ middleware: 'designer', editorFullscreen: true, fullBleed: true })
useHead({ title: 'Diseñador de estructura | Flow' })

const api = createDesignerClient((url, options) => $fetch(url, { method: options?.method, body: options?.body as Record<string, unknown> | undefined }))
const { confirm } = useConfirm()
const sessions = ref<DesignerSession[]>([])
const applications = ref<DesignerApplication[]>([])
const session = ref<DesignerSession | null>(null)
const current = ref<Blueprint | null>(null)
const working = ref<Blueprint | null>(null)
const diff = ref<DesignerDiff | null>(null)
const navigation = ref<DesignerNavigation | undefined>()
const credits = ref<CreditBalance | null>(null)
const positions = ref<DesignerPositions>({})
const selectedId = ref<string | null>(null)
const focusId = ref<string | null>(null)
const selectedEdgeId = ref<string | null>(null)
const relationFilter = ref<DesignerRelationFilter>('none')
const changedIds = ref<string[]>([])
const prompt = ref('')
const chatDrafts = ref<DesignerChatDraft[]>([])
const chatScroll = ref<HTMLElement | null>(null)
const loading = ref(true)
const busy = ref<'generate' | 'save' | 'apply' | 'undo' | ''>('')
const errorText = ref('')
const fieldErrors = ref<Array<{ path: string; message: string; code?: string }>>([])
const reviewOpen = ref(false)
const result = ref<DesignerApply | null>(null)
const inspectorTab = ref<'fields' | 'relations' | 'states'>('fields')
const chatOpen = ref(false)
const chatFocused = ref(false)
const explanationText = ref('')
const inspectorOpen = ref(false)
const sessionMenuOpen = ref(false)
const rulesDraft = ref<Record<string, string>>({})
const chatPanel = usePanelWidth({ storageKey: 'flow-designer-chat-width', defaultValue: 360, min: 280, max: 520 })
const inspectorPanel = usePanelWidth({ storageKey: 'flow-designer-inspector-width', defaultValue: 320, min: 280, max: 480 })
const chatWidth = chatPanel.width
const inspectorWidth = inspectorPanel.width
const canvas = ref<{ fitCanvas: () => void } | null>(null)
let fitTimer: ReturnType<typeof setTimeout> | null = null
function scheduleCanvasFit() {
  if (fitTimer) clearTimeout(fitTimer)
  fitTimer = setTimeout(() => { fitTimer = null; canvas.value?.fitCanvas() }, 150)
}
watch([chatWidth, inspectorWidth], scheduleCanvasFit)
watch(selectedId, id => { if (!id) relationFilter.value = 'none' })
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (chatFocused.value) { chatFocused.value = false; event.stopPropagation() }
  else if (explanationText.value) explanationText.value = ''
}
onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => { if (fitTimer) clearTimeout(fitTimer); window.removeEventListener('keydown', onEscape) })
function toggleFocus() {
  chatFocused.value = toggleDesignerFocus({ focused: chatFocused.value, chatWidth: chatWidth.value, inspectorWidth: inspectorWidth.value, canvasState: { selectedId: selectedId.value, focusId: focusId.value, relationFilter: relationFilter.value } }).focused
}

const graph = computed(() => current.value && working.value ? buildDesignerGraph(current.value, working.value, diff.value, navigation.value) : null)
const selected = computed(() => working.value?.modules.find(module => module.slug === selectedId.value) ?? null)
const selectedGraph = computed(() => graph.value?.modules.find(module => module.id === selectedId.value))
const relatedEdges = computed(() => graph.value?.edges.filter(edge => edge.source === selectedId.value || edge.target === selectedId.value) ?? [])
const hasProposal = computed(() => Boolean(working.value && current.value && JSON.stringify({ modules: working.value.modules, associations: working.value.associations, roles: working.value.roles ?? [] }) !== JSON.stringify({ modules: current.value.modules, associations: current.value.associations, roles: current.value.roles ?? [] })))
const dirty = computed(() => Boolean(working.value && session.value && JSON.stringify(working.value) !== JSON.stringify(session.value.blueprint)))
const firstGeneration = computed(() => !(session.value?.messages ?? []).some(message => message.role === 'assistant'))
const messageCost = computed(() => firstGeneration.value ? 2 : 1)
const balance = computed(() => credits.value?.includedRemaining === null ? Infinity : (credits.value?.includedRemaining ?? 0) + (credits.value?.packages ?? 0))
const noCredits = computed(() => balance.value < messageCost.value)
const chatCanSend = computed(() => canSendDesignerChat({ busy: Boolean(busy.value), noCredits: noCredits.value, dirty: dirty.value, applied: session.value?.status === 'applied' }))
const chatEntries = computed(() => designerChatEntries(session.value?.messages ?? [], chatDrafts.value))
const lastAssistantId = computed(() => [...chatEntries.value].reverse().find(message => message.role === 'assistant')?.id)
watch(chatEntries, async () => { await nextTick(); if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight })
const canApprove = computed(() => Boolean(session.value && session.value.status === 'draft' && hasProposal.value && !dirty.value && diff.value?.plan.allowed && !busy.value))
const changes = computed(() => [
  { label: 'Módulos nuevos', count: diff.value?.newModules.length ?? 0 },
  { label: 'Catálogos', count: diff.value?.newCatalogs.length ?? 0 },
  { label: 'Ampliaciones', count: diff.value?.extendedModules.length ?? 0 },
  { label: 'Relaciones', count: (diff.value?.relations.length ?? 0) + (diff.value?.associations.length ?? 0) },
  { label: 'Estados', count: diff.value?.states.length ?? 0 }
])
const fieldTypes = ['text', 'number', 'currency', 'boolean', 'date', 'select', 'multiselect', 'relation', 'user', 'incremental', 'file', 'tabla', 'json'] as const

function cloneBlueprint(value: Blueprint): Blueprint { return JSON.parse(JSON.stringify(value)) as Blueprint }
function apiError(error: unknown) {
  const e = error as { statusMessage?: string; message?: string; data?: { statusMessage?: string; data?: { code?: string; errors?: Array<{ path: string; message: string; code?: string }> } } }
  return { message: e.data?.statusMessage || e.statusMessage || e.message || 'Ocurrió un error.', code: e.data?.data?.code, status: (e as { statusCode?: number }).statusCode ?? (e.data as { statusCode?: number } | undefined)?.statusCode, errors: e.data?.data?.errors ?? [] }
}
async function refreshCredits() { credits.value = await api.getCredits() }
async function loadSession(id: string) {
  loading.value = true
  errorText.value = ''
  try {
    const selectedSession = await api.getSession(id)
    session.value = selectedSession
    chatDrafts.value = []
    working.value = cloneBlueprint(selectedSession.blueprint)
    const validated = await api.validate(selectedSession.blueprint)
    diff.value = validated.diff
    fieldErrors.value = validated.errors.filter(error => error.code !== 'plan_limit')
    selectedId.value = null
    focusId.value = null
    selectedEdgeId.value = null
    relationFilter.value = 'none'
    changedIds.value = []
    result.value = null
    sessionMenuOpen.value = false
  } catch (error) { errorText.value = apiError(error).message } finally { loading.value = false }
}
async function startSession() {
  loading.value = true
  try {
    const created = await api.createSession()
    sessions.value = [created, ...sessions.value]
    await loadSession(created.id)
  } catch (error) { errorText.value = apiError(error).message; loading.value = false }
}
async function switchSession(id?: string) {
  if (dirty.value && !await confirm({ title: 'Cambios sin guardar', message: 'Los cambios manuales sin guardar se perderán al cambiar de sesión.', confirmLabel: 'Cambiar sesión', destructive: true })) return
  if (id) await loadSession(id)
  else await startSession()
}
onMounted(async () => {
  try {
    const [allSessions, base, creditBalance, nav, layout, applied] = await Promise.all([api.listSessions(), api.getCurrent(), api.getCredits(), api.getNavigation(), api.getLayout(), api.listApplications()])
    sessions.value = allSessions
    applications.value = applied
    current.value = base
    credits.value = creditBalance
    navigation.value = nav
    positions.value = layout.positions
    const resumable = allSessions.find(item => item.status === 'draft' || item.status === 'error')
    if (resumable) await loadSession(resumable.id)
    else await startSession()
  } catch (error) { errorText.value = apiError(error).message; loading.value = false }
})

async function sendPrompt(value = prompt.value, retryId?: string) {
  const retry = retryId ? chatDrafts.value.find(draft => draft.id === retryId && draft.status === 'failed') : undefined
  const instruction = (retry ? retry.content : value).trim()
  if (!instruction || !session.value || !chatCanSend.value) return
  if (retryId && !retry) return
  const draftId = retry?.id ?? crypto.randomUUID()
  chatDrafts.value = beginDesignerChat(chatDrafts.value, instruction, draftId, new Date().toISOString(), retryId)
  if (!retryId) prompt.value = ''
  busy.value = 'generate'; errorText.value = ''
  let response: Awaited<ReturnType<typeof api.generate>>
  try {
    response = await api.generate(session.value.id, instruction)
  } catch (error) {
    const info = apiError(error)
    chatDrafts.value = failDesignerChat(chatDrafts.value, draftId, info.code, info.status)
    await Promise.allSettled([refreshCredits(), api.getSession(session.value.id).then(value => { session.value = value })])
    busy.value = ''
    return
  }
  const refreshed: DesignerSession = { ...session.value, status: 'draft', blueprint: response.blueprint, version: session.value.version + 1, creditsConsumed: session.value.creditsConsumed + messageCost.value, messages: [...session.value.messages, { role: 'user', content: instruction, createdAt: chatDrafts.value.find(draft => draft.id === draftId)?.createdAt ?? new Date().toISOString() }, { role: 'assistant', content: response.message, createdAt: new Date().toISOString() }] }
  refreshed.messages[refreshed.messages.length - 1]!.explanation = response.explanation
  session.value = refreshed
  chatDrafts.value = chatDrafts.value.filter(draft => draft.id !== draftId)
  working.value = cloneBlueprint(response.blueprint)
  diff.value = response.diff
  credits.value = response.credits
  fieldErrors.value = []
  changedIds.value = []
  await nextTick()
  changedIds.value = [...response.diff.newModules, ...response.diff.newCatalogs, ...response.diff.extendedModules, ...response.diff.states].map(item => item.slug)
  relationFilter.value = 'none'
  selectedEdgeId.value = null
  selectedId.value = changedIds.value[0] ?? null
  sessions.value = [refreshed, ...sessions.value.filter(item => item.id !== refreshed.id)]
  busy.value = ''
}

async function saveBlueprint() {
  if (!session.value || !working.value || !dirty.value || busy.value) return
  busy.value = 'save'; errorText.value = ''; fieldErrors.value = []
  try {
    const response = await api.save(session.value.id, working.value)
    session.value = response.session
    working.value = cloneBlueprint(response.normalized ?? response.session.blueprint)
    diff.value = response.diff
    fieldErrors.value = response.errors.filter(error => error.code !== 'plan_limit')
    sessions.value = [response.session, ...sessions.value.filter(item => item.id !== response.session.id)]
  } catch (error) { const info = apiError(error); errorText.value = info.message; fieldErrors.value = info.errors } finally { busy.value = '' }
}

async function showReview() {
  if (!session.value || !working.value || dirty.value || busy.value || !hasProposal.value) return
  try {
    const validated = await api.validate(working.value)
    diff.value = validated.diff
    fieldErrors.value = validated.errors.filter(error => error.code !== 'plan_limit')
    if (fieldErrors.value.length) { errorText.value = 'Corrige los errores del plano antes de aprobar.'; return }
    reviewOpen.value = true
  } catch (error) { errorText.value = apiError(error).message }
}
async function approve() {
  if (!canApprove.value || !session.value) return
  busy.value = 'apply'; errorText.value = ''
  try {
    result.value = await api.apply(session.value.id)
    session.value = await api.getSession(session.value.id)
    current.value = await api.getCurrent()
    working.value = cloneBlueprint(current.value)
    diff.value = null
    reviewOpen.value = false
    sessions.value = [session.value, ...sessions.value.filter(item => item.id !== session.value?.id)]
    applications.value = await api.listApplications()
  } catch (error) { const info = apiError(error); errorText.value = info.message; if (info.code === 'plan_limit' && working.value) diff.value = (await api.validate(working.value)).diff } finally { busy.value = '' }
}
function selectModule(id: string | null) {
  if (selectedId.value !== id) relationFilter.value = 'none'
  selectedId.value = id
  selectedEdgeId.value = null
  focusId.value = null
  if (id) inspectorOpen.value = true
}
async function undoApplication(item: DesignerApplication) {
  if (!item.canUndo || busy.value) return
  const parts = [`Se enviarán a la papelera ${item.modules} módulos o catálogos nuevos, dejarán de estar activos ${item.fields} campos y se quitarán ${item.associations} asociaciones creadas por este diseño.`, ...item.warnings, 'Los créditos consumidos no se devuelven.']
  if (!await confirm({ title: `Deshacer «${item.summary}»`, message: parts.join('\n\n'), confirmLabel: 'Deshacer diseño', destructive: true })) return
  busy.value = 'undo'; errorText.value = ''
  try {
    await api.undoApplication(item.id, item.warnings.length > 0)
    const [base, applied, allSessions] = await Promise.all([api.getCurrent(), api.listApplications(), api.listSessions()])
    current.value = base
    applications.value = applied
    sessions.value = allSessions
    if (session.value?.status === 'applied') {
      await startSession()
    } else if (session.value && working.value) {
      const validated = await api.validate(working.value)
      diff.value = validated.diff
      fieldErrors.value = validated.errors.filter(error => error.code !== 'plan_limit')
    }
    selectedId.value = null
    selectedEdgeId.value = null
    relationFilter.value = 'none'
    result.value = null
    sessionMenuOpen.value = false
    explanationText.value = ''
    await nextTick()
    canvas.value?.fitCanvas()
  } catch (error) {
    errorText.value = apiError(error).message
    applications.value = await api.listApplications().catch(() => applications.value)
  } finally { busy.value = '' }
}
function selectEdge(id: string) {
  selectedId.value = null
  focusId.value = null
  relationFilter.value = 'none'
  selectedEdgeId.value = id
}
function clearCanvasSelection() {
  selectedId.value = null
  focusId.value = null
  selectedEdgeId.value = null
  relationFilter.value = 'none'
}
function setSelectedIcon(icon: string) {
  if (selected.value?.action === 'create' && session.value?.status !== 'applied' && !busy.value) selected.value.icon = icon
}
async function savePositions(value: DesignerPositions) {
  positions.value = value
  try { await api.putLayout(value) } catch (error) { errorText.value = `No se pudo guardar el acomodo: ${apiError(error).message}` }
}
function addField() {
  if (!selected.value || !working.value) return
  const names = new Set(selected.value.fields.map(field => field.name))
  let index = 1
  while (names.has(`nuevo_campo_${index}`)) index++
  selected.value.fields.push({ name: `nuevo_campo_${index}`, label: 'Nuevo campo', dataType: 'text', required: false, validationRules: {} })
}
function updateType(field: BlueprintField, value: string) {
  field.dataType = value as BlueprintField['dataType']
  field.isOwnerField = false
  field.validationRules = value === 'relation' ? { relationEntity: working.value?.modules.find(module => module.slug !== selectedId.value)?.slug ?? '' } : value === 'select' || value === 'multiselect' ? { options: [{ value: 'opcion', label: 'Opción' }] } : {}
}
function updateOptions(field: BlueprintField, value: string) {
  field.validationRules = { ...(field.validationRules ?? {}), options: value.split(',').map(label => label.trim()).filter(Boolean).map(label => ({ value: label.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_'), label })) }
}
function updateRules(field: BlueprintField, key: string, value: string) {
  try { field.validationRules = JSON.parse(value) as BlueprintField['validationRules']; delete rulesDraft.value[key]; errorText.value = '' }
  catch { rulesDraft.value[key] = value; errorText.value = 'Las reglas avanzadas deben ser JSON válido.' }
}
function fieldIsEditable(field: BlueprintField) { return selectedGraph.value?.fields.find(item => item.name === field.name)?.state !== 'existing' }
function fieldError(moduleIndex: number, fieldIndex: number) { return fieldErrors.value.filter(error => error.path.startsWith(`modules[${moduleIndex}].fields[${fieldIndex}]`)).map(error => error.message).join(' · ') }
async function removeField(index: number) {
  if (!selected.value || !fieldIsEditable(selected.value.fields[index]!)) return
  if (await confirm({ title: 'Quitar campo', message: 'Se quitará este campo de la propuesta. Los módulos existentes no cambiarán hasta aprobar.', confirmLabel: 'Quitar', destructive: true })) selected.value.fields.splice(index, 1)
}
async function removeModule() {
  const target = selected.value
  if (!target || target.action !== 'create' || !working.value) return
  if (!await confirm({ title: 'Quitar módulo nuevo', message: `Se quitará ${target.name} y sus relaciones nuevas de la propuesta.`, confirmLabel: 'Quitar módulo', destructive: true })) return
  const ref = target.ref; const slug = target.slug
  working.value.modules = working.value.modules.filter(module => module.ref !== ref)
  working.value.associations = working.value.associations.filter(item => ![ref, slug].includes(item.sourceRef) && ![ref, slug].includes(item.targetRef))
  for (const module of working.value.modules) {
    module.lines = module.lines?.filter(line => ![ref, slug].includes(line.childRef))
    module.fields = module.fields.filter(field => {
      const existed = current.value?.modules.find(item => item.slug === module.slug)?.fields.some(item => item.name === field.name)
      const relation = field.validationRules?.relationEntity
      const sourceEntity = (field.validationRules?.calculation as { sourceEntity?: string } | undefined)?.sourceEntity
      return existed || (![ref, slug].includes(String(relation ?? '')) && ![ref, slug].includes(String(sourceEntity ?? '')))
    })
  }
  selectedId.value = null
  focusId.value = null
}
function editableTypeName(field: BlueprintField) { return designerFieldTypeLabel(field).split(' → ')[0] }
function formatDate(value: string) { return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) }
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-brand-bg text-brand-text">
    <div class="flex h-[55px] shrink-0 items-center justify-between gap-3 border-b border-brand-border-light bg-brand-surface px-3 sm:px-5">
      <div class="flex min-w-0 items-center gap-2 sm:gap-3">
        <NuxtLink to="/modulos" class="flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-bg"><ArrowLeft class="h-4 w-4" /><span class="hidden sm:inline">Volver</span></NuxtLink>
        <span class="hidden h-5 w-px bg-brand-border-light sm:block" />
        <strong class="hidden whitespace-nowrap text-sm sm:block">Diseñador de estructura</strong>
        <input v-if="working" v-model="working.summary" class="min-w-0 max-w-44 rounded border border-brand-border-light bg-brand-bg px-2 py-1 text-xs font-semibold outline-none focus:border-brand-blue sm:max-w-56" aria-label="Nombre del diseño" />
        <div class="relative">
          <button type="button" class="flex items-center gap-1 rounded border border-brand-border-light px-2 py-1 text-xs text-brand-text-secondary hover:bg-brand-bg" :aria-expanded="sessionMenuOpen" @click="sessionMenuOpen = !sessionMenuOpen"><span class="hidden sm:inline">Sesiones</span><ChevronDown class="h-3 w-3" /></button>
          <div v-if="sessionMenuOpen" class="absolute left-0 top-8 z-50 max-h-80 w-80 overflow-y-auto rounded-md border border-brand-border-light bg-brand-surface p-1 shadow-lg">
            <button type="button" class="w-full rounded px-3 py-2 text-left text-xs font-semibold text-brand-blue hover:bg-brand-bg" @click="switchSession()"><Plus class="mr-1 inline h-3 w-3" />Nuevo diseño</button>
            <button v-for="item in sessions.filter(value => value.status === 'draft' || value.status === 'error')" :key="item.id" type="button" class="flex w-full flex-col rounded px-3 py-2 text-left text-xs hover:bg-brand-bg" :class="session?.id === item.id ? 'bg-brand-blue-bg' : ''" @click="switchSession(item.id)"><span class="truncate font-semibold">{{ item.blueprint.summary }}</span><span class="text-[10px] text-brand-text-muted">{{ formatDate(item.updatedAt) }} · {{ item.status === 'applied' ? 'Creado' : 'Borrador' }}</span></button>
            <div v-if="applications.length" class="mt-1 border-t border-brand-border-light pt-2"><h2 class="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Diseños aplicados</h2><div v-for="item in applications" :key="item.id" class="border-b border-brand-border-light px-3 py-2 text-xs last:border-b-0"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><strong class="block truncate">{{ item.summary }}</strong><span class="text-[10px] text-brand-text-muted">{{ formatDate(item.createdAt) }} · {{ item.userName || 'Sistema' }}</span></div><button type="button" class="rounded border border-red-200 px-2 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!item.canUndo || Boolean(busy)" :title="item.reason || undefined" @click="undoApplication(item)">Deshacer</button></div><p class="mt-1 text-[10px] text-brand-text-secondary">{{ item.modules }} módulos · {{ item.fields }} campos · {{ item.associations }} asociaciones</p><p v-if="item.reason" class="mt-1 text-[10px] text-amber-800">{{ item.reason }}</p><p v-for="warning in item.warnings" :key="warning" class="mt-1 text-[10px] text-amber-800">{{ warning }}</p></div></div>
          </div>
        </div>
        <span class="hidden rounded-full bg-brand-bg px-2.5 py-1 text-[11px] font-semibold text-brand-text-secondary lg:inline">{{ credits?.includedRemaining === null ? 'Créditos ilimitados' : `${balance} créditos` }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button v-if="dirty" type="button" class="rounded border border-brand-blue px-2.5 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-bg" :disabled="Boolean(busy)" @click="saveBlueprint"><LoaderCircle v-if="busy === 'save'" class="mr-1 inline h-3 w-3 animate-spin" />Guardar cambios</button>
        <button type="button" class="rounded bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-40" :disabled="!hasProposal || dirty || Boolean(busy) || session?.status === 'applied'" @click="showReview"><Check class="mr-1 inline h-3.5 w-3.5" />Revisar y aprobar</button>
      </div>
    </div>

    <div v-if="errorText" role="alert" class="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800"><AlertCircle class="h-4 w-4 shrink-0" /><span class="flex-1">{{ errorText }}</span><button type="button" aria-label="Cerrar aviso" @click="errorText = ''"><X class="h-4 w-4" /></button></div>
    <div v-if="result" role="status" class="flex shrink-0 items-center gap-3 border-b border-green-200 bg-green-50 px-4 py-2 text-xs text-green-800"><CheckCircle2 class="h-4 w-4" /><span>Diseño creado. {{ result.modules.length }} módulos o catálogos nuevos.</span><NuxtLink v-for="module in result.modules.slice(0, 4)" :key="module.id" :to="`/modulos/${module.id}/editar`" class="font-semibold underline">{{ module.slug }} <ExternalLink class="inline h-3 w-3" /></NuxtLink></div>

    <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center text-sm text-brand-text-secondary"><LoaderCircle class="mr-2 h-5 w-5 animate-spin" />Cargando estructura…</div>
    <div v-else-if="graph" class="designer-workspace relative flex min-h-0 flex-1" :class="{ 'is-focused': chatFocused }">
      <aside class="designer-chat min-h-0 shrink-0 flex-col border-r border-brand-border-light bg-brand-surface" :style="{ '--designer-chat-width': `${chatWidth}px` }" :class="chatOpen ? 'is-open' : ''">
        <div class="flex items-center justify-between border-b border-brand-border-light px-4 py-3"><div class="flex items-center gap-2"><Sparkles class="h-4 w-4 text-brand-orange" /><strong class="text-sm">Asistente de estructura</strong></div><div class="flex items-center gap-1"><button type="button" class="rounded p-1.5 text-brand-text-muted hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" :aria-label="chatFocused ? 'Contraer chat' : 'Expandir chat'" :title="chatFocused ? 'Contraer' : 'Expandir'" @click="toggleFocus"><Minimize2 v-if="chatFocused" class="h-4 w-4" /><Maximize2 v-else class="h-4 w-4" /></button><button v-if="!chatFocused" type="button" class="rounded p-1 text-brand-text-muted hover:bg-brand-bg designer-mobile-control" aria-label="Cerrar chat" @click="chatOpen = false"><PanelLeftClose class="h-4 w-4" /></button></div></div>
        <div ref="chatScroll" class="designer-chat-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 text-xs" aria-live="polite">
          <div v-if="!chatEntries.length" class="space-y-4"><div class="rounded-lg bg-brand-blue-bg p-4 leading-5 text-brand-text-secondary">Describe tu negocio o el cambio que necesitas. Verás la propuesta sobre {{ current?.modules.length ? 'tu estructura actual' : 'un lienzo vacío' }} antes de crearla.</div><div><p class="mb-2 font-bold text-brand-text-muted">PRUEBA CON UNA IDEA</p><button v-for="suggestion in ['Agrega un módulo de garantías', 'Relaciona órdenes con clientes', 'Crea un catálogo de tipos de servicio']" :key="suggestion" type="button" class="mb-2 block w-full rounded-md border border-brand-border-light px-3 py-2 text-left hover:border-brand-blue hover:bg-brand-bg" @click="prompt = suggestion">{{ suggestion }}</button></div></div>
          <div v-for="message in chatEntries" :key="message.id" class="space-y-2">
            <div class="rounded-lg px-3 py-2.5 leading-5" :class="message.role === 'user' ? 'ml-6 bg-brand-blue-bg text-brand-text' : 'mr-4 border border-brand-border-light bg-brand-surface text-brand-text-secondary'"><span class="mb-1 block text-[10px] font-bold uppercase tracking-wide" :class="message.role === 'user' ? 'text-brand-blue' : 'text-brand-orange'">{{ message.role === 'user' ? 'Tú' : 'Diseñador' }}</span><span class="whitespace-pre-line">{{ message.explanation ? designerExplanationSummary(message.explanation) : message.content }}</span><template v-if="message.role === 'assistant' && message.explanation"><details class="mt-2 border-t border-brand-border-light pt-2" :open="message.explanation.length <= 280"><summary class="cursor-pointer font-semibold text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue">¿Por qué?</summary><MarkdownView class="mt-2" :source="designerExplanationBody(message.explanation)" /></details><button type="button" class="mt-2 rounded text-[11px] font-semibold text-brand-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" @click="explanationText = message.explanation">Ver explicación completa</button></template><div v-if="message.id === lastAssistantId && diff && hasProposal" class="mt-3 flex flex-wrap gap-1.5 border-t border-brand-border-light pt-2"><span v-for="item in changes.filter(value => value.count)" :key="item.label" class="rounded-full bg-brand-bg px-2 py-1 text-[10px] font-semibold">{{ item.label }} · {{ item.count }}</span></div></div>
            <div v-if="message.draft?.status === 'pending'" role="status" class="mr-4 flex items-center gap-2 rounded-lg border border-brand-border-light bg-brand-bg px-3 py-2.5 text-brand-text-secondary"><span class="font-semibold text-brand-orange">Diseñando…</span><span class="designer-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
            <div v-else-if="message.draft?.status === 'failed'" role="alert" class="mr-4 rounded-lg border border-red-200 bg-red-50 p-3 leading-5 text-red-800"><p>{{ message.draft.error }}</p><NuxtLink v-if="message.draft.action === 'plan'" to="/ajustes?section=plan" class="mt-2 inline-flex rounded border border-red-300 bg-brand-surface px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100">Mejorar plan</NuxtLink><button v-else type="button" class="mt-2 inline-flex items-center gap-1 rounded border border-red-300 bg-brand-surface px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!chatCanSend" @click="sendPrompt(message.content, message.draft.id)"><RotateCcw class="h-3 w-3" />Reintentar</button></div>
          </div>
        </div>
        <div class="designer-composer border-t border-brand-border-light p-3"><div v-if="noCredits" class="mb-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-900"><Coins class="mr-1 inline h-4 w-4" />Sin créditos suficientes. Puedes editar el plano a mano. <NuxtLink to="/ajustes?section=plan" class="font-semibold underline">Ver plan</NuxtLink></div><div v-if="dirty" class="mb-2 text-[11px] text-brand-blue">Guarda los cambios manuales antes de continuar con la IA.</div><label class="sr-only" for="designer-prompt">Describe el cambio</label><textarea id="designer-prompt" v-model="prompt" rows="3" maxlength="4000" class="w-full resize-none rounded-md border border-brand-border-light bg-brand-surface px-3 py-2 text-xs outline-none focus:border-brand-blue disabled:bg-brand-bg" :placeholder="firstGeneration ? 'Describe qué necesita tu negocio…' : 'Pide un ajuste a la propuesta…'" :disabled="!chatCanSend" @keydown.ctrl.enter.prevent="sendPrompt()" /><div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-brand-text-muted"><span>Cuesta {{ messageCost }} {{ messageCost === 1 ? 'crédito' : 'créditos' }} · Saldo {{ balance === Infinity ? 'ilimitado' : balance }}</span><button type="button" class="inline-flex items-center gap-1 rounded bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-40" :disabled="!prompt.trim() || !chatCanSend" @click="sendPrompt()"><Send class="h-3 w-3" />Enviar</button></div></div>
      </aside>

      <PanelResizeHandle v-model="chatWidth" class="designer-handle" :min="280" :max="520" :default-value="360" label="Redimensionar chat" @commit="chatPanel.persist()" />

      <main class="relative min-w-0 flex-1">
        <div v-if="!graph.modules.length" class="absolute inset-0 z-[1] flex items-center justify-center bg-brand-bg/90 p-6"><div class="max-w-lg rounded-lg border border-brand-border-light bg-brand-surface p-7 text-center shadow-sm"><Sparkles class="mx-auto mb-3 h-7 w-7 text-brand-orange" /><h1 class="text-lg font-bold">Diseña tu estructura</h1><p class="mt-2 text-sm leading-6 text-brand-text-secondary">Aún no hay módulos. Describe tu operación en el chat y revisa el plano antes de crearlo.</p><button type="button" class="mt-5 rounded bg-brand-orange px-4 py-2 text-xs font-semibold text-white designer-mobile-control" @click="chatOpen = true">Abrir chat</button></div></div>
        <ClientOnly><DesignerCanvas v-if="graph.modules.length" ref="canvas" :graph="graph" :positions="positions" :selected-id="selectedId" :focus-id="focusId" :selected-edge-id="selectedEdgeId" :relation-filter="relationFilter" :changed-ids="changedIds" :disabled="session?.status === 'applied'" @select="selectModule" @edge-select="selectEdge" @clear="clearCanvasSelection" @focus="focusId = $event" @positions="savePositions" /><template #fallback><div class="h-full bg-brand-bg" /></template></ClientOnly>
        <button type="button" class="absolute left-4 top-20 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-brand-orange text-white shadow-lg designer-mobile-control" aria-label="Abrir chat" @click="chatOpen = true"><MessageSquareText class="h-5 w-5" /></button>
        <button v-if="selectedId" type="button" class="absolute right-4 top-20 z-10 rounded bg-brand-surface px-3 py-2 text-xs font-semibold text-brand-blue shadow designer-mobile-control" @click="inspectorOpen = true">Ver inspector</button>
        <span v-if="graph.modules.length" class="absolute bottom-4 left-4 z-[2] hidden rounded bg-brand-surface px-2 py-1 text-[10px] text-brand-text-muted shadow sm:block lg:left-44">{{ graph.modules.length }} módulos y catálogos · {{ graph.sections.length }} secciones</span>
      </main>

      <PanelResizeHandle v-model="inspectorWidth" class="designer-handle" :min="280" :max="480" :default-value="320" :direction="-1" label="Redimensionar inspector" @commit="inspectorPanel.persist()" />

      <aside class="designer-inspector min-h-0 shrink-0 flex-col border-l border-brand-border-light bg-brand-surface" :style="{ '--designer-inspector-width': `${inspectorWidth}px` }" :class="inspectorOpen ? 'is-open' : ''">
        <div class="flex items-start justify-between gap-2 border-b border-brand-border-light px-4 py-3"><div class="min-w-0"><span class="text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Inspector</span><h2 class="truncate text-sm font-bold">{{ selected?.name || 'Selecciona un módulo' }}</h2><p v-if="selected" class="text-[11px] text-brand-text-secondary">{{ selected.kind === 'dimension' ? 'Catálogo' : 'Módulo' }} · {{ selected.action === 'create' ? 'Nuevo' : 'Existente' }}</p></div><button type="button" class="rounded p-1 text-brand-text-muted hover:bg-brand-bg designer-mobile-control" aria-label="Cerrar inspector" @click="inspectorOpen = false"><X class="h-4 w-4" /></button></div>
        <div v-if="selected" class="flex items-center gap-3 border-b border-brand-border-light px-4 py-3"><IconPicker :model-value="selected.icon ?? null" :disabled="selected.action !== 'create' || session?.status === 'applied' || Boolean(busy)" @update:model-value="setSelectedIcon" /><div><span class="block text-xs font-semibold">Icono del módulo</span><span class="text-[11px] text-brand-text-muted">{{ selected.action === 'create' && session?.status !== 'applied' ? 'Cámbialo y guarda los cambios gratis' : 'Solo lectura' }}</span></div></div>
        <div v-if="selected" class="border-b border-brand-border-light px-4 py-3"><span class="mb-2 block text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Relaciones directas</span><div role="group" aria-label="Filtrar relaciones directas" class="grid grid-cols-2 gap-1 rounded-md bg-brand-bg p-1"><button v-for="option in [{ value: 'none', label: 'Ver todo' }, { value: 'all', label: 'Todas las relaciones' }, { value: 'catalogs', label: 'Catálogos relacionados' }, { value: 'modules', label: 'Módulos relacionados' }] as const" :key="option.value" type="button" :aria-pressed="relationFilter === option.value" class="rounded px-2 py-1.5 text-left text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" :class="relationFilter === option.value ? 'bg-brand-surface text-brand-blue shadow-sm' : 'text-brand-text-secondary hover:bg-brand-surface/70'" @click="relationFilter = option.value">{{ option.label }}</button></div></div>
        <div v-if="selected && working?.roles?.length" class="border-b border-brand-border-light px-4 py-3 text-xs">
          <strong>Visibilidad propuesta por rol</strong>
          <p v-for="role in working.roles" :key="role.name" class="mt-1 text-brand-text-secondary">
            {{ role.name }}: {{ role.permissions.filter(permission => permission.moduleRef === selected?.slug || permission.moduleRef === selected?.ref).map(permission => permission.visibility === 'own' ? 'Solo los suyos' : 'Todos').join(', ') || 'sin permiso para este módulo' }}
          </p>
        </div>
        <div v-if="selected && selected.fields.some(field => field.dataType === 'user')" class="border-b border-brand-border-light px-4 py-3 text-xs">
          <strong>Responsables del registro</strong>
          <label v-for="field in selected.fields.filter(item => item.dataType === 'user')" :key="field.name" class="mt-2 flex items-center gap-2">
            <input v-model="field.isOwnerField" type="checkbox" :disabled="!fieldIsEditable(field) || session?.status === 'applied'" />{{ field.label }}
          </label>
        </div>
        <div class="flex border-b border-brand-border-light px-3"><button v-for="tab in [{ id: 'fields', label: 'Campos' }, { id: 'relations', label: 'Relaciones' }, { id: 'states', label: 'Estados' }] as const" :key="tab.id" type="button" class="px-2.5 py-3 text-xs font-semibold" :class="inspectorTab === tab.id ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-brand-text-muted hover:text-brand-text'" @click="inspectorTab = tab.id">{{ tab.label }}</button></div>
        <div v-if="selected" class="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-xs">
          <template v-if="inspectorTab === 'fields'"><p class="mb-3 text-brand-text-muted">Los campos existentes son de solo lectura. Los cambios nuevos se guardan gratis.</p><div v-for="(field, index) in selected.fields" :key="`${selected.slug}-${index}`" class="mb-3 rounded-md border border-brand-border-light p-3" :class="fieldIsEditable(field) ? 'bg-brand-blue-bg/30' : 'bg-brand-bg/60'"><template v-if="fieldIsEditable(field) && session?.status !== 'applied'"><div class="flex items-center justify-between"><span class="font-bold text-brand-blue">{{ selected.action === 'create' ? 'Campo nuevo' : 'Se agrega' }}</span><button type="button" class="rounded p-1 text-brand-text-muted hover:bg-red-50 hover:text-red-700" :aria-label="`Quitar ${field.label}`" @click="removeField(index)"><Trash2 class="h-3.5 w-3.5" /></button></div><label class="mt-2 block font-semibold">Etiqueta<input v-model="field.label" class="mt-1 w-full rounded border border-brand-border-light bg-white px-2 py-1.5 outline-none focus:border-brand-blue" /></label><label class="mt-2 block font-semibold">Nombre técnico<input v-model="field.name" class="mt-1 w-full rounded border border-brand-border-light bg-white px-2 py-1.5 font-mono outline-none focus:border-brand-blue" /></label><label class="mt-2 block font-semibold">Tipo<select :value="field.dataType" class="mt-1 w-full rounded border border-brand-border-light bg-white px-2 py-1.5" @change="updateType(field, ($event.target as HTMLSelectElement).value)"><option v-for="type in fieldTypes" :key="type" :value="type">{{ designerFieldTypeLabel({ ...field, dataType: type, validationRules: {} }) }}</option></select></label><label v-if="field.dataType === 'relation'" class="mt-2 block font-semibold">Módulo destino<select v-model="field.validationRules!.relationEntity" class="mt-1 w-full rounded border border-brand-border-light bg-white px-2 py-1.5"><option v-for="module in working?.modules.filter(value => value.slug !== selected?.slug)" :key="module.slug" :value="module.slug">{{ module.name }}</option></select></label><label v-if="field.dataType === 'select' || field.dataType === 'multiselect'" class="mt-2 block font-semibold">Opciones (separadas por coma)<input :value="((field.validationRules?.options ?? []) as Array<{ label: string }>).map(item => item.label).join(', ')" class="mt-1 w-full rounded border border-brand-border-light bg-white px-2 py-1.5" @change="updateOptions(field, ($event.target as HTMLInputElement).value)" /></label><label class="mt-2 flex items-center gap-2"><input v-model="field.required" type="checkbox" class="accent-brand-blue" />Obligatorio</label><details class="mt-2"><summary class="cursor-pointer text-brand-blue">Reglas avanzadas (JSON)</summary><textarea :value="rulesDraft[`${selected.slug}.${field.name}`] ?? JSON.stringify(field.validationRules ?? {}, null, 2)" rows="4" class="mt-2 w-full rounded border border-brand-border-light bg-white p-2 font-mono text-[10px]" @change="updateRules(field, `${selected.slug}.${field.name}`, ($event.target as HTMLTextAreaElement).value)" /></details></template><template v-else><div class="flex items-center justify-between gap-2"><strong>{{ field.label }}<span v-if="field.required" class="text-brand-orange"> *</span></strong><span class="text-[10px] text-brand-text-muted">{{ editableTypeName(field) }}</span></div><code class="mt-1 block text-[10px] text-brand-text-muted">{{ field.name }}</code></template><p v-if="fieldError(working!.modules.findIndex(value => value.slug === selected?.slug), index)" role="alert" class="mt-2 text-[11px] text-red-700">{{ fieldError(working!.modules.findIndex(value => value.slug === selected?.slug), index) }}</p></div><button v-if="session?.status !== 'applied'" type="button" class="flex w-full items-center justify-center gap-1 rounded border border-brand-blue px-3 py-2 font-semibold text-brand-blue hover:bg-brand-blue-bg" @click="addField"><Plus class="h-4 w-4" />Agregar campo</button><button v-if="selected.action === 'create' && session?.status !== 'applied'" type="button" class="mt-4 flex w-full items-center justify-center gap-1 rounded border border-red-200 px-3 py-2 font-semibold text-red-700 hover:bg-red-50" @click="removeModule"><Trash2 class="h-4 w-4" />Quitar módulo nuevo</button></template>
          <template v-else-if="inspectorTab === 'relations'"><p v-if="!relatedEdges.length" class="text-brand-text-muted">Este módulo no tiene relaciones.</p><div v-for="edge in relatedEdges" :key="edge.id" class="mb-2 rounded border border-brand-border-light p-3"><div class="flex items-center justify-between"><strong>{{ graph?.modules.find(item => item.id === (edge.source === selectedId ? edge.target : edge.source))?.module.name }}</strong><span v-if="edge.state === 'new'" class="rounded bg-brand-orange/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-orange">Nueva</span></div><p class="mt-1 text-brand-text-secondary">{{ edge.label }}</p></div></template>
          <template v-else><p v-if="!selected.workflow" class="text-brand-text-muted">Este módulo no tiene estados definidos.</p><template v-else><div class="mb-4 flex flex-wrap items-center gap-2"><template v-for="(state, name) in selected.workflow.states" :key="name"><span class="rounded-full border px-3 py-1.5 font-semibold" :class="name === selected.workflow.initial ? 'border-brand-blue bg-brand-blue-bg text-brand-blue' : 'border-brand-border-light'">{{ name }}</span></template></div><div v-for="(transition, index) in selected.workflow.transitions" :key="index" class="mb-2 flex items-center gap-2 rounded border border-brand-border-light px-3 py-2"><span class="rounded-full border border-brand-border-light bg-brand-bg px-2 py-1">{{ transition.from }}</span><span class="text-brand-blue">→</span><strong class="rounded-full border border-brand-blue bg-brand-blue-bg px-2 py-1 text-brand-blue">{{ transition.to }}</strong><small class="ml-auto text-brand-text-muted">{{ transition.label || (transition.roles === 'all' ? 'Todos' : `${transition.roles.length} roles`) }}</small></div><div v-if="selected.workflow.rules?.length" class="mt-5"><strong class="text-[10px] uppercase tracking-wide text-brand-text-muted">Reglas</strong><p v-for="rule in selected.workflow.rules" :key="rule.message" class="mt-2 rounded bg-brand-bg p-2.5 leading-5">Para pasar a <b>{{ rule.when.to }}</b>: {{ rule.message }} <span class="font-semibold">{{ rule.mode === 'block' ? '· bloquea' : '· advierte' }}</span></p></div><p class="mt-4 text-[11px] text-brand-text-muted">Los estados son de solo lectura en esta fase.</p></template></template>
        </div><div v-else class="p-5 text-xs leading-5 text-brand-text-muted">Selecciona una caja del lienzo para revisar sus campos, relaciones y estados.</div>
      </aside>
      <aside v-if="explanationText" class="designer-explanation absolute inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-brand-border-light bg-brand-surface shadow-xl" aria-label="Explicación completa">
        <div class="flex items-center justify-between border-b border-brand-border-light px-5 py-4"><h2 class="text-sm font-bold">Explicación del diseño</h2><button type="button" class="rounded p-1.5 text-brand-text-muted hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" aria-label="Cerrar explicación" @click="explanationText = ''"><X class="h-4 w-4" /></button></div>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-6 text-sm leading-6"><MarkdownView :source="explanationText" /></div>
      </aside>
    </div>

    <div v-if="reviewOpen" class="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[8vh]" @keydown.esc="reviewOpen = false"><div role="dialog" aria-modal="true" aria-labelledby="review-title" class="w-full max-w-[600px] rounded-lg border border-brand-border-light bg-brand-surface shadow-2xl"><div class="flex items-center justify-between border-b border-brand-border-light px-5 py-4"><h2 id="review-title" class="text-base font-bold">Revisar y aprobar</h2><button type="button" aria-label="Cerrar" class="rounded p-1 hover:bg-brand-bg" @click="reviewOpen = false"><X class="h-4 w-4" /></button></div><div class="space-y-5 p-5 text-xs"><div><h3 class="mb-2 font-bold uppercase tracking-wide text-brand-text-muted">Resumen de cambios</h3><div class="grid grid-cols-2 gap-2 sm:grid-cols-3"><div v-for="item in changes" :key="item.label" class="rounded-md bg-brand-bg px-3 py-2"><b class="mr-1 text-base text-brand-text">{{ item.count }}</b>{{ item.label }}</div></div></div><p v-if="diff?.merges.length" class="rounded bg-brand-blue-bg p-3 text-brand-blue">Se reutilizaron módulos existentes: {{ diff.merges.map(item => item.to).join(', ') }}</p><div class="rounded-md bg-brand-bg p-4"><h3 class="mb-2 font-bold">Impacto en el plan</h3><p>{{ diff?.plan.name }}: {{ diff?.plan.used }} actuales + {{ diff?.plan.added }} nuevos = {{ diff?.plan.after }} / {{ diff?.plan.limit ?? 'sin límite' }} módulos.</p><p class="mt-1">Créditos usados en esta sesión: {{ session?.creditsConsumed ?? 0 }}. Aprobar no consume créditos adicionales.</p><p v-if="diff && !diff.plan.allowed" class="mt-3 font-semibold text-red-700">Se excede el límite del plan. Quita módulos nuevos o mejora tu plan.</p></div><div class="rounded-md bg-green-50 p-3 text-green-900"><CheckCircle2 class="mr-1 inline h-4 w-4" />No se borra ni renombra nada de la estructura existente.</div></div><div class="flex flex-wrap items-center justify-between gap-2 border-t border-brand-border-light px-5 py-4"><button type="button" class="rounded border border-brand-border-light px-3 py-2 text-xs font-semibold" @click="reviewOpen = false">Seguir editando</button><div class="flex gap-2"><button v-if="diff && !diff.plan.allowed" type="button" class="rounded border border-brand-blue px-3 py-2 text-xs font-semibold text-brand-blue" @click="reviewOpen = false">Quitar módulos</button><NuxtLink v-if="diff && !diff.plan.allowed" to="/ajustes?section=plan" class="inline-flex items-center gap-1 rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-white"><CreditCard class="h-3.5 w-3.5" />Mejorar plan</NuxtLink><button type="button" class="rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" :disabled="!canApprove" @click="approve"><LoaderCircle v-if="busy === 'apply'" class="mr-1 inline h-3.5 w-3.5 animate-spin" />Aprobar y crear</button></div></div></div></div>
  </div>
</template>

<style scoped>
.designer-chat { display: flex; width: var(--designer-chat-width, 360px); transition: width 180ms cubic-bezier(.25, 1, .5, 1); }
.designer-inspector { display: flex; width: var(--designer-inspector-width, 320px); }
.designer-workspace.is-focused > :not(.designer-chat) { visibility: hidden; pointer-events: none; }
.designer-workspace.is-focused > .designer-chat { display: flex; position: absolute; inset: 0; z-index: 60; width: 100%; height: 100%; border-right: 0; box-shadow: none; }
.designer-workspace.is-focused .designer-chat-scroll, .designer-workspace.is-focused .designer-composer { width: min(100%, 792px); margin-inline: auto; }
.designer-workspace.is-focused .designer-chat-scroll { padding-inline: 1rem; }
.designer-typing-dots { display: inline-flex; gap: 3px; align-items: center; }
.designer-typing-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: designer-typing 1.2s ease-in-out infinite; }
.designer-typing-dots i:nth-child(2) { animation-delay: 0.15s; }
.designer-typing-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes designer-typing { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .designer-typing-dots i { animation: none; opacity: 0.8; } .designer-chat { transition: none; } }
@media (min-width: 1025px) {
  .designer-mobile-control { display: none !important; }
}
@media (max-width: 1024px) {
  .designer-handle { display: none; }
  .designer-chat { display: none; position: absolute; z-index: 40; inset: 0 auto 0 0; width: min(360px, 90vw); box-shadow: 8px 0 24px #33475b25; }
  .designer-chat.is-open { display: flex; }
  .designer-inspector { display: none; position: absolute; z-index: 30; inset: auto 0 0 0; width: 100%; height: min(44vh, 360px); border-left: 0; border-top: 1px solid #dce5eb; box-shadow: 0 -4px 20px #33475b25; }
  .designer-inspector.is-open { display: flex; }
}
</style>

<script setup lang="ts">
import { StickyNote, Mail, Phone, CheckSquare, Plus, Pencil, Link, ArrowRight, Check, Smile, Bell, X, Globe2 } from '@lucide/vue'
import { resolveRecordText } from '~/utils/recordText'
import ReportOptionSelect from '~/components/ReportOptionSelect.vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

interface Activity {
  id: string
  actionType: string
  createdAt: string
  user: { id: string | null; name: string | null; email: string | null } | null
  details: {
    text?: string
    changes?: { field: string; old: unknown; new: unknown }[]
    formName?: string
    formKey?: string
    origin?: { domain?: string; path?: string; referrer?: string | null; utm?: Record<string, string>; capturedAt?: string }
  } | null
  mentions?: MentionProfile[]
}
interface MentionProfile { id: string; name: string | null; email: string | null; jobTitle: string | null; roleName: string | null }
interface TextSegment { text: string; mention?: MentionProfile }
const props = defineProps<{ entity: string; recordId: string; canUpdate?: boolean; fields?: EntityFieldMeta[]; highlightActivityId?: string; compact?: boolean }>()
const tabs = [
  { value: 'NOTE', label: 'Nota', icon: StickyNote },
  { value: 'EMAIL', label: 'Correo', icon: Mail },
  { value: 'CALL', label: 'Llamada', icon: Phone },
  { value: 'TASK', label: 'Tarea', icon: CheckSquare }
]
const activeTab = ref('NOTE')
const composerText = ref('')
const isSubmitting = ref(false)
const submitError = ref('')
const textarea = ref<{ insertText: (value: string) => Promise<void>; getMentions?: () => string[] }>()
const emojiOpen = ref(false)
const recipientOpen = ref(false)
const recipientLoading = ref(false)
const recipientOptions = ref<{ users: Array<{ id: string; label: string; email: string }>; roles: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }> }>({ users: [], roles: [], groups: [] })
const selectedRecipients = ref<Array<{ type: 'user' | 'role' | 'group'; id: string; label: string }>>([])
function closeRecipientPicker(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.notification-tool')) recipientOpen.value = false
}
onMounted(() => window.addEventListener('click', closeRecipientPicker))
onBeforeUnmount(() => window.removeEventListener('click', closeRecipientPicker))
const typeFilter = ref('')
const userFilter = ref('')
const limit = ref(12)
const now = useState('activity-clock', () => Date.now())
onMounted(() => { now.value = Date.now() })
const label = computed(() => tabs.find(tab => tab.value === activeTab.value)?.label.toLowerCase() ?? 'nota')
const placeholders: Record<string, string> = {
  NOTE: 'Escribe una nota…',
  EMAIL: 'Registra el contenido o resumen del correo…',
  CALL: 'Registra lo conversado en la llamada…',
  TASK: 'Describe la tarea…'
}
const endpoint = computed(() => `/api/records/${props.entity}/${props.recordId}/activities`)
const recipientSections = computed(() => [
  { type: 'user' as const, label: 'Usuarios', items: recipientOptions.value.users.map(item => ({ id: item.id, label: item.label })) },
  { type: 'role' as const, label: 'Roles', items: recipientOptions.value.roles.map(item => ({ id: item.id, label: item.name })) },
  { type: 'group' as const, label: 'Grupos', items: recipientOptions.value.groups.map(item => ({ id: item.id, label: item.name })) }
].filter(section => section.items.length))
async function toggleRecipientPicker() {
  recipientOpen.value = !recipientOpen.value
  if (!recipientOpen.value || recipientOptions.value.users.length || recipientLoading.value) return
  recipientLoading.value = true
  try { recipientOptions.value = await $fetch<{ users: Array<{ id: string; label: string; email: string }>; roles: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }> }>('/api/notifications/recipients') } catch { recipientOptions.value = { users: [], roles: [], groups: [] } }
  finally { recipientLoading.value = false }
}
function toggleRecipient(type: 'user' | 'role' | 'group', id: string, label: string) {
  const index = selectedRecipients.value.findIndex(item => item.type === type && item.id === id)
  if (index >= 0) selectedRecipients.value.splice(index, 1)
  else selectedRecipients.value.push({ type, id, label })
}
function hasRecipient(type: 'user' | 'role' | 'group', id: string) { return selectedRecipients.value.some(item => item.type === type && item.id === id) }
const { data, pending, error, refresh } = await useFetch<Activity[]>(endpoint, {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const activities = computed(() => data.value ?? [])
const typeOptions = [
  { value: '', label: 'Toda la actividad' },
  ...tabs.map(tab => ({ value: tab.value, label: tab.label })),
  { value: 'UPDATED', label: 'Actualizaciones' },
  { value: 'LINKED', label: 'Vinculaciones' },
  { value: 'FORM_SUBMISSION', label: 'Formularios' },
  { value: 'CREATED', label: 'Creaciones' }
]
const userOptions = computed(() => [
  { value: '', label: 'Todos los usuarios' },
  ...Array.from(new Map(activities.value.map(activity => [activity.user?.id ?? 'system', {
    value: activity.user?.id ?? 'system', label: activity.user?.name || activity.user?.email || 'Sistema'
  }])).values())
])
const filtered = computed(() => activities.value.filter(activity =>
  (!typeFilter.value || activity.actionType === typeFilter.value) &&
  (!userFilter.value || (activity.user?.id ?? 'system') === userFilter.value)
))
watch([typeFilter, userFilter], () => { limit.value = 12 })
const displayed = computed(() => filtered.value.slice(0, limit.value))
const highlightedId = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined
watch(activities, async value => {
  if (!import.meta.client) return
  if (!props.highlightActivityId || !value.some(activity => activity.id === props.highlightActivityId)) return
  await nextTick()
  const target = document.getElementById(`activity-${props.highlightActivityId}`)
  if (!target) return
  highlightedId.value = props.highlightActivityId
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => { highlightedId.value = null }, 5000)
}, { immediate: true })
onBeforeUnmount(() => { if (highlightTimer) clearTimeout(highlightTimer) })
const dateKey = (value: string | number) => new Date(value).toLocaleDateString('en-CA')
function dayLabel(value: string) {
  if (dateKey(value) === dateKey(now.value)) return 'HOY'
  const yesterday = new Date(now.value)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateKey(value) === dateKey(yesterday.getTime())) return 'AYER'
  return new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
}
function timestamp(value: string) {
  const minutes = Math.floor((now.value - new Date(value).getTime()) / 60000)
  if (minutes >= 0 && minutes < 1) return 'ahora'
  if (minutes >= 1 && minutes < 60) return `hace ${minutes} min`
  if (minutes >= 60 && minutes < 1440) return `hace ${Math.floor(minutes / 60)} h`
  return new Date(value).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}
const groups = computed(() => {
  const result: { key: string; label: string; events: Activity[] }[] = []
  for (const event of displayed.value) {
    const key = dateKey(event.createdAt)
    let group = result.find(group => group.key === key)
    if (!group) { group = { key, label: dayLabel(event.createdAt), events: [] }; result.push(group) }
    group.events.push(event)
  }
  return result
})
function config(type: string) {
  if (type === 'UPDATED') return { icon: Pencil, tone: 'updated', action: 'actualizó este registro' }
  if (type === 'LINKED') return { icon: Link, tone: 'linked', action: 'vinculó un registro' }
  if (type === 'FORM_SUBMISSION') return { icon: Globe2, tone: 'linked', action: 'capturó este registro desde Sites' }
  if (type === 'CREATED') return { icon: Plus, tone: 'created', action: 'creó este registro' }
  const actions: Record<string, string> = { NOTE: 'añadió una nota', EMAIL: 'registró un correo', CALL: 'registró una llamada', TASK: 'registró una tarea' }
  return { icon: tabs.find(tab => tab.value === type)?.icon ?? StickyNote, tone: 'manual', action: actions[type] ?? 'registró una actividad' }
}
function changes(activity: Activity) { return Array.isArray(activity.details?.changes) ? activity.details.changes : [] }
function campaign(activity: Activity) {
  const utm = activity.details?.origin?.utm
  return [utm?.source, utm?.medium, utm?.campaign].filter(Boolean).join(' · ')
}
function fieldMeta(name: string) { return props.fields?.find(field => field.name === name) }
function fieldLabel(name: string) { return fieldMeta(name)?.label ?? name }
function formatValue(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') return 'Vacío'
  const field = fieldMeta(fieldName)
  if (field?.dataType === 'file') return 'Archivo'
  if (field?.dataType === 'boolean' || typeof value === 'boolean') return value === true || value === 'true' ? 'Sí' : 'No'
  if (field?.dataType === 'date' && typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value)
    if (match) return `${match[3]}/${match[2]}/${match[1]}`
  }
  if (field?.dataType === 'datetime') {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
  }
  if (field?.dataType === 'currency') return formatCurrencyValue(value, field.validationRules)
  if (field?.dataType === 'select' || field?.dataType === 'multiselect') {
    const options = Array.isArray(field.validationRules?.options) ? field.validationRules.options as Array<{ value: string; label: string }> : []
    const optionLabel = (raw: unknown) => options.find(option => option.value === String(raw))?.label ?? String(raw)
    return Array.isArray(value) ? value.map(optionLabel).join(', ') : optionLabel(value)
  }
  if (typeof value === 'number') return value.toLocaleString('es-MX')
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function mentionSegments(activity: Activity): TextSegment[] {
  const text = activity.details?.text ?? ''
  const profiles = (activity.mentions ?? []).filter(profile => profile.name?.trim())
  if (!text || !profiles.length) return text ? [{ text }] : []
  const names = profiles.slice().sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0)).map(profile => escapeRegExp(profile.name!.trim()))
  const pattern = new RegExp(`@(${names.join('|')})(?=$|[\\s.,!?;:)])`, 'gi')
  const result: TextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) result.push({ text: text.slice(cursor, start) })
    const rawName = match[1] ?? ''
    const profile = profiles.find(item => item.name?.trim().toLocaleLowerCase() === rawName.toLocaleLowerCase())
    result.push({ text: profile?.name?.trim() ?? rawName, mention: profile })
    cursor = start + match[0].length
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  return result.length ? result : [{ text }]
}
async function insertEmoji(value: string) { await textarea.value?.insertText(value); emojiOpen.value = false }
async function submitActivity() {
  if (!props.canUpdate || !composerText.value.trim() || isSubmitting.value) return
  isSubmitting.value = true
  submitError.value = ''
  try {
    const resolvedText = await resolveRecordText(composerText.value.trim(), props.entity, props.recordId)
    await $fetch(endpoint.value, { method: 'POST', body: { actionType: activeTab.value, details: {
      text: resolvedText,
      mentions: textarea.value?.getMentions?.() ?? [],
      notifyUserIds: selectedRecipients.value.filter(item => item.type === 'user').map(item => item.id),
      notifyRoleIds: selectedRecipients.value.filter(item => item.type === 'role').map(item => item.id),
      notifyGroupIds: selectedRecipients.value.filter(item => item.type === 'group').map(item => item.id)
    } } })
    composerText.value = ''
    selectedRecipients.value = []; recipientOpen.value = false
    now.value = Date.now()
    await refresh()
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || err?.message || 'No se pudo guardar la actividad. Tu texto se conserva para volver a intentarlo.'
  } finally { isSubmitting.value = false }
}
</script>

<template>
  <section class="activity-panel" :class="{ 'is-compact': compact }" aria-label="Actividad del registro">
    <form v-if="canUpdate" class="activity-composer" @submit.prevent="submitActivity">
      <fieldset :disabled="isSubmitting">
        <div class="composer-segments">
          <div class="segment-control" role="group" aria-label="Tipo de actividad">
            <button v-for="tab in tabs" :key="tab.value" type="button" :aria-pressed="activeTab === tab.value" @click="activeTab = tab.value">
              <component :is="tab.icon" :size="14" :stroke-width="1.75" />{{ tab.label }}
            </button>
          </div>
        </div>
        <div class="composer-input">
          <VariableTextField ref="textarea" v-model="composerText" :entity="entity" :record-id="recordId" :label="'Contenido de ' + label" :placeholder="placeholders[activeTab]" :rows="3" @submit="submitActivity" />
        </div>
        <div class="composer-footer">
          <div class="composer-tools">
          <div class="emoji-tool" @keydown.esc.stop="emojiOpen = false">
            <button type="button" aria-label="Insertar emoji" title="Insertar emoji" :aria-expanded="emojiOpen" class="tool-button" @click="emojiOpen = !emojiOpen"><Smile :size="16" /></button>
            <div v-if="emojiOpen" class="emoji-options" role="group" aria-label="Emojis">
              <button v-for="emoji in ['👍', '✅', '📌', '⚠️', '🙂']" :key="emoji" type="button" :aria-label="'Insertar ' + emoji" @click="insertEmoji(emoji)">{{ emoji }}</button>
            </div>
          </div>
          <div class="notification-tool">
            <button type="button" class="notify-button" :aria-expanded="recipientOpen" @click.stop="toggleRecipientPicker"><Bell :size="15" />Notificar<span v-if="selectedRecipients.length" class="notify-count">{{ selectedRecipients.length }}</span></button>
            <div v-if="recipientOpen" class="recipient-menu" role="dialog" aria-label="Seleccionar destinatarios" @click.stop>
              <header><strong>Notificar a</strong><button type="button" aria-label="Cerrar destinatarios" @click="recipientOpen = false"><X :size="15" /></button></header>
              <p class="recipient-help">Elige usuarios, roles o grupos que recibirán un aviso con el enlace al registro.</p>
              <p v-if="recipientLoading" class="recipient-empty">Cargando destinatarios…</p>
              <div v-else-if="!recipientSections.length" class="recipient-empty">No hay destinatarios disponibles.</div>
              <section v-for="section in recipientSections" v-else :key="section.type">
                <h4>{{ section.label }}</h4>
                <button v-for="item in section.items" :key="item.id" type="button" class="recipient-option" :aria-pressed="hasRecipient(section.type, item.id)" @click="toggleRecipient(section.type, item.id, item.label)"><span>{{ item.label }}</span><Check v-if="hasRecipient(section.type, item.id)" :size="14" /></button>
              </section>
              <footer><button type="button" @click="recipientOpen = false">Listo</button></footer>
            </div>
          </div>
          </div>
          <button type="submit" class="save-activity" :disabled="!composerText.trim() || isSubmitting"><Check :size="16" />{{ isSubmitting ? 'Guardando…' : 'Guardar ' + label }}</button>
        </div>
        <div v-if="selectedRecipients.length" class="selected-recipients" aria-label="Destinatarios seleccionados"><span v-for="recipient in selectedRecipients" :key="recipient.type + recipient.id" class="recipient-chip">{{ recipient.label }}<button type="button" :aria-label="'Quitar ' + recipient.label" @click="toggleRecipient(recipient.type, recipient.id, recipient.label)"><X :size="12" /></button></span></div>
        <p v-if="activeTab !== 'NOTE'" class="composer-hint">Se guarda en el historial del registro{{ activeTab === 'EMAIL' ? '; no envía un correo' : '' }}.</p>
      </fieldset>
      <p v-if="submitError" role="alert" class="activity-error">{{ submitError }}</p>
    </form>
    <div class="activity-filters">
      <div class="filter-selectors">
        <ReportOptionSelect v-model="typeFilter" label="Tipo de actividad" :options="typeOptions" />
        <ReportOptionSelect v-model="userFilter" label="Usuario" :options="userOptions" />
      </div>
      <span v-if="!pending && !error" class="event-count" aria-live="polite">{{ displayed.length }} de {{ filtered.length }} eventos</span>
    </div>
    <div v-if="pending" class="activity-loading" role="status" aria-label="Cargando actividad"><div v-for="i in 3" :key="i" class="loading-row" />Cargando actividad…</div>
    <div v-else-if="error" class="activity-error" role="alert">No se pudo cargar la actividad. <button type="button" @click="refresh()">Reintentar</button></div>
    <p v-else-if="!filtered.length" class="activity-empty">{{ activities.length ? 'No hay eventos con estos filtros.' : 'Todavía no hay actividad registrada.' }}</p>
    <div v-else class="activity-timeline">
      <section v-for="group in groups" :key="group.key" class="day-group" :aria-label="group.label">
        <h3>{{ group.label }}</h3>
        <ol>
          <li v-for="activity in group.events" :key="activity.id" class="activity-entry">
            <span class="event-dot" :class="config(activity.actionType).tone"><component :is="config(activity.actionType).icon" :size="15" :stroke-width="1.75" /></span>
            <article :id="`activity-${activity.id}`" class="event-card" :class="{ 'is-highlighted': highlightedId === activity.id }">
              <header>
                <div class="event-heading"><strong>{{ activity.user?.name || activity.user?.email || 'Sistema' }}</strong><span>{{ config(activity.actionType).action }}</span></div>
                <time :datetime="activity.createdAt" :title="new Date(activity.createdAt).toLocaleString('es-MX')">{{ timestamp(activity.createdAt) }}</time>
              </header>
              <p v-if="activity.details?.text" class="event-text">
                <template v-for="(segment, index) in mentionSegments(activity)" :key="index">
                  <span v-if="segment.mention" class="mention-wrap">
                    <button type="button" class="activity-mention" :aria-label="`Mención a ${segment.mention.name}`">{{ segment.text }}</button>
                    <span class="mention-popover" role="tooltip">
                      <strong>{{ segment.mention.name || segment.mention.email }}</strong>
                      <small>{{ segment.mention.jobTitle || 'Sin puesto' }} · {{ segment.mention.roleName || 'Sin rol' }}</small>
                    </span>
                  </span>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </p>
              <dl v-if="activity.actionType === 'FORM_SUBMISSION'" class="form-origin">
                <div><dt>Formulario</dt><dd>{{ activity.details?.formName || activity.details?.formKey || 'Formulario web' }}</dd></div>
                <div v-if="activity.details?.origin?.domain"><dt>Página</dt><dd>{{ activity.details.origin.domain }}{{ activity.details.origin.path || '/' }}</dd></div>
                <div v-if="campaign(activity)"><dt>Campaña</dt><dd>{{ campaign(activity) }}</dd></div>
              </dl>
              <dl v-if="activity.actionType === 'UPDATED' && changes(activity).length" class="event-changes">
                <div v-for="(change, index) in changes(activity)" :key="index" class="change-row">
                  <dt>{{ fieldLabel(change.field) }}</dt>
                  <dd>
                    <DynamicFileValue v-if="fieldMeta(change.field)?.dataType === 'file' && typeof change.old === 'string'" :file-id="change.old" compact />
                    <span v-else class="old-value">{{ formatValue(change.old, change.field) }}</span>
                    <ArrowRight :size="14" aria-label="cambió a" />
                    <DynamicFileValue v-if="fieldMeta(change.field)?.dataType === 'file' && typeof change.new === 'string'" :file-id="change.new" compact />
                    <strong v-else>{{ formatValue(change.new, change.field) }}</strong>
                  </dd>
                </div>
              </dl>
            </article>
          </li>
        </ol>
      </section>
      <button v-if="displayed.length < filtered.length" type="button" class="load-more" @click="limit += 12">Ver más actividad</button>
    </div>
  </section>
</template>

<style scoped>
.activity-panel { display:flex; flex-direction:column; gap:16px; width:100%; color:#33475B; }
.activity-composer,.event-card { background:#fff; border:1px solid #E5EAF0; border-radius:8px; box-shadow:0 1px 3px #33475B14; }
.activity-composer fieldset { min-width:0; }
.composer-segments { padding:12px 14px 10px; overflow-x:auto; }
.segment-control { display:inline-flex; border:1px solid #CBD6E2; border-radius:4px; overflow:hidden; }
.segment-control button { display:flex; align-items:center; gap:6px; padding:7px 13px; color:#516F90; font-size:13px; white-space:nowrap; }
.segment-control button + button { border-left:1px solid #CBD6E2; }
.segment-control button svg { color:#8DA1B5; }
.segment-control button[aria-pressed=true] { background:#EAF3F6; color:#0091AE; font-weight:700; }
.segment-control button[aria-pressed=true] svg { color:#0091AE; }
.segment-control button:hover { background:#F5F8FA; }
.composer-input { padding:0 14px; }
textarea { display:block; width:100%; min-height:78px; resize:vertical; border:1px solid #CBD6E2; border-radius:4px; padding:10px 12px; font-size:14px; line-height:1.5; background:#fff; }
textarea::placeholder { color:#8DA1B5; }
textarea:focus { outline:1px solid #FF7A59; border-color:#FF7A59; }
.composer-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 14px 12px; }
.composer-tools { display:flex; align-items:center; gap:8px; }
.tool-button { padding:4px; border-radius:4px; color:#8DA1B5; }
.tool-button:hover { background:#F5F8FA; color:#516F90; }
.emoji-tool { position:relative; }
.emoji-options { position:absolute; top:100%; left:0; z-index:20; display:flex; gap:4px; border:1px solid #CBD6E2; border-radius:6px; background:#fff; padding:6px; box-shadow:0 4px 12px #33475B14; }
.emoji-options button { padding:4px; }
.notification-tool { position:relative; }
.notify-button { display:flex; align-items:center; gap:5px; border:1px solid #CBD6E2; border-radius:4px; padding:6px 9px; color:#516F90; font-size:12px; font-weight:600; }
.notify-button:hover { background:#F5F8FA; color:#0091AE; }
.notify-count { display:inline-flex; min-width:16px; height:16px; align-items:center; justify-content:center; border-radius:999px; background:#EAF3F6; color:#0091AE; font-size:10px; }
.recipient-menu { position:absolute; bottom:calc(100% + 8px); left:0; z-index:30; width:280px; max-height:360px; overflow:auto; border:1px solid #CBD6E2; border-radius:8px; background:#fff; box-shadow:0 6px 20px #33475B20; }
.recipient-menu header { display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #E5EAF0; padding:11px 12px; font-size:13px; }
.recipient-menu header button { color:#8DA1B5; }
.recipient-help { padding:9px 12px; color:#8DA1B5; font-size:11px; line-height:1.45; }
.recipient-menu section { border-top:1px solid #E5EAF0; padding:7px 8px; }
.recipient-menu h4 { padding:3px 5px 5px; color:#8DA1B5; font-size:10px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; }
.recipient-option { display:flex; width:100%; align-items:center; justify-content:space-between; gap:8px; border-radius:4px; padding:7px 6px; color:#516F90; font-size:12px; text-align:left; }
.recipient-option:hover,.recipient-option[aria-pressed=true] { background:#EAF3F6; color:#0091AE; }
.recipient-option svg { color:#0091AE; }
.recipient-empty { padding:12px; color:#8DA1B5; font-size:12px; }
.recipient-menu footer { border-top:1px solid #E5EAF0; padding:8px 12px; text-align:right; }
.recipient-menu footer button { color:#0091AE; font-size:12px; font-weight:600; }
.selected-recipients { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 10px; }
.recipient-chip { display:inline-flex; align-items:center; gap:4px; border-radius:999px; background:#EAF3F6; padding:4px 7px 4px 9px; color:#516F90; font-size:11px; }
.recipient-chip button { color:#8DA1B5; }
.save-activity { display:flex; align-items:center; gap:6px; background:#FF7A59; border-radius:4px; padding:9px 16px; color:#fff; font-size:14px; font-weight:600; }
.save-activity:hover { background:#E66E50; }
button:disabled { opacity:.5; cursor:not-allowed; }
button:focus-visible { outline:2px solid #FF7A59; outline-offset:2px; }
.composer-hint { padding:0 14px 12px; font-size:12px; color:#8DA1B5; }
.activity-filters,.filter-selectors { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.activity-filters { justify-content:space-between; }
.filter-selectors :deep(.report-option-label) { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.filter-selectors :deep(.report-option-trigger) { min-height:28px; padding:6px 10px; gap:8px; border-radius:4px; font-size:12px; }
.filter-selectors :deep(.report-option-menu) { max-height:280px; overflow-y:auto; }
.event-count { font-size:12px; color:#8DA1B5; white-space:nowrap; }
.activity-timeline,.day-group,.day-group ol { display:flex; flex-direction:column; gap:10px; }
.day-group h3 { font-size:11px; font-weight:700; letter-spacing:.6px; color:#8DA1B5; }
.activity-entry { display:flex; align-items:flex-start; gap:12px; }
.event-dot { display:flex; width:30px; height:30px; flex-shrink:0; align-items:center; justify-content:center; border-radius:50%; }
.event-dot.manual { background:#EAF3F6; color:#0091AE; }
.event-dot.updated { background:#FEF0D2; color:#B3720A; }
.event-dot.linked { background:#CCF1DE; color:#0A7A4F; }
.event-dot.created { background:#EAF0F6; color:#516F90; }
.event-card { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; padding:12px 14px; font-size:13px; }
.event-card.is-highlighted { border-color:#0091AE; box-shadow:0 0 0 2px #0091AE33, 0 4px 14px #33475B18; transition:border-color .2s ease, box-shadow .2s ease; }
.event-card header { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.event-heading { display:flex; flex-wrap:wrap; gap:4px 6px; color:#516F90; overflow-wrap:anywhere; }
.event-heading strong { color:#33475B; font-weight:700; }
.event-card time { flex-shrink:0; font-size:12px; color:#8DA1B5; }
.event-text { line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.mention-wrap { position:relative; display:inline; }
.activity-mention { margin:0; padding:0; border:0; background:transparent; color:#0091AE; font:inherit; font-weight:600; cursor:pointer; }
.activity-mention:hover,.activity-mention:focus-visible { color:#007A91; text-decoration:underline; outline:none; }
.mention-popover { position:absolute; left:50%; bottom:calc(100% + 8px); z-index:25; display:flex; min-width:190px; max-width:250px; transform:translateX(-50%); flex-direction:column; gap:3px; border:1px solid #CBD6E2; border-radius:6px; background:#fff; padding:9px 11px; box-shadow:0 5px 16px #33475B26; color:#33475B; opacity:0; pointer-events:none; transition:opacity .12s ease, transform .12s ease; }
.mention-popover::after { position:absolute; left:50%; bottom:-5px; width:8px; height:8px; transform:translateX(-50%) rotate(45deg); border-right:1px solid #CBD6E2; border-bottom:1px solid #CBD6E2; background:#fff; content:''; }
.mention-popover strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
.mention-popover small { color:#8DA1B5; font-size:11px; line-height:1.35; }
.mention-wrap:hover .mention-popover,.activity-mention:focus-visible + .mention-popover { transform:translate(-50%, -2px); opacity:1; }
.event-changes { display:flex; flex-direction:column; gap:8px; }
.change-row { display:flex; flex-wrap:wrap; gap:6px 12px; }
.change-row dt { color:#516F90; }
.change-row dd { display:flex; align-items:center; flex-wrap:wrap; gap:10px; overflow-wrap:anywhere; min-width:0; }
.change-row dd svg,.old-value { color:#8DA1B5; }
.change-row dd svg { flex-shrink:0; }
.activity-error { padding:12px 14px; font-size:13px; color:#B42318; }
.activity-error button { text-decoration:underline; }
.activity-empty { padding:24px 14px; text-align:center; font-size:13px; color:#8DA1B5; }
.activity-loading { display:flex; flex-direction:column; gap:12px; font-size:12px; color:#8DA1B5; }
.loading-row { height:68px; border:1px solid #E5EAF0; border-radius:8px; background:#EAF0F6; }
.load-more { align-self:center; padding:8px 12px; color:#0091AE; font-size:13px; font-weight:600; }
@media(max-width:480px) { .segment-control button { padding:7px 9px; } .event-card { padding:10px; } .activity-entry { gap:8px; } }
.form-origin{display:grid;gap:7px;margin-top:10px;border:1px solid #dbe8ec;border-radius:6px;background:#f5fafb;padding:10px 12px}.form-origin>div{display:grid;grid-template-columns:82px minmax(0,1fr);gap:10px}.form-origin dt{color:#8da1b5;font-size:10px;font-weight:700;text-transform:uppercase}.form-origin dd{overflow:hidden;margin:0;color:#33475b;font-size:12px;text-overflow:ellipsis;white-space:nowrap}

.activity-panel.is-compact { gap:16px; padding:24px; }
.is-compact .activity-timeline,
.is-compact .day-group,
.is-compact .day-group ol { gap:0; }
.is-compact .day-group + .day-group { margin-top:16px; }
.is-compact .day-group h3 { margin:0 0 10px 38px; font-size:10px; }
.is-compact .activity-entry { position:relative; gap:12px; }
.is-compact .activity-entry:not(:last-child)::before {
  position:absolute;
  top:26px;
  bottom:0;
  left:12px;
  width:2px;
  background:#E5EAF0;
  content:'';
}
.is-compact .event-dot {
  position:relative;
  z-index:1;
  width:26px;
  height:26px;
  background:#EAF3F6 !important;
  color:#0091AE !important;
}
.is-compact .event-card {
  gap:4px;
  border:0;
  border-radius:0;
  box-shadow:none;
  padding:3px 0 20px;
}
.is-compact .event-card.is-highlighted {
  border-radius:6px;
  box-shadow:0 0 0 2px #0091AE33;
}
.is-compact .event-heading { font-size:13px; }
.is-compact .event-card time { font-size:12px; }
</style>


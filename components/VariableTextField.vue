<script setup lang="ts">
import type { EntityFieldMeta } from '~/composables/useEntityFields'
const props = defineProps<{ modelValue: string; entity: string; recordId?: string; label: string; placeholder?: string; rows?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [] }>()
const input = ref<HTMLTextAreaElement>()
const themeSource = ref<HTMLElement>()
const open = ref(false)
const mentionOpen = ref(false)
const query = ref('')
const mentionQuery = ref('')
const selected = ref(0)
const mentionSelected = ref(0)
const loading = ref(false)
const error = ref('')
const start = ref(0)
const end = ref(0)
const mentionStart = ref(0)
const mentionEnd = ref(0)
const mentionUsers = ref<Array<{ id: string; label: string; email: string }>>([])
const selectedMentions = ref<Array<{ id: string; label: string }>>([])
const popupStyle = ref<Record<string, string>>({})
watch(() => props.modelValue, value => { if (!value) selectedMentions.value = [] })
function positionPopup() {
  const element = input.value
  const anchor = open.value ? start.value : mentionStart.value
  if ((!open.value && !mentionOpen.value) || !element) return
  // A mirror preserves wrapping, spaces and font metrics at the opening braces.
  const style = getComputedStyle(element)
  const mirror = document.createElement('div')
  for (const property of ['box-sizing','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-indent','text-transform','tab-size','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width']) {
    mirror.style.setProperty(property, style.getPropertyValue(property))
  }
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0', width: `${element.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid' })
  mirror.textContent = element.value.slice(0, anchor)
  const marker = document.createElement('span')
  marker.textContent = element.value.slice(anchor) || '\u200b'
  mirror.append(marker); document.body.append(mirror)
  const line = marker.getClientRects()[0]!
  const rect = element.getBoundingClientRect()
  const x = rect.left + line.left - element.scrollLeft
  const y = rect.top + line.top - element.scrollTop + (parseFloat(style.lineHeight) || 21)
  mirror.remove()
  const width = Math.min(340, window.innerWidth - 24)
  const top = Math.max(12, Math.min(y + 4, window.innerHeight - 100))
  popupStyle.value = { left: `${Math.max(12, Math.min(x, window.innerWidth - width - 12))}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.max(80, window.innerHeight - top - 12)}px` }
}
watch([open, mentionOpen, start, mentionStart, () => props.modelValue], () => nextTick(positionPopup))
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  window.addEventListener('scroll', positionPopup, true)
  window.addEventListener('resize', positionPopup)
  resizeObserver = new ResizeObserver(positionPopup)
  if (input.value) resizeObserver.observe(input.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', positionPopup, true)
  window.removeEventListener('resize', positionPopup)
  resizeObserver?.disconnect()
})
const path = ref<Array<{ name: string; label: string; entity: string; recordId?: string }>>([])
const fields = ref<EntityFieldMeta[]>([])
const values = ref<Record<string, unknown>>({})
let request = 0
const options = computed(() => fields.value.filter(f => f.name !== 'id' && !['table','file','multiselect'].includes(f.dataType) && f.label.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
async function load() {
  const ticket = ++request
  loading.value = true; error.value = ''; fields.value = []; selected.value = 0
  const current = path.value.at(-1)
  const slug = current?.entity ?? props.entity
  const id = current?.recordId ?? (path.value.length ? undefined : props.recordId)
  try {
    const meta = await $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${slug}/fields`)
    const record = props.recordId && id ? await $fetch<{ customData: Record<string, unknown> }>(`/api/records/${slug}/${id}`) : null
    if (ticket !== request) return
    fields.value = meta.fields; values.value = record?.customData ?? {}
  } catch { if (ticket === request) error.value = 'No se pudieron consultar estos campos. Revisa tus permisos o vuelve a intentar.' }
  finally { if (ticket === request) loading.value = false }
}
function begin() {
  start.value = input.value?.selectionStart ?? props.modelValue.length
  end.value = input.value?.selectionEnd ?? start.value
  query.value = ''; path.value = []; mentionOpen.value = false; open.value = true; void load()
}
async function loadMentionUsers() {
  if (mentionUsers.value.length) return
  try {
    const response = await $fetch<{ users: Array<{ id: string; label: string; email: string }> }>('/api/notifications/recipients')
    mentionUsers.value = response.users
  } catch { mentionUsers.value = [] }
}
const mentionOptions = computed(() => mentionUsers.value.filter(user => user.label.toLocaleLowerCase().includes(mentionQuery.value.toLocaleLowerCase()) || user.email.toLocaleLowerCase().includes(mentionQuery.value.toLocaleLowerCase())))
function change(event: Event) {
  const element = event.target as HTMLTextAreaElement
  emit('update:modelValue', element.value)
  selectedMentions.value = selectedMentions.value.filter(mention => element.value.includes(`@${mention.label}`))
  const caret = element.selectionStart
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(element.value.slice(0, caret))
  if (mentionMatch) {
    const leading = mentionMatch[0].startsWith(' ') ? 1 : 0
    mentionStart.value = caret - mentionMatch[0].length + leading
    mentionEnd.value = caret
    mentionQuery.value = mentionMatch[1]; mentionSelected.value = 0; open.value = false
    if (!mentionOpen.value) { mentionOpen.value = true; void loadMentionUsers() }
    return
  }
  mentionOpen.value = false
  const match = /\{\{([^{}]*)$/.exec(element.value.slice(0, caret))
  if (!match) { open.value = false; return }
  start.value = caret - match[0].length; end.value = caret
  query.value = match[1]; selected.value = 0
  if (!open.value) { path.value = []; open.value = true; void load() }
}
function chooseMention(user: { id: string; label: string }) {
  const value = `@${user.label} `
  emit('update:modelValue', props.modelValue.slice(0, mentionStart.value) + value + props.modelValue.slice(mentionEnd.value))
  if (!selectedMentions.value.some(mention => mention.id === user.id)) selectedMentions.value.push(user)
  mentionOpen.value = false
  nextTick(() => { input.value?.focus(); const caret = mentionStart.value + value.length; input.value?.setSelectionRange(caret, caret) })
}
async function choose(field: EntityFieldMeta) {
  if (field.dataType === 'relation') {
    const slug = field.validationRules?.relationEntity
    if (typeof slug !== 'string' || !slug) { error.value = 'Esta relación no tiene un módulo configurado.'; return }
    if (path.value.length >= 3) { error.value = 'Puedes explorar hasta tres relaciones.'; return }
    const id = values.value[field.name]
    if (props.recordId && !id) { error.value = 'Este registro no tiene un valor para esa relación.'; return }
    path.value.push({ name: field.name, label: field.label, entity: slug, recordId: typeof id === 'string' ? id : undefined })
    query.value = ''; await load(); return
  }
  const raw = values.value[field.name]
  if (props.recordId && (raw === undefined || raw === null || raw === '')) { error.value = 'Este campo está vacío. Selecciona otro dato o completa el registro.'; return }
  const value = props.recordId ? (typeof raw === 'boolean' ? raw ? 'Sí' : 'No' : String(raw)) : '{{' + [...path.value.map(p => p.name), field.name].join('.') + '}}'
  emit('update:modelValue', props.modelValue.slice(0, start.value) + value + props.modelValue.slice(end.value))
  open.value = false
  await nextTick(); input.value?.focus(); input.value?.setSelectionRange(start.value + value.length, start.value + value.length)
}
function key(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); emit('submit'); return }
  if (mentionOpen.value) {
    if (event.key === 'Escape') { event.preventDefault(); mentionOpen.value = false }
    if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); mentionSelected.value = Math.max(0, Math.min(mentionOptions.value.length - 1, mentionSelected.value + (event.key === 'ArrowDown' ? 1 : -1))) }
    if (event.key === 'Enter' && mentionOptions.value[mentionSelected.value]) { event.preventDefault(); chooseMention(mentionOptions.value[mentionSelected.value]) }
    return
  }
  if (!open.value) return
  if (event.key === 'Escape') { event.preventDefault(); open.value = false }
  if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); selected.value = Math.max(0, Math.min(options.value.length - 1, selected.value + (event.key === 'ArrowDown' ? 1 : -1))) }
  if (event.key === 'Enter' && options.value[selected.value]) { event.preventDefault(); void choose(options.value[selected.value]) }
}
async function back() { path.value.pop(); query.value = ''; await load() }
defineExpose({
  insertText: async (value: string) => { begin(); open.value = false; emit('update:modelValue', props.modelValue.slice(0,start.value) + value + props.modelValue.slice(end.value)); await nextTick(); input.value?.focus() },
  getMentions: () => selectedMentions.value.map(mention => mention.id)
})
</script>

<template>
  <div ref="themeSource" class="variable-field" @keydown="key">
    <textarea ref="input" :aria-label="label" :placeholder="placeholder" :rows="rows ?? 3" :value="modelValue" :aria-expanded="open || mentionOpen" aria-autocomplete="list" @input="change" />
    <button type="button" class="insert-variable" @click="begin">＋ Insertar dato</button>
    <Teleport to="body">
    <div v-if="open" class="variable-menu" :class="{ 'theme-light': !!themeSource?.closest('.theme-light') }" :style="popupStyle" @keydown="key">
      <div class="variable-heading"><strong>{{ path.length ? path.map(p => p.label).join(' › ') : 'Datos del registro' }}</strong><button type="button" aria-label="Cerrar variables" @click="open = false">×</button></div>
      <button v-if="path.length" type="button" class="variable-back" @click="back">← Volver</button>
      <input v-model="query" aria-label="Buscar variable" placeholder="Buscar campo…" @input="selected = 0" />
      <p v-if="loading" role="status">Cargando campos…</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <div v-else role="listbox" aria-label="Variables disponibles" class="variable-options">
        <button v-for="(field,index) in options" :key="field.id" type="button" role="option" :aria-selected="selected === index" @click="choose(field)"><span>{{ field.label }}</span><small>{{ field.dataType === 'relation' ? 'Explorar relación →' : field.dataType === 'boolean' ? 'Sí / No' : field.dataType === 'date' ? 'Fecha' : field.dataType === 'currency' ? 'Monto' : field.dataType === 'number' ? 'Número' : 'Texto' }}</small></button>
        <p v-if="!options.length">No hay campos disponibles.</p>
      </div>
      <small class="variable-help">{{ recordId ? 'Se insertará el valor actual y quedará guardado en el texto.' : 'El dato se sustituirá al ejecutar la automatización.' }}</small>
    </div>
      <div v-if="mentionOpen" class="variable-menu mention-menu" :class="{ 'theme-light': !!themeSource?.closest('.theme-light') }" :style="popupStyle" @keydown="key">
        <div class="variable-heading"><strong>Mencionar usuario</strong><button type="button" aria-label="Cerrar menciones" @click="mentionOpen = false">×</button></div>
        <input v-model="mentionQuery" aria-label="Buscar usuario" placeholder="Buscar usuario…" @input="mentionSelected = 0" />
        <div role="listbox" aria-label="Usuarios disponibles" class="variable-options">
          <button v-for="(user,index) in mentionOptions" :key="user.id" type="button" role="option" :aria-selected="mentionSelected === index" @click="chooseMention(user)"><span>{{ user.label }}</span><small>{{ user.email }}</small></button>
          <p v-if="!mentionOptions.length">No hay usuarios disponibles.</p>
        </div>
        <small class="variable-help">Escribe @ seguido del nombre para notificarle.</small>
      </div>
    </Teleport>
  </div>
</template>
<style scoped>
.variable-field{position:relative;width:100%}textarea{display:block;width:100%;resize:vertical;padding:10px 12px;border:1px solid rgb(var(--brand-border));border-radius:4px;background:rgb(var(--brand-surface));color:rgb(var(--brand-text));font-size:14px;line-height:1.5}textarea:focus,input:focus{outline:1px solid rgb(var(--brand-blue))}.insert-variable,.variable-back{font-size:12px;color:rgb(var(--brand-blue));padding:6px 0}.variable-menu{position:fixed;overflow-y:auto;z-index:1000;background:rgb(var(--brand-surface));border:1px solid rgb(var(--brand-border));border-radius:8px;box-shadow:0 6px 20px rgb(var(--brand-shadow) / .12549019607843137);padding:12px;color:rgb(var(--brand-text))}.variable-heading{display:flex;align-items:center;justify-content:space-between;font-size:13px;gap:8px}.variable-heading button{font-size:22px}.variable-menu input{background:rgb(var(--brand-surface));color:rgb(var(--brand-text));width:100%;border:1px solid rgb(var(--brand-border));border-radius:4px;padding:7px 10px;margin:8px 0;font-size:13px}.variable-options{max-height:220px;overflow:auto}.variable-options button{display:flex;width:100%;text-align:left;justify-content:space-between;gap:10px;padding:9px 8px;font-size:13px;border-radius:4px}.variable-options button:hover,.variable-options button[aria-selected=true]{background:rgb(var(--brand-blue-bg))}.variable-options small,.variable-help{color:rgb(var(--brand-text-secondary));font-size:11px}.variable-help{display:block;border-top:1px solid rgb(var(--brand-border-light));padding-top:9px;margin-top:8px}.variable-menu p{font-size:12px;padding:10px 0}
</style>

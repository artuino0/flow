<script setup lang="ts">
import { Archive, ArrowLeft, Check, CheckCheck, Download, FileText, LoaderCircle, MoreHorizontal, Paperclip, Pencil, Reply, Send, Smile, Trash2, Users, X } from '@lucide/vue'
import type { ChatAttachment, ChatConversation, ChatMessage, ChatPerson } from '~/utils/chat'

const props = withDefaults(defineProps<{
  conversation: ChatConversation
  messages: ChatMessage[]
  currentUserId: string
  canAttach: boolean
  compact?: boolean
  loading?: boolean
  typingUserIds?: string[]
  users?: ChatPerson[]
  presence?: Record<string, boolean>
}>(), { typingUserIds: () => [], users: () => [], presence: () => ({}) })
const emit = defineEmits<{
  back: []; archive: []; float: []; manage: []; send: [body: string, replyToMessageId: string | null, attachmentIds: string[]]
  edit: [id: string, body: string]; delete: [id: string]; typing: [active: boolean]; loadOlder: []
  upload: [file: File, done: (attachment?: ChatAttachment) => void]
}>()

const body = ref('')
const replyTo = ref<ChatMessage | null>(null)
const editing = ref<ChatMessage | null>(null)
const attachments = ref<ChatAttachment[]>([])
const uploading = ref(false)
const menuOpen = ref(false)
const messageMenuId = ref<string | null>(null)
const deleteTarget = ref<ChatMessage | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const list = ref<HTMLElement | null>(null)
const mentionOpen = ref(false)
const mentionQuery = ref('')
const emojiOpen = ref(false)
const emojiContainer = ref<HTMLElement | null>(null)
const professionalEmojis = ['👍', '✅', '👏', '🙌', '🤝', '👀', '🚀', '💡', '📌', '📅', '🙂', '😊', '😉']
let typingTimer: ReturnType<typeof setTimeout> | null = null

const other = computed(() => props.conversation.type === 'direct' ? props.conversation.participants.find(person => person.id !== props.currentUserId) : null)
const online = computed(() => Boolean(other.value && props.presence[other.value.id]))
const typingNames = computed(() => props.typingUserIds.map(id => props.conversation.participants.find(person => person.id === id)?.name).filter(Boolean))
const mentionOptions = computed(() => {
  const term = mentionQuery.value.toLowerCase()
  return props.users.filter(user => user.id !== props.currentUserId && (!term || `${user.name} ${user.email}`.toLowerCase().includes(term))).slice(0, 6)
})

function closeEmojiPopup(event: Event) {
  if (!emojiOpen.value) return
  const target = event.target
  if (target instanceof Node && !emojiContainer.value?.contains(target)) emojiOpen.value = false
}

watch(() => props.messages.length, async () => { await nextTick(); if (list.value) list.value.scrollTop = list.value.scrollHeight })
onMounted(() => { 
  if (list.value) list.value.scrollTop = list.value.scrollHeight 
  document.addEventListener('pointerdown', closeEmojiPopup)
})
onBeforeUnmount(() => { 
  if (typingTimer) clearTimeout(typingTimer); emit('typing', false) 
  document.removeEventListener('pointerdown', closeEmojiPopup)
})

function time(value: string) { return new Date(value).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) }
function dateLabel(value: string) {
  const date = new Date(value); const today = new Date(); const yesterday = new Date(Date.now() - 86400000)
  if (date.toDateString() === today.toDateString()) return 'Hoy'
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer'
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}
function showDate(index: number) { return index === 0 || new Date(props.messages[index - 1].createdAt).toDateString() !== new Date(props.messages[index].createdAt).toDateString() }

function onInput() {
  emit('typing', true)
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(() => emit('typing', false), 1200)
  const cursor = textarea.value?.selectionStart ?? body.value.length
  const before = body.value.slice(0, cursor)
  const match = before.match(/(?:^|\s)@([^\s@]*)$/)
  mentionOpen.value = Boolean(match)
  mentionQuery.value = match?.[1] ?? ''
}
function insertMention(person: ChatPerson) {
  const cursor = textarea.value?.selectionStart ?? body.value.length
  const before = body.value.slice(0, cursor).replace(/@[^\s@]*$/, `@${person.name} `)
  body.value = before + body.value.slice(cursor)
  mentionOpen.value = false
  nextTick(() => textarea.value?.focus())
}
function insertEmoji(emoji: string) {
  const cursor = textarea.value?.selectionStart ?? body.value.length
  body.value = body.value.slice(0, cursor) + emoji + body.value.slice(cursor)
  emojiOpen.value = false
  nextTick(() => textarea.value?.focus())
}
function submit() {
  const text = body.value.trim()
  if (editing.value) {
    if (text) emit('edit', editing.value.id, text)
    editing.value = null; body.value = ''; return
  }
  if (!text && !attachments.value.length) return
  emit('send', text, replyTo.value?.id ?? null, attachments.value.map(file => file.id))
  body.value = ''; replyTo.value = null; attachments.value = []; mentionOpen.value = false; emojiOpen.value = false; emit('typing', false)
}
function startEdit(message: ChatMessage) { editing.value = message; replyTo.value = null; body.value = message.body; messageMenuId.value = null; nextTick(() => textarea.value?.focus()) }
function startReply(message: ChatMessage) { replyTo.value = message; editing.value = null; messageMenuId.value = null; nextTick(() => textarea.value?.focus()) }
function cancelContext() { replyTo.value = null; editing.value = null; body.value = '' }
function attach(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  emit('upload', file, attachment => { uploading.value = false; if (attachment) attachments.value.push(attachment); (event.target as HTMLInputElement).value = '' })
}
</script>

<template>
  <section class="relative flex min-h-0 flex-1 flex-col bg-brand-bg">
    <header class="flex h-[66px] shrink-0 items-center justify-between border-b border-brand-border-light bg-white px-4 sm:px-5">
      <div class="flex min-w-0 items-center gap-3">
        <button type="button" class="flex h-8 w-8 items-center justify-center rounded hover:bg-brand-bg md:hidden" aria-label="Volver" @click="emit('back')"><ArrowLeft class="h-4 w-4 text-brand-text-secondary" /></button>
        <ChatAvatar :name="conversation.title" :group="conversation.type === 'group'" :online="online" size="sm" />
        <div class="min-w-0">
          <h2 class="truncate text-sm font-bold text-brand-text">{{ conversation.title }}</h2>
          <p class="truncate text-xs text-brand-text-muted">{{ typingNames.length ? `${typingNames.join(', ')} está escribiendo...` : conversation.type === 'group' ? `${conversation.participantCount} participantes` : online ? 'En línea' : other?.jobTitle || 'Trabajador' }}</p>
        </div>
      </div>
      <div class="relative">
        <button type="button" class="flex h-8 w-8 items-center justify-center rounded hover:bg-brand-bg" aria-label="Opciones" @click="menuOpen = !menuOpen"><MoreHorizontal class="h-5 w-5 text-brand-text-secondary" /></button>
        <div v-if="menuOpen" class="absolute right-0 top-9 z-30 w-48 rounded-lg border border-brand-border-light bg-white p-1.5 shadow-[0_8px_24px_#33475B22]">
          <button v-if="!compact" type="button" class="flex w-full rounded px-3 py-2 text-left text-xs font-medium text-brand-text hover:bg-brand-bg" @click="emit('float'); menuOpen = false">Abrir como burbuja</button>
          <button v-if="conversation.type === 'group' && conversation.canManage" type="button" class="flex w-full rounded px-3 py-2 text-left text-xs font-medium text-brand-text hover:bg-brand-bg" @click="emit('manage'); menuOpen = false">Editar grupo</button>
          <button type="button" class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-medium text-brand-text hover:bg-brand-bg" @click="emit('archive'); menuOpen = false"><Archive class="h-3.5 w-3.5" /> Archivar conversación</button>
        </div>
      </div>
    </header>

    <div v-if="loading" class="flex flex-1 items-center justify-center"><LoaderCircle class="h-6 w-6 animate-spin text-brand-blue" /></div>
    <div v-else ref="list" class="chat-message-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5" :class="compact ? 'space-y-2' : 'space-y-3 sm:px-8'">
      <button v-if="messages.length >= 50" type="button" class="mx-auto block text-xs font-semibold text-brand-blue hover:underline" @click="emit('loadOlder')">Cargar mensajes anteriores</button>
      <div v-if="!messages.length" class="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue-bg"><Users class="h-6 w-6 text-brand-blue" /></span>
        <div><p class="text-sm font-bold text-brand-text">Comienza la conversación</p><p class="mt-1 text-xs text-brand-text-muted">Los mensajes de este chat aparecerán aquí.</p></div>
      </div>
      <template v-for="(message, index) in messages" :key="message.id">
        <div v-if="showDate(index)" class="flex items-center gap-3 py-2"><span class="h-px flex-1 bg-brand-border-light" /><span class="text-[10px] font-semibold uppercase tracking-wide text-brand-text-muted">{{ dateLabel(message.createdAt) }}</span><span class="h-px flex-1 bg-brand-border-light" /></div>
        <div class="group flex gap-2" :class="message.sender?.id === currentUserId ? 'justify-end' : 'justify-start'">
          <ChatAvatar v-if="message.sender?.id !== currentUserId" :name="message.sender?.name || 'Usuario'" size="sm" />
          <div class="relative max-w-[78%]">
            <p v-if="conversation.type === 'group' && message.sender?.id !== currentUserId" class="mb-1 px-1 text-[11px] font-semibold text-brand-text-secondary">{{ message.sender?.name }}</p>
            <div class="rounded-lg border px-3 py-2 shadow-[0_1px_2px_#33475B0D]" :class="message.sender?.id === currentUserId ? 'border-[#B7E7EF] bg-[#EAF7F9]' : 'border-brand-border-light bg-white'">
              <div v-if="message.replyTo" class="mb-2 rounded border-l-2 border-brand-blue bg-white/60 px-2 py-1 text-[11px] text-brand-text-muted"><b class="text-brand-text-secondary">{{ message.replyTo.senderName }}</b><p class="truncate">{{ message.replyTo.body }}</p></div>
              <p v-if="message.deletedAt" class="text-xs italic text-brand-text-muted">Mensaje eliminado</p>
              <p v-else class="whitespace-pre-wrap break-words text-[13px] leading-5 text-brand-text">{{ message.body }}</p>
              <a v-for="file in message.attachments" :key="file.id" :href="file.url" target="_blank" class="mt-2 flex items-center gap-2 rounded border border-brand-border-light bg-white px-2.5 py-2 text-xs font-medium text-brand-blue hover:bg-brand-bg"><FileText class="h-4 w-4" /><span class="min-w-0 flex-1 truncate">{{ file.fileName }}</span><Download class="h-3.5 w-3.5" /></a>
              <div class="mt-1 flex items-center justify-end gap-1 text-[10px] text-brand-text-muted"><span v-if="message.editedAt">editado ·</span><span>{{ time(message.createdAt) }}</span><CheckCheck v-if="message.sender?.id === currentUserId && message.readCount" class="h-3 w-3 text-brand-blue" /><Check v-else-if="message.sender?.id === currentUserId" class="h-3 w-3" /></div>
            </div>
            <button v-if="!message.deletedAt" type="button" class="absolute top-1 flex h-7 w-7 items-center justify-center rounded-full border border-brand-border-light bg-white opacity-0 shadow-sm group-hover:opacity-100" :class="message.sender?.id === currentUserId ? '-left-9' : '-right-9'" @click="messageMenuId = messageMenuId === message.id ? null : message.id"><MoreHorizontal class="h-3.5 w-3.5 text-brand-text-secondary" /></button>
            <div v-if="messageMenuId === message.id" class="absolute top-9 z-20 w-36 rounded-lg border border-brand-border-light bg-white p-1 shadow-[0_8px_20px_#33475B22]" :class="message.sender?.id === currentUserId ? 'right-0' : 'left-0'">
              <button class="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-brand-text hover:bg-brand-bg" @click="startReply(message)"><Reply class="h-3.5 w-3.5" /> Responder</button>
              <button v-if="message.sender?.id === currentUserId" class="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-brand-text hover:bg-brand-bg" @click="startEdit(message)"><Pencil class="h-3.5 w-3.5" /> Editar</button>
              <button v-if="message.sender?.id === currentUserId" class="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-brand-error-text hover:bg-brand-bg" @click="deleteTarget = message; messageMenuId = null"><Trash2 class="h-3.5 w-3.5" /> Eliminar</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <footer class="shrink-0 border-t border-brand-border-light bg-white">
      <div v-if="replyTo || editing" class="flex items-center justify-between border-b border-brand-border-light bg-brand-bg px-4 py-2 text-xs">
        <span class="min-w-0"><b class="text-brand-text">{{ editing ? 'Editando mensaje' : `Respondiendo a ${replyTo?.sender?.name || 'Usuario'}` }}</b><span class="ml-2 truncate text-brand-text-muted">{{ editing?.body || replyTo?.body }}</span></span>
        <button @click="cancelContext"><X class="h-3.5 w-3.5 text-brand-text-muted" /></button>
      </div>
      <div v-if="attachments.length" class="flex gap-2 overflow-x-auto px-4 pt-3"><span v-for="file in attachments" :key="file.id" class="flex max-w-52 items-center gap-2 rounded bg-brand-bg px-2 py-1 text-[11px] text-brand-text"><FileText class="h-3 w-3" /><span class="truncate">{{ file.fileName }}</span><button @click="attachments = attachments.filter(item => item.id !== file.id)"><X class="h-3 w-3" /></button></span></div>
      <div class="relative flex items-end gap-2 p-3 sm:px-4">
        <div class="relative min-w-0 flex-1">
          <textarea ref="textarea" v-model="body" rows="1" class="block max-h-28 min-h-10 w-full resize-none rounded-lg border border-brand-border bg-white px-3 py-2.5 text-[13px] text-brand-text outline-none placeholder:text-brand-text-muted focus:border-brand-blue" placeholder="Escribe un mensaje..." @input="onInput" @keydown.enter.exact.prevent="submit" />
          <div v-if="mentionOpen" class="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-lg border border-brand-border-light bg-white shadow-[0_8px_24px_#33475B22]">
            <p class="border-b border-brand-border-light px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Mencionar trabajador</p>
            <button v-for="person in mentionOptions" :key="person.id" type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-bg" @click="insertMention(person)"><ChatAvatar :name="person.name" size="sm" /><span class="min-w-0"><span class="block truncate text-xs font-semibold text-brand-text">{{ person.name }}</span><span class="block truncate text-[11px] text-brand-text-muted">{{ person.email }}</span></span></button>
            <p v-if="!mentionOptions.length" class="px-3 py-3 text-xs text-brand-text-muted">No hay coincidencias.</p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <label v-if="canAttach" class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg hover:text-brand-text" title="Adjuntar archivo"><input type="file" class="hidden" :disabled="uploading" @change="attach" /><LoaderCircle v-if="uploading" class="h-4 w-4 animate-spin" /><Paperclip v-else class="h-4 w-4" /></label>
          <div ref="emojiContainer" class="relative flex">
            <button type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg hover:text-brand-text" title="Emoji" @click="emojiOpen = !emojiOpen"><Smile class="h-4 w-4" /></button>
            <div v-if="emojiOpen" class="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-lg border border-brand-border-light bg-white p-3 shadow-[0_8px_24px_#33475B22]">
              <p class="mb-2 text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Emojis</p>
              <div class="grid grid-cols-5 gap-2">
                <button v-for="emoji in professionalEmojis" :key="emoji" type="button" class="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-brand-bg" @click="insertEmoji(emoji)">{{ emoji }}</button>
              </div>
            </div>
          </div>
          <button type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-brand-orange text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-40" :disabled="!body.trim() && !attachments.length" aria-label="Enviar" @click="submit"><Send class="h-4 w-4" /></button>
        </div>
      </div>
    </footer>

    <Teleport to="body">
      <div v-if="deleteTarget" class="fixed inset-0 z-[100] flex items-center justify-center bg-[#33475B80] p-4">
        <div class="w-full max-w-sm rounded-lg bg-white shadow-xl"><div class="p-5"><h3 class="text-[15px] font-bold text-brand-text">Eliminar mensaje</h3><p class="mt-2 text-sm leading-5 text-brand-text-secondary">El mensaje dejará de verse para todos los participantes.</p></div><div class="flex justify-end gap-3 border-t border-brand-border-light p-4"><button class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text" @click="deleteTarget = null">Cancelar</button><button class="rounded bg-brand-error-text px-4 py-2 text-sm font-semibold text-white" @click="emit('delete', deleteTarget!.id); deleteTarget = null">Eliminar</button></div></div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.chat-message-scroll { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
</style>

import type { ChatAttachment, ChatConversation, ChatMessage, ChatPerson, ResolvedChatPermissions } from '~/utils/chat'

interface ChatState {
  permissions: ResolvedChatPermissions | null
  ready: boolean
  loading: boolean
  conversations: ChatConversation[]
  archived: ChatConversation[]
  messages: Record<string, ChatMessage[]>
  nextCursor: Record<string, string | null>
  selectedId: string | null
  chatViewActive: boolean
  floatingIds: string[]
  minimizedIds: string[]
  typing: Record<string, string[]>
  presence: Record<string, boolean>
}

let consumers = 0
let realtimeStops: Array<() => void> = []
let floatingRestored = false
let chatAudioContext: AudioContext | null = null

const floatingStorageKey = 'flowerp-chat-floating'

function replaceMessage(list: ChatMessage[], message: ChatMessage) {
  const index = list.findIndex(item => item.id === message.id || item.clientMessageId === message.clientMessageId)
  if (index >= 0) list.splice(index, 1, message)
  else list.push(message)
  list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function useChat() {
  const state = useState<ChatState>('chat', () => ({
    permissions: null, ready: false, loading: false, conversations: [], archived: [], messages: {}, nextCursor: {}, selectedId: null, chatViewActive: false,
    floatingIds: [], minimizedIds: [], typing: {}, presence: {}
  }))
  const { user } = useAuth()
  const identity = () => [user.value?.tenantId, user.value?.id, user.value?.roleId, user.value?.sessionId].join(':')
  const chatScope = useState('chat-scope', () => '')
  watch(identity, value => {
    if (chatScope.value === value) return
    chatScope.value = value
    state.value.permissions = null; state.value.ready = false; state.value.conversations = []; state.value.archived = []
    state.value.messages = {}; state.value.nextCursor = {}; state.value.selectedId = null
    state.value.floatingIds = []; state.value.minimizedIds = []; state.value.typing = {}; state.value.presence = {}
    floatingRestored = false
  }, { immediate: true, flush: 'sync' })
  const permissionsResource = useShellResource<ResolvedChatPermissions>('chat-permissions', '/api/chat/permissions')
  watch(permissionsResource.data, value => { state.value.permissions = value; state.value.ready = Boolean(value) }, { immediate: true })
  const realtime = useRealtime()
  const unreadCount = computed(() => state.value.conversations.reduce((sum, item) => sum + item.unreadCount, 0))
  const canAccess = computed(() => Boolean(permissionsResource.data.value?.effective.canAccess))
  const recentResource = useShellResource<{ items: ChatConversation[] }>('chat-recent', '/api/chat/conversations', () => canAccess.value)
  const archivedResource = useShellResource<{ items: ChatConversation[] }>('chat-archived', '/api/chat/conversations?archived=true', () => canAccess.value)
  let active = false
  const isVisible = (id: string) =>
    (state.value.chatViewActive && state.value.selectedId === id)
    || (state.value.floatingIds.includes(id) && !state.value.minimizedIds.includes(id))

  async function requestAlerts() {
    if (!import.meta.client || !('Notification' in window)) return
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* Permission requests may be blocked by the browser. */ }
    }
  }

  function playAlert() {
    if (!import.meta.client) return
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) return
      if (!chatAudioContext) chatAudioContext = new AudioContextCtor() as AudioContext
      if (!chatAudioContext) return
      const context = chatAudioContext
      if (context.state === 'suspended') void context.resume()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(); oscillator.stop(context.currentTime + 0.2)
    } catch { /* Audio is optional and can be blocked by autoplay policy. */ }
  }

  function notifyIncoming(message: ChatMessage) {
    if (!import.meta.client || message.sender?.id === user.value?.id) return
    playAlert()
    if (document.visibilityState !== 'hidden' || !('Notification' in window) || Notification.permission !== 'granted') return
    const notification = new Notification(message.sender?.name || 'Nuevo mensaje', {
      body: message.body || 'Te envió un archivo',
      tag: `chat-${message.conversationId}`
    })
    notification.onclick = () => {
      window.focus()
      void navigateTo({ path: '/chat', query: { conversation: message.conversationId } })
      notification.close()
    }
  }

  function persistFloating() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(floatingStorageKey, JSON.stringify({ ids: state.value.floatingIds, minimized: state.value.minimizedIds }))
    } catch { /* Storage may be unavailable in private browsing. */ }
  }

  function restoreFloating() {
    if (floatingRestored || !import.meta.client) return
    floatingRestored = true
    try {
      const saved = JSON.parse(localStorage.getItem(floatingStorageKey) || '{}') as { ids?: unknown; minimized?: unknown }
      const available = new Set([...state.value.conversations, ...state.value.archived].map(item => item.id))
      const ids = Array.isArray(saved.ids) ? saved.ids.filter((id): id is string => typeof id === 'string' && available.has(id)).slice(-3) : []
      const minimized = Array.isArray(saved.minimized) ? saved.minimized.filter((id): id is string => ids.includes(id)) : []
      state.value.floatingIds = ids
      state.value.minimizedIds = minimized
    } catch { /* Ignore malformed local state. */ }
  }
  async function loadPermissions() {
    const started = identity()
    try {
      const permissions = await permissionsResource.execute()
      if (identity() === started) state.value.permissions = permissions
    } catch { if (identity() === started) state.value.permissions = null }
    if (identity() === started) state.value.ready = true
    return state.value.permissions
  }

  async function refreshConversations(force = true) {
    if (!canAccess.value) return
    const started = identity()
    const [recent, archived] = await Promise.all([
      force ? recentResource.refresh() : recentResource.execute(),
      force ? archivedResource.refresh() : archivedResource.execute()
    ])
    if (identity() !== started) return
    state.value.conversations = recent?.items ?? []
    state.value.archived = archived?.items ?? []
    for (const conversation of [...state.value.conversations, ...state.value.archived]) {
      if (isVisible(conversation.id)) conversation.unreadCount = 0
    }
  }

  async function initialize() {
    if (active) return
    active = true
    consumers += 1
    // AppNav y la página de Chat pueden montar en paralelo. Las suscripciones
    // deben registrarse antes de cualquier fetch para que una segunda
    // instancia no gane la carrera y deje el WebSocket sin listeners.
    if (!realtimeStops.length) {
      realtimeStops = [
        realtime.subscribe<ChatMessage>('chat.message', event => {
          const message = event.payload
          const visible = isVisible(message.conversationId)
          const list = state.value.messages[message.conversationId]
          if (list) replaceMessage(list, message)
          else if (visible) void loadMessages(message.conversationId)
          if (visible) void markRead(message.conversationId)
          if (!visible) notifyIncoming(message)
          void refreshConversations().then(() => { if (isVisible(message.conversationId)) clearUnread(message.conversationId) }).catch(() => undefined)
        }),
        realtime.subscribe<ChatMessage>('chat.updated', event => {
          const list = state.value.messages[event.payload.conversationId]
          if (list) replaceMessage(list, event.payload)
        }),
        realtime.subscribe<ChatMessage>('chat.deleted', event => {
          const list = state.value.messages[event.payload.conversationId]
          if (list) replaceMessage(list, event.payload)
          void refreshConversations().catch(() => undefined)
        }),
        realtime.subscribe<{ conversationId: string; userId: string; active: boolean }>('chat.typing', event => {
          const current = new Set(state.value.typing[event.payload.conversationId] ?? [])
          event.payload.active ? current.add(event.payload.userId) : current.delete(event.payload.userId)
          state.value.typing[event.payload.conversationId] = [...current]
        }),
        realtime.subscribe<{ userId: string; active: boolean }>('chat.presence', event => { state.value.presence[event.payload.userId] = event.payload.active }),
        realtime.subscribe<{ userId: string; active: boolean; conversationIds: string[] }>('chat.user.status', event => {
          for (const conversation of [...state.value.conversations, ...state.value.archived]) {
            if (!event.payload.conversationIds.includes(conversation.id)) continue
            const person = conversation.participants.find(item => item.id === event.payload.userId)
            if (person) person.active = event.payload.active
            if (conversation.type === 'direct' && event.payload.userId !== user.value?.id) {
              conversation.canSend = event.payload.active
              conversation.sendBlockedReason = event.payload.active ? null : 'No puedes enviar mensajes porque este usuario está desactivado.'
            }
          }
        }),
        realtime.subscribe<{ conversationId: string; userId: string; readAt: string }>('chat.read', event => {
          const list = state.value.messages[event.payload.conversationId]
          if (list) {
            const readAt = new Date(event.payload.readAt).getTime()
            for (const message of list) {
              if (message.sender?.id && event.payload.userId !== message.sender.id && new Date(message.createdAt).getTime() <= readAt) {
                message.readCount = Math.max(message.readCount, 1)
              }
            }
          } else if (event.payload.userId !== user.value?.id) void loadMessages(event.payload.conversationId)
          void refreshConversations().then(() => {
            if (event.payload.userId === user.value?.id && isVisible(event.payload.conversationId)) clearUnread(event.payload.conversationId)
          }).catch(() => undefined)
        }),
        realtime.subscribe('chat.conversation.updated', () => void refreshConversations().catch(() => undefined)),
        realtime.subscribe('realtime.poll', () => {
          if (document.visibilityState !== 'visible') return
          void refreshConversations().catch(() => undefined)
          const visibleIds = new Set<string>()
          if (state.value.chatViewActive && state.value.selectedId) visibleIds.add(state.value.selectedId)
          for (const id of state.value.floatingIds) {
            if (!state.value.minimizedIds.includes(id)) visibleIds.add(id)
          }
          for (const id of visibleIds) void loadMessages(id).then(() => markRead(id)).catch(() => undefined)
        })
      ]
    }
    realtime.start()
    await loadPermissions()
    if (canAccess.value && !state.value.conversations.length) {
      state.value.loading = true
      try { await refreshConversations(false) } finally { state.value.loading = false }
    }
    restoreFloating()
  }

  function dispose() {
    if (!active) return
    active = false
    consumers = Math.max(0, consumers - 1)
    if (consumers) return
    for (const stop of realtimeStops) stop()
    realtimeStops = []
    realtime.stop()
  }

  async function loadMessages(conversationId: string, older = false) {
    const cursor = older ? state.value.nextCursor[conversationId] : null
    const query = cursor ? `?before=${encodeURIComponent(cursor)}` : ''
    const result = await $fetch<{ items: ChatMessage[]; nextCursor: string | null }>(`/api/chat/conversations/${conversationId}/messages${query}`)
    state.value.messages[conversationId] = older
      ? [...result.items, ...(state.value.messages[conversationId] ?? [])]
      : result.items
    state.value.nextCursor[conversationId] = result.nextCursor
    return state.value.messages[conversationId]
  }

  async function selectConversation(id: string) {
    void requestAlerts()
    state.value.selectedId = id
    const readPromise = markRead(id)
    await loadMessages(id)
    await readPromise
  }

  async function markRead(id: string) {
    clearUnread(id)
    await $fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' })
    clearUnread(id)
  }

  function clearUnread(id: string) {
    const conversation = [...state.value.conversations, ...state.value.archived].find(item => item.id === id)
    if (conversation) conversation.unreadCount = 0
  }

  function markSendBlocked(id: string, reason: string) {
    for (const conversation of [...state.value.conversations, ...state.value.archived]) {
      if (conversation.id === id) {
        conversation.canSend = false
        conversation.sendBlockedReason = reason
      }
    }
  }

  async function createDirect(userId: string) {
    const result = await $fetch<{ id: string }>('/api/chat/conversations', { method: 'POST', body: { type: 'direct', userId } })
    await refreshConversations()
    return result.id
  }

  async function createGroup(title: string, userIds: string[]) {
    const result = await $fetch<{ id: string }>('/api/chat/conversations', { method: 'POST', body: { type: 'group', title, userIds } })
    await refreshConversations()
    return result.id
  }
  async function updateGroup(id: string, title: string, userIds: string[]) {
    await $fetch(`/api/chat/conversations/${id}`, { method: 'PUT', body: { title, userIds } })
    await refreshConversations()
  }

  async function sendMessage(conversationId: string, body: string, options: { replyToMessageId?: string | null; attachmentIds?: string[]; sharedRecord?: { entitySlug: string; recordId: string; label: string; url: string } | null; gifUrl?: string | null } = {}) {
    const clientMessageId = crypto.randomUUID()
    let message: ChatMessage
    try {
      message = await $fetch<ChatMessage>(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST', body: { clientMessageId, body, replyToMessageId: options.replyToMessageId ?? null, attachmentIds: options.attachmentIds ?? [], sharedRecord: options.sharedRecord ?? null, gifUrl: options.gifUrl ?? null }
      })
    } catch (error: any) {
      const statusCode = error?.statusCode ?? error?.data?.statusCode
      if (statusCode === 409) {
        markSendBlocked(conversationId, error?.statusMessage ?? error?.data?.statusMessage ?? 'No puedes enviar mensajes en esta conversación.')
      }
      throw error
    }
    const list = state.value.messages[conversationId] ?? (state.value.messages[conversationId] = [])
    replaceMessage(list, message)
    void refreshConversations().catch(() => undefined)
    return message
  }

  async function editMessage(id: string, body: string) {
    const message = await $fetch<ChatMessage>(`/api/chat/messages/${id}`, { method: 'PUT', body: { body } })
    const list = state.value.messages[message.conversationId]
    if (list) replaceMessage(list, message)
  }

  async function deleteMessage(id: string) {
    const message = await $fetch<ChatMessage>(`/api/chat/messages/${id}`, { method: 'DELETE' })
    const list = state.value.messages[message.conversationId]
    if (list) replaceMessage(list, message)
  }

  async function uploadAttachment(file: File): Promise<ChatAttachment> {
    const form = new FormData()
    form.append('file', file)
    const endpoint: string = '/api/chat/attachments'
    return await $fetch<ChatAttachment>(endpoint, { method: 'POST', body: form })
  }

  async function archiveConversation(id: string, archived = true) {
    await $fetch(`/api/chat/conversations/${id}/archive`, { method: 'PATCH', body: { archived } })
    if (state.value.selectedId === id) state.value.selectedId = null
    closeFloating(id)
    await refreshConversations()
  }

  function openFloating(id: string) {
    void requestAlerts()
    state.value.floatingIds = [...state.value.floatingIds.filter(item => item !== id), id].slice(-3)
    state.value.minimizedIds = state.value.minimizedIds.filter(item => item !== id)
    persistFloating()
    if (!state.value.messages[id]) void loadMessages(id)
    void markRead(id)
  }
  function closeFloating(id: string) {
    state.value.floatingIds = state.value.floatingIds.filter(item => item !== id)
    state.value.minimizedIds = state.value.minimizedIds.filter(item => item !== id)
    persistFloating()
  }
  function toggleMinimized(id: string) {
    const minimizing = !state.value.minimizedIds.includes(id)
    state.value.minimizedIds = minimizing ? [...state.value.minimizedIds, id] : state.value.minimizedIds.filter(item => item !== id)
    persistFloating()
    if (!minimizing) {
      if (!state.value.messages[id]) void loadMessages(id)
      void markRead(id)
    }
  }
  function setTyping(conversationId: string, typing: boolean) { realtime.send('chat.typing', { conversationId, active: typing }) }
  function conversation(id: string) { return [...state.value.conversations, ...state.value.archived].find(item => item.id === id) }

  return {
    state, unreadCount, canAccess, realtimeState: realtime.state, initialize, dispose, loadPermissions, refreshConversations, loadMessages,
    selectConversation, markRead, createDirect, createGroup, updateGroup, sendMessage, editMessage, deleteMessage, uploadAttachment,
    archiveConversation, openFloating, closeFloating, toggleMinimized, setTyping, conversation
  }
}

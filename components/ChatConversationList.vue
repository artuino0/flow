<script setup lang="ts">
import { Archive, EllipsisVertical, MessageCircle, Search, Users, X } from '@lucide/vue'
import type { ChatConversation } from '~/utils/chat'

const props = defineProps<{ conversations: ChatConversation[]; selectedId?: string | null; currentUserId: string; loading?: boolean; archived?: boolean; presence: Record<string, boolean> }>()
const emit = defineEmits<{ select: [id: string]; archive: [id: string, value: boolean]; float: [id: string] }>()
const query = ref('')
const menuId = ref<string | null>(null)
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  return term ? props.conversations.filter(item => `${item.title} ${item.lastMessage?.body ?? ''}`.toLowerCase().includes(term)) : props.conversations
})
function other(item: ChatConversation) { return item.type === 'direct' ? item.participants.find(person => person.name === item.title) ?? item.participants[0] : null }
function formatTime(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}
function preview(item: ChatConversation) {
  const body = item.lastMessage?.body || (item.lastMessage?.deletedAt ? 'Mensaje eliminado' : item.lastMessage?.sharedRecord ? 'Registro compartido' : 'Sin mensajes todavía')
  if (!item.lastMessage || !body || body === 'Sin mensajes todavía') return { text: body }
  if (item.type === 'group') return { prefix: `${(item.lastMessage.senderName || 'Usuario').split(' ')[0]}: `, text: body }
  return item.lastMessage.senderId === props.currentUserId ? { prefix: 'Tú: ', text: body } : { text: body }
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-white">
    <div class="px-4 pb-3 pt-4">
      <div class="flex h-10 items-center gap-2 rounded border border-brand-border bg-white px-3 focus-within:border-brand-blue">
        <Search class="h-4 w-4 text-brand-text-muted" :stroke-width="1.8" />
        <input v-model="query" class="min-w-0 flex-1 bg-transparent text-sm text-brand-text outline-none placeholder:text-brand-text-muted" placeholder="Buscar conversaciones" />
        <button v-if="query" type="button" aria-label="Limpiar búsqueda" @click="query = ''"><X class="h-3.5 w-3.5 text-brand-text-muted" /></button>
      </div>
    </div>

    <div v-if="loading" class="px-5 py-10 text-center text-sm text-brand-text-muted">Cargando conversaciones...</div>
    <div v-else-if="!filtered.length" class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue-bg">
        <Archive v-if="archived" class="h-6 w-6 text-brand-blue" :stroke-width="1.6" />
        <MessageCircle v-else class="h-6 w-6 text-brand-blue" :stroke-width="1.6" />
      </span>
      <div>
        <p class="text-sm font-bold text-brand-text">{{ archived ? 'No hay chats archivados' : 'Inicia una conversación' }}</p>
        <p class="mt-1 text-xs leading-5 text-brand-text-muted">{{ query ? 'No encontramos coincidencias.' : archived ? 'Los chats que archives aparecerán aquí.' : 'Habla con tu equipo sin salir de Flow.' }}</p>
      </div>
    </div>
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <button v-for="item in filtered" :key="item.id" type="button" class="group relative flex w-full gap-3 border-b border-brand-border-light border-l-4 px-4 py-3 text-left hover:bg-brand-bg" :class="[selectedId === item.id ? 'border-l-brand-blue bg-brand-sidebar-active-bg' : 'border-l-transparent bg-white', menuId === item.id ? 'z-30' : 'z-0']" @click="emit('select', item.id)">
        <ChatAvatar :name="item.title" :group="item.type === 'group'" :online="Boolean(other(item) && presence[other(item)!.id])" />
        <span class="min-w-0 flex-1 pr-12">
          <span class="block truncate text-sm" :class="selectedId === item.id ? 'font-bold text-brand-blue' : 'font-semibold text-brand-text'">{{ item.title }}</span>
          <span class="mt-1 block truncate text-xs text-brand-text-muted">
            <strong v-if="preview(item).prefix" class="font-bold text-brand-text-secondary">{{ preview(item).prefix }}</strong>{{ preview(item).text }}
          </span>
        </span>
        <span class="absolute right-9 top-3 flex h-10 flex-col items-end gap-1" :class="item.unreadCount ? 'justify-start' : 'justify-center'">
          <span class="shrink-0 text-[11px] text-brand-text-muted">{{ formatTime(item.lastMessageAt) }}</span>
          <span v-if="item.unreadCount" class="flex min-w-[20px] items-center justify-center rounded-full bg-brand-orange px-1.5 py-0.5 text-[10px] font-bold text-white">{{ item.unreadCount > 99 ? '99+' : item.unreadCount }}</span>
        </span>
        <span class="absolute right-1 top-1/2 -translate-y-1/2">
          <span class="flex h-7 w-7 items-center justify-center rounded opacity-0 hover:bg-white group-hover:opacity-100" @click.stop="menuId = menuId === item.id ? null : item.id"><EllipsisVertical class="h-4 w-4 text-brand-text-secondary" /></span>
          <span v-if="menuId === item.id" class="absolute top-8 right-0 z-50 w-44 rounded-lg border border-brand-border-light bg-white p-1.5 shadow-[0_8px_24px_#33475B22]">
            <span class="flex rounded px-3 py-2 text-xs font-medium text-brand-text hover:bg-brand-bg" @click.stop="emit('float', item.id); menuId = null">Abrir como burbuja</span>
            <span class="flex rounded px-3 py-2 text-xs font-medium text-brand-text hover:bg-brand-bg" @click.stop="emit('archive', item.id, !archived); menuId = null">{{ archived ? 'Desarchivar' : 'Archivar conversación' }}</span>
          </span>
        </span>
      </button>
    </div>
  </section>
</template>

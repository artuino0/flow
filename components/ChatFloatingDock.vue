<script setup lang="ts">
import { Minus, X } from '@lucide/vue'
const chat = useChat()
const { user } = useAuth()
onMounted(() => chat.initialize())
onBeforeUnmount(() => chat.dispose())
function messages(id: string) { return chat.state.value.messages[id] ?? [] }
async function upload(file: File, done: (value?: any) => void) { try { done(await chat.uploadAttachment(file)) } catch { done() } }
</script>

<template>
  <div v-if="chat.canAccess.value && chat.state.value.floatingIds.length" class="pointer-events-none fixed bottom-0 right-5 z-50 flex items-end gap-3">
    <section v-for="id in chat.state.value.floatingIds" :key="id" class="pointer-events-auto w-[340px] overflow-hidden rounded-t-lg border border-brand-border-light bg-white shadow-[0_8px_30px_#33475B35]" :class="chat.state.value.minimizedIds.includes(id) ? 'h-[50px]' : 'h-[480px]'">
      <template v-if="chat.conversation(id)">
        <div v-if="chat.state.value.minimizedIds.includes(id)" class="flex h-[50px] items-center justify-between px-3">
          <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="chat.toggleMinimized(id)"><span class="relative shrink-0"><ChatAvatar :name="chat.conversation(id)!.title" :group="chat.conversation(id)!.type === 'group'" size="sm" /><span v-if="chat.conversation(id)!.unreadCount" class="absolute -right-2 -top-2 flex min-w-[18px] items-center justify-center rounded-full bg-brand-orange px-1 text-[10px] font-bold leading-[18px] text-white">{{ chat.conversation(id)!.unreadCount > 99 ? '99+' : chat.conversation(id)!.unreadCount }}</span></span><span class="truncate text-sm font-semibold text-brand-text">{{ chat.conversation(id)!.title }}</span></button>
          <button class="h-7 w-7" @click="chat.toggleMinimized(id)"><Minus class="h-4 w-4 text-brand-text-muted" /></button><button class="h-7 w-7" @click="chat.closeFloating(id)"><X class="h-4 w-4 text-brand-text-muted" /></button>
        </div>
        <div v-else class="relative flex h-full flex-col">
          <button class="absolute right-10 top-[18px] z-20" title="Minimizar" @click="chat.toggleMinimized(id)"><Minus class="h-4 w-4 text-brand-text-muted" /></button>
          <button class="absolute right-3 top-[18px] z-20" title="Cerrar" @click="chat.closeFloating(id)"><X class="h-4 w-4 text-brand-text-muted" /></button>
          <ChatThread :conversation="chat.conversation(id)!" :messages="messages(id)" :current-user-id="user?.id || ''" :can-attach="Boolean(chat.state.value.permissions?.effective.canSendAttachments)" :can-send="chat.conversation(id)!.canSend" :send-blocked-reason="chat.conversation(id)!.sendBlockedReason" :typing-user-ids="chat.state.value.typing[id]" :users="chat.conversation(id)!.participants" :presence="chat.state.value.presence" compact @archive="chat.archiveConversation(id)" @send="(body, reply, files, record, gifUrl) => chat.sendMessage(id, body, { replyToMessageId: reply, attachmentIds: files, sharedRecord: record, gifUrl })" @edit="chat.editMessage" @delete="chat.deleteMessage" @typing="value => chat.setTyping(id, value)" @upload="upload" @load-older="chat.loadMessages(id, true)" />
        </div>
      </template>
    </section>
  </div>
</template>

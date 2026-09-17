<script setup lang="ts">
import { Archive, MessageCircle, Plus, RotateCw } from '@lucide/vue'
import type { ChatPerson } from '~/utils/chat'

definePageMeta({ layout: 'default' })
const chat = useChat()
const { user } = useAuth()
const route = useRoute()
const router = useRouter()
const tab = ref<'recent' | 'archived'>('recent')
const newOpen = ref(false)
const groupEditOpen = ref(false)
const users = ref<ChatPerson[]>([])
const usersLoading = ref(false)
const threadLoading = ref(false)
const toast = useToast()

const current = computed(() => chat.state.value.selectedId ? chat.conversation(chat.state.value.selectedId) : null)
const list = computed(() => tab.value === 'archived' ? chat.state.value.archived : chat.state.value.conversations)

onMounted(async () => {
  chat.state.value.chatViewActive = true
  await chat.initialize()
  const requested = typeof route.query.conversation === 'string' ? route.query.conversation : null
  if (requested && chat.conversation(requested)) await openConversation(requested, false)
})
onBeforeUnmount(() => {
  chat.state.value.chatViewActive = false
  // selectedId pertenece al estado compartido para que sobreviva al cambio
  // de ruta, pero la conversación solo cuenta como visible mientras esta
  // pantalla está montada. Las burbujas flotantes conservan su propio chat.
  const selected = chat.state.value.selectedId
  if (selected && !chat.state.value.floatingIds.includes(selected)) chat.state.value.selectedId = null
  chat.dispose()
})

async function openConversation(id: string, updateUrl = true) {
  threadLoading.value = true
  try { await chat.selectConversation(id); if (updateUrl) await router.replace({ query: { ...route.query, conversation: id } }) }
  finally { threadLoading.value = false }
}
async function closeThread() { chat.state.value.selectedId = null; const query = { ...route.query }; delete query.conversation; await router.replace({ query }) }
async function openNew() { newOpen.value = true; usersLoading.value = true; try { users.value = (await $fetch<{ users: ChatPerson[] }>('/api/chat/users')).users ?? [] } finally { usersLoading.value = false } }
async function openGroupEdit() { if (!current.value) return; groupEditOpen.value = true; if (!users.value.length) { usersLoading.value = true; try { users.value = (await $fetch<{ users: ChatPerson[] }>('/api/chat/users')).users ?? [] } finally { usersLoading.value = false } } }
async function updateGroup(title: string, userIds: string[]) { if (!current.value) return; try { await chat.updateGroup(current.value.id, title, userIds); groupEditOpen.value = false; toast.success('Grupo actualizado') } catch (error: any) { toast.error('No se pudo actualizar el grupo', error?.data?.statusMessage) } }
async function createDirect(userId: string) { try { const id = await chat.createDirect(userId); newOpen.value = false; await openConversation(id) } catch (error: any) { toast.error('No se pudo iniciar el chat', error?.data?.statusMessage) } }
async function createGroup(title: string, userIds: string[]) { try { const id = await chat.createGroup(title, userIds); newOpen.value = false; await openConversation(id) } catch (error: any) { toast.error('No se pudo crear el grupo', error?.data?.statusMessage) } }
async function upload(file: File, done: (value?: any) => void) { try { done(await chat.uploadAttachment(file)) } catch (error: any) { done(); toast.error('No se pudo adjuntar el archivo', error?.data?.statusMessage) } }
async function send(body: string, reply: string | null, files: string[]) { try { await chat.sendMessage(current.value!.id, body, { replyToMessageId: reply, attachmentIds: files }) } catch (error: any) { toast.error('No se pudo enviar el mensaje', error?.data?.statusMessage) } }
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
    <div v-if="chat.realtimeState.value.reconnecting" class="flex h-9 shrink-0 items-center justify-center gap-2 bg-[#FFF4E5] px-4 text-xs font-semibold text-[#8A5D00]"><RotateCw class="h-3.5 w-3.5 animate-spin" /> Reconectando el chat. Tus mensajes guardados siguen disponibles.</div>
    <div v-if="chat.state.value.ready && !chat.canAccess.value" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><span class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-bg"><MessageCircle class="h-7 w-7 text-brand-text-muted" /></span><h1 class="text-lg font-bold text-brand-text">Chat no disponible</h1><p class="max-w-sm text-sm text-brand-text-muted">Tu rol no tiene acceso al chat. Pide a un administrador que revise tus permisos.</p></div>
    <template v-else>
      <div class="flex min-h-0 flex-1">
        <aside class="flex w-full shrink-0 flex-col border-r border-brand-border-light md:w-[365px]" :class="current ? 'hidden md:flex' : 'flex'">
          <header class="flex h-[68px] shrink-0 items-center justify-between border-b border-brand-border-light bg-white px-5">
            <div><h1 class="text-xl font-bold text-brand-text">Chat</h1></div>
            <button v-if="chat.state.value.permissions?.effective.canStartDirect || chat.state.value.permissions?.effective.canCreateGroups" class="flex items-center gap-2 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover" @click="openNew"><Plus class="h-4 w-4" /> Nuevo chat</button>
          </header>
          <div class="flex h-[45px] shrink-0 border-b border-brand-border-light px-4" role="tablist">
            <button class="flex flex-1 items-center justify-center gap-1.5 border-b-2 text-xs font-semibold" :class="tab === 'recent' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted'" @click="tab = 'recent'"><MessageCircle class="h-3.5 w-3.5" /> Recientes</button>
            <button class="flex flex-1 items-center justify-center gap-1.5 border-b-2 text-xs font-semibold" :class="tab === 'archived' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted'" @click="tab = 'archived'"><Archive class="h-3.5 w-3.5" /> Archivados</button>
          </div>
          <ChatConversationList :conversations="list" :selected-id="chat.state.value.selectedId" :current-user-id="user?.id || ''" :loading="chat.state.value.loading" :archived="tab === 'archived'" :presence="chat.state.value.presence" @select="openConversation" @float="chat.openFloating" @archive="chat.archiveConversation" />
        </aside>
        <ChatThread v-if="current" :conversation="current" :messages="chat.state.value.messages[current.id] ?? []" :current-user-id="user?.id || ''" :can-attach="Boolean(chat.state.value.permissions?.effective.canSendAttachments)" :loading="threadLoading" :typing-user-ids="chat.state.value.typing[current.id]" :users="users.length ? users : current.participants" :presence="chat.state.value.presence" @back="closeThread" @archive="chat.archiveConversation(chat.state.value.selectedId!)" @float="chat.openFloating(chat.state.value.selectedId!)" @manage="openGroupEdit" @send="send" @edit="chat.editMessage" @delete="chat.deleteMessage" @typing="value => chat.setTyping(chat.state.value.selectedId!, value)" @upload="upload" @load-older="chat.loadMessages(chat.state.value.selectedId!, true)" />
        <div v-else class="hidden min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-brand-bg text-center md:flex"><span class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-blue-bg"><MessageCircle class="h-7 w-7 text-brand-blue" :stroke-width="1.5" /></span><div><h2 class="text-base font-bold text-brand-text">Selecciona una conversación</h2><p class="mt-1 text-sm text-brand-text-muted">Elige un chat para ver sus mensajes.</p></div></div>
      </div>
    </template>
    <ChatNewConversationModal v-if="newOpen" :users="users" :can-create-groups="Boolean(chat.state.value.permissions?.effective.canCreateGroups)" :loading="usersLoading" @close="newOpen = false" @direct="createDirect" @group="createGroup" />
    <ChatGroupEditModal v-if="groupEditOpen && current" :conversation="current" :users="users" :loading="usersLoading" @close="groupEditOpen = false" @save="updateGroup" />
  </div>
</template>

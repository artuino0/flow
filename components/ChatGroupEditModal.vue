<script setup lang="ts">
import { Check, Search, Users, X } from '@lucide/vue'
import type { ChatConversation, ChatPerson } from '~/utils/chat'

const props = withDefaults(defineProps<{ conversation: ChatConversation; users?: ChatPerson[]; loading?: boolean }>(), { users: () => [], loading: false })
const emit = defineEmits<{ close: []; save: [title: string, userIds: string[]] }>()
const title = ref(props.conversation.title)
const query = ref('')
const selected = ref(props.conversation.participants.map(person => person.id))
const error = ref('')
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  return term ? props.users.filter(person => `${person.name} ${person.email} ${person.jobTitle ?? ''}`.toLowerCase().includes(term)) : props.users
})
function toggle(id: string) { selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id] }
function save() {
  if (!title.value.trim()) { error.value = 'Escribe un nombre para el grupo'; return }
  if (selected.value.length < 2) { error.value = 'Selecciona al menos dos participantes'; return }
  emit('save', title.value.trim(), selected.value)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[90] flex items-center justify-center bg-[#33475B80] p-4" @mousedown.self="emit('close')">
      <div class="flex max-h-[min(680px,calc(100vh-32px))] w-full max-w-[480px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_12px_40px_#33475B38]">
        <header class="flex shrink-0 items-start justify-between border-b border-brand-border-light px-5 py-4"><div><h2 class="text-base font-bold text-brand-text">Editar grupo</h2><p class="mt-1 text-sm text-brand-text-secondary">Actualiza el nombre y sus participantes.</p></div><button class="flex h-7 w-7 items-center justify-center rounded hover:bg-brand-bg" @click="emit('close')"><X class="h-4 w-4 text-brand-text-muted" /></button></header>
        <div class="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <div class="flex flex-col gap-1.5"><label class="text-xs font-semibold text-brand-text-secondary">Nombre del grupo</label><input v-model="title" maxlength="100" class="h-10 rounded border border-brand-border px-3 text-sm text-brand-text outline-none focus:border-brand-blue" /></div>
          <div class="flex h-10 shrink-0 items-center gap-2 rounded border border-brand-border px-3 focus-within:border-brand-blue"><Search class="h-4 w-4 text-brand-text-muted" /><input v-model="query" class="min-w-0 flex-1 text-sm outline-none" placeholder="Buscar participantes" /></div>
          <div class="min-h-0 flex-1 overflow-y-auto rounded border border-brand-border-light">
            <p v-if="loading" class="p-6 text-center text-sm text-brand-text-muted">Buscando trabajadores...</p>
            <button v-for="person in filtered" :key="person.id" type="button" class="flex w-full items-center gap-3 border-b border-brand-border-light px-3 py-3 text-left last:border-0 hover:bg-brand-bg" @click="toggle(person.id)"><ChatAvatar :name="person.name" size="sm" /><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-brand-text">{{ person.name }}</span><span class="block truncate text-xs text-brand-text-muted">{{ person.jobTitle || person.email }}</span></span><span class="flex h-[18px] w-[18px] items-center justify-center rounded border" :class="selected.includes(person.id) ? 'border-brand-orange bg-brand-orange' : 'border-brand-border'"><Check v-if="selected.includes(person.id)" class="h-3 w-3 text-white" :stroke-width="3" /></span></button>
            <div v-if="!loading && !filtered.length" class="flex flex-col items-center gap-2 p-8 text-center"><Users class="h-6 w-6 text-brand-text-muted" /><p class="text-sm text-brand-text-muted">No encontramos trabajadores.</p></div>
          </div>
          <p v-if="error" class="text-xs font-medium text-brand-error-text">{{ error }}</p>
        </div>
        <footer class="flex shrink-0 justify-end gap-3 border-t border-brand-border-light px-5 py-4"><button class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="emit('close')">Cancelar</button><button class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover" @click="save">Guardar cambios</button></footer>
      </div>
    </div>
  </Teleport>
</template>

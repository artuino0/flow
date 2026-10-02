<script setup lang="ts">
import { Check, Search, Users, X } from '@lucide/vue'
import type { ChatPerson } from '~/utils/chat'

const props = withDefaults(defineProps<{ users?: ChatPerson[]; canCreateGroups: boolean; loading?: boolean }>(), { users: () => [], loading: false })
const emit = defineEmits<{ close: []; direct: [userId: string]; group: [title: string, userIds: string[]] }>()
const mode = ref<'direct' | 'group'>('direct')
const query = ref('')
const title = ref('')
const selected = ref<string[]>([])
const error = ref('')
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  const available = props.users ?? []
  return term ? available.filter(person => `${person.name} ${person.email} ${person.jobTitle ?? ''}`.toLowerCase().includes(term)) : available
})
function pick(person: ChatPerson) {
  if (mode.value === 'direct') { emit('direct', person.id); return }
  selected.value = selected.value.includes(person.id) ? selected.value.filter(id => id !== person.id) : [...selected.value, person.id]
}
function create() {
  if (!title.value.trim()) { error.value = 'Escribe un nombre para el grupo'; return }
  if (selected.value.length < 2) { error.value = 'Selecciona al menos dos participantes'; return }
  emit('group', title.value.trim(), selected.value)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[90] flex items-center justify-center bg-brand-shadow/[0.5019607843137255] p-4" @mousedown.self="emit('close')">
      <div class="flex max-h-[min(680px,calc(100vh-32px))] w-full max-w-[480px] flex-col overflow-hidden rounded-lg bg-brand-surface shadow-[0_12px_40px_rgb(var(--brand-shadow)/0.2196078431372549)]">
        <header class="flex shrink-0 items-start justify-between border-b border-brand-border-light px-5 py-4">
          <div><h2 class="text-base font-bold text-brand-text">Nueva conversación</h2><p class="mt-1 text-sm text-brand-text-secondary">Busca a un trabajador para comenzar.</p></div>
          <button class="flex h-7 w-7 items-center justify-center rounded hover:bg-brand-bg" @click="emit('close')"><X class="h-4 w-4 text-brand-text-muted" /></button>
        </header>
        <div v-if="canCreateGroups" class="flex shrink-0 gap-1 border-b border-brand-border-light px-5 pt-3">
          <button class="border-b-2 px-3 py-2 text-sm font-semibold" :class="mode === 'direct' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted'" @click="mode = 'direct'; selected = []; error = ''">Mensaje directo</button>
          <button class="border-b-2 px-3 py-2 text-sm font-semibold" :class="mode === 'group' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted'" @click="mode = 'group'; error = ''">Crear grupo</button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <div v-if="mode === 'group'" class="flex flex-col gap-1.5"><label class="text-xs font-semibold text-brand-text-secondary">Nombre del grupo</label><input v-model="title" maxlength="100" class="h-10 rounded border border-brand-border px-3 text-sm text-brand-text outline-none focus:border-brand-blue" placeholder="Ej. Operación de empaque" /></div>
          <div class="flex h-10 shrink-0 items-center gap-2 rounded border border-brand-border px-3 focus-within:border-brand-blue"><Search class="h-4 w-4 text-brand-text-muted" /><input v-model="query" class="min-w-0 flex-1 text-sm outline-none" :placeholder="mode === 'group' ? 'Buscar participantes' : 'Buscar trabajador'" /></div>
          <div v-if="selected.length" class="flex flex-wrap gap-1.5"><span v-for="id in selected" :key="id" class="flex items-center gap-1 rounded-full bg-brand-blue-bg px-2.5 py-1 text-xs font-semibold text-brand-blue">{{ (props.users ?? []).find(user => user.id === id)?.name }}<button @click="selected = selected.filter(value => value !== id)"><X class="h-3 w-3" /></button></span></div>
          <div class="min-h-0 flex-1 overflow-y-auto rounded border border-brand-border-light">
            <p v-if="loading" class="p-6 text-center text-sm text-brand-text-muted">Buscando trabajadores...</p>
            <button v-for="person in filtered" :key="person.id" class="flex w-full items-center gap-3 border-b border-brand-border-light px-3 py-3 text-left last:border-0 hover:bg-brand-bg" @click="pick(person)">
              <ChatAvatar :name="person.name" size="sm" />
              <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-brand-text">{{ person.name }}</span><span class="block truncate text-xs text-brand-text-muted">{{ person.jobTitle || person.email }}</span></span>
              <span v-if="mode === 'group'" class="flex h-[18px] w-[18px] items-center justify-center rounded border" :class="selected.includes(person.id) ? 'border-brand-orange bg-brand-orange' : 'border-brand-border'"><Check v-if="selected.includes(person.id)" class="h-3 w-3 text-brand-primary-fg" :stroke-width="3" /></span>
            </button>
            <div v-if="!loading && !filtered.length" class="flex flex-col items-center gap-2 p-8 text-center"><Users class="h-6 w-6 text-brand-text-muted" /><p class="text-sm text-brand-text-muted">No encontramos trabajadores.</p></div>
          </div>
          <p v-if="error" class="text-xs font-medium text-brand-error-text">{{ error }}</p>
        </div>
        <footer class="flex shrink-0 justify-end gap-3 border-t border-brand-border-light px-5 py-4">
          <button class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="emit('close')">Cancelar</button>
          <button v-if="mode === 'group'" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover" @click="create">Crear grupo</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* HU-164: controles nativos con el esquema del ámbito y el blanco claro original. */
:where(input, select, textarea) { color-scheme: inherit; }
:where(select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])):not([class*="bg-"]) { background-color: rgb(var(--brand-surface)); }
</style>

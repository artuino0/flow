<script setup lang="ts">
import { Pencil, Plus, Trash2, Users, X } from '@lucide/vue'

interface Member { id: string; label: string; email: string }
interface Group { id: string; name: string; members: Member[] }
interface UserOption { id: string; label: string; email: string }

const toast = useToast()
const groups = ref<Group[]>([])
const users = ref<UserOption[]>([])
const loading = ref(true)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const name = ref('')
const memberIds = ref<string[]>([])

async function load() {
  loading.value = true
  try {
    const [groupResponse, recipientResponse] = await Promise.all([
      $fetch<{ groups: Group[] }>('/api/notifications/groups'),
      $fetch<{ users: UserOption[] }>('/api/notifications/recipients')
    ])
    groups.value = groupResponse.groups
    users.value = recipientResponse.users
  } catch { toast.error('No se pudieron cargar los grupos', 'Intenta nuevamente.') }
  finally { loading.value = false }
}
onMounted(load)
function openCreate() { editingId.value = null; name.value = ''; memberIds.value = []; modalOpen.value = true }
function openEdit(group: Group) { editingId.value = group.id; name.value = group.name; memberIds.value = group.members.map(member => member.id); modalOpen.value = true }
function toggleMember(id: string) { memberIds.value = memberIds.value.includes(id) ? memberIds.value.filter(item => item !== id) : [...memberIds.value, id] }
async function save() {
  if (!name.value.trim() || saving.value) return
  saving.value = true
  try {
    if (editingId.value) await $fetch(`/api/notifications/groups/${editingId.value}`, { method: 'PUT', body: { name: name.value, userIds: memberIds.value } })
    else await $fetch('/api/notifications/groups', { method: 'POST', body: { name: name.value, userIds: memberIds.value } })
    modalOpen.value = false; await load(); toast.updated(editingId.value ? 'Grupo actualizado' : 'Grupo creado', 'Ya puedes seleccionarlo al registrar una actividad.')
  } catch (err: any) { toast.error('No se pudo guardar el grupo', err?.data?.statusMessage || 'Revisa los datos e inténtalo de nuevo.') }
  finally { saving.value = false }
}
async function remove(group: Group) {
  if (!window.confirm(`¿Eliminar el grupo “${group.name}”?`)) return
  try { await $fetch(`/api/notifications/groups/${group.id}`, { method: 'DELETE' }); groups.value = groups.value.filter(item => item.id !== group.id); toast.success('Grupo eliminado') }
  catch (err: any) { toast.error('No se pudo eliminar el grupo', err?.data?.statusMessage || 'Intenta nuevamente.') }
}
</script>

<template>
  <section class="settings-card">
    <div class="flex items-start justify-between gap-4"><div><h2>Grupos de notificación</h2><p>Reúne usuarios para avisarles juntos desde una actividad o automatización.</p></div><button type="button" class="settings-primary flex shrink-0 items-center gap-1.5" @click="openCreate"><Plus class="h-4 w-4" />Nuevo grupo</button></div>
    <div v-if="loading" class="mt-6 text-sm text-brand-text-muted">Cargando grupos…</div>
    <div v-else-if="!groups.length" class="mt-6 rounded border border-dashed border-brand-border px-5 py-8 text-center"><Users class="mx-auto h-7 w-7 text-brand-text-muted" /><p class="mt-2 text-sm text-brand-text-secondary">Todavía no hay grupos configurados.</p><button type="button" class="mt-3 text-sm font-semibold text-brand-blue hover:underline" @click="openCreate">Crear el primer grupo</button></div>
    <ul v-else class="mt-6 divide-y divide-brand-border-light rounded border border-brand-border-light"><li v-for="group in groups" :key="group.id" class="flex items-center justify-between gap-4 px-4 py-3"><div class="min-w-0"><strong class="block text-sm text-brand-text">{{ group.name }}</strong><span class="text-xs text-brand-text-muted">{{ group.members.length }} {{ group.members.length === 1 ? 'integrante' : 'integrantes' }}<span v-if="group.members.length"> · {{ group.members.slice(0, 3).map(member => member.label).join(', ') }}{{ group.members.length > 3 ? '…' : '' }}</span></span></div><div class="flex shrink-0 items-center gap-1"><button type="button" class="rounded p-2 text-brand-text-muted hover:bg-brand-bg hover:text-brand-blue" :aria-label="'Editar ' + group.name" @click="openEdit(group)"><Pencil class="h-4 w-4" /></button><button type="button" class="rounded p-2 text-brand-text-muted hover:bg-brand-error-bg hover:text-brand-error-text" :aria-label="'Eliminar ' + group.name" @click="remove(group)"><Trash2 class="h-4 w-4" /></button></div></li></ul>
  </section>

  <div v-if="modalOpen" class="fixed inset-0 z-[70] flex items-center justify-center bg-brand-text/30 p-4" role="presentation" @click.self="modalOpen = false">
    <section class="w-full max-w-lg overflow-hidden rounded-lg border border-brand-border-light bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="notification-group-title">
      <header class="flex items-center justify-between border-b border-brand-border-light px-5 py-4"><h2 id="notification-group-title" class="text-base font-bold text-brand-text">{{ editingId ? 'Editar grupo' : 'Nuevo grupo' }}</h2><button type="button" class="rounded p-1 text-brand-text-muted hover:bg-brand-bg" aria-label="Cerrar" @click="modalOpen = false"><X class="h-5 w-5" /></button></header>
      <div class="space-y-5 p-5"><label class="settings-field">Nombre del grupo<input v-model="name" autofocus placeholder="Ej. Supervisores de embarque" maxlength="100" /></label><fieldset><legend class="text-[13px] font-semibold text-brand-text">Integrantes</legend><p class="mb-2 mt-1 text-xs text-brand-text-muted">Solo los usuarios activos pueden recibir notificaciones.</p><div class="max-h-56 overflow-y-auto rounded border border-brand-border-light"><label v-for="user in users" :key="user.id" class="flex cursor-pointer items-center gap-3 border-b border-brand-border-light px-3 py-2.5 text-sm last:border-0 hover:bg-brand-bg"><input type="checkbox" :checked="memberIds.includes(user.id)" @change="toggleMember(user.id)" /><span><strong class="block text-brand-text">{{ user.label }}</strong><small class="text-xs text-brand-text-muted">{{ user.email }}</small></span></label><p v-if="!users.length" class="p-4 text-sm text-brand-text-muted">No hay usuarios activos.</p></div></fieldset></div>
      <footer class="flex justify-end gap-2 border-t border-brand-border-light px-5 py-3"><button type="button" class="settings-button" @click="modalOpen = false">Cancelar</button><button type="button" class="settings-primary" :disabled="!name.trim() || saving" @click="save">{{ saving ? 'Guardando…' : 'Guardar grupo' }}</button></footer>
    </section>
  </div>
</template>

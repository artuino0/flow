<script setup lang="ts">
import { ArrowLeft, Check, KeyRound, Save, ShieldCheck, UserRound, X } from '@lucide/vue'
import type { ChatPermissionKey, ResolvedChatPermissions } from '~/utils/chat'

definePageMeta({ layout: 'default' })
interface UserDetail { id: string; fullName: string | null; email: string; phone: string | null; jobTitle: string | null; timezone: string | null; roleId: string | null; roleName: string | null; isActive: boolean; createdAt: string; updatedAt: string }
interface RoleOption { id: string; name: string }
const route = useRoute()
const id = route.params.id as string
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data: detail, refresh } = await useFetch<UserDetail>(`/api/users/${id}`, { headers })
const { data: rolesData } = await useFetch<{ roles: RoleOption[] }>('/api/roles', { headers })
const { data: chatData, refresh: refreshChat } = await useFetch<ResolvedChatPermissions>(`/api/users/${id}/chat-permissions`, { headers })
const activeTab = ref<'profile' | 'access' | 'chat'>('profile')
const roleId = ref(detail.value?.roleId ?? '')
const isActive = ref(detail.value?.isActive ?? true)
const overrides = ref<ResolvedChatPermissions['overrides']>(chatData.value ? { ...chatData.value.overrides } : { canAccess: null, canStartDirect: null, canSendAttachments: null, canCreateGroups: null })
const saving = ref(false)
const confirmBlock = ref(false)
const toast = useToast()
watch(detail, value => { if (value) { roleId.value = value.roleId ?? ''; isActive.value = value.isActive } })
watch(chatData, value => { if (value) overrides.value = { ...value.overrides } })
const dirtyAccess = computed(() => roleId.value !== (detail.value?.roleId ?? '') || isActive.value !== detail.value?.isActive)
const dirtyChat = computed(() => Boolean(chatData.value && (Object.keys(overrides.value) as ChatPermissionKey[]).some(key => overrides.value[key] !== chatData.value!.overrides[key])))
const dirty = computed(() => dirtyAccess.value || dirtyChat.value)
const permissionRows: { key: ChatPermissionKey; title: string; description: string }[] = [
  { key: 'canAccess', title: 'Acceder al chat', description: 'Ver conversaciones existentes y responder mensajes.' },
  { key: 'canStartDirect', title: 'Iniciar chats directos', description: 'Comenzar conversaciones con otros trabajadores.' },
  { key: 'canSendAttachments', title: 'Enviar archivos', description: 'Adjuntar documentos e imágenes a los mensajes.' },
  { key: 'canCreateGroups', title: 'Crear grupos', description: 'Crear y administrar conversaciones grupales.' }
]
function effective(key: ChatPermissionKey) { return overrides.value[key] ?? chatData.value?.role[key] ?? false }
function setOverride(key: ChatPermissionKey, value: boolean | null) { if (key === 'canAccess' && value === false) confirmBlock.value = true; else overrides.value[key] = value }
async function save() {
  saving.value = true
  try {
    if (dirtyAccess.value) await $fetch(`/api/users/${id}`, { method: 'PUT', body: { roleId: roleId.value, isActive: isActive.value } })
    if (dirtyChat.value) await $fetch(`/api/users/${id}/chat-permissions`, { method: 'PUT', body: overrides.value })
    await Promise.all([refresh(), refreshChat()]); toast.updated('Usuario actualizado', 'Los cambios se guardaron correctamente.')
  } catch (error: any) { toast.error('No se pudieron guardar los cambios', error?.data?.statusMessage) }
  finally { saving.value = false }
}
function discard() { roleId.value = detail.value?.roleId ?? ''; isActive.value = detail.value?.isActive ?? true; if (chatData.value) overrides.value = { ...chatData.value.overrides } }
async function closeSessions() { try { const result = await $fetch<{ revokedSessions: number }>(`/api/users/${id}/sessions`, { method: 'DELETE' }); toast.success('Sesiones cerradas', `${result.revokedSessions} sesión(es) fueron cerradas.`) } catch (error: any) { toast.error('No se pudieron cerrar las sesiones', error?.data?.statusMessage) } }
</script>

<template>
  <div v-if="detail" class="mx-auto max-w-[1260px] pb-20">
    <div class="mb-5 flex items-center gap-3"><NuxtLink to="/usuarios" class="flex h-8 w-8 items-center justify-center rounded hover:bg-white"><ArrowLeft class="h-4 w-4 text-brand-text-secondary" /></NuxtLink><div><p class="text-xs text-brand-text-muted">Usuarios / Detalle</p><h1 class="text-xl font-bold text-brand-text">{{ detail.fullName || detail.email }}</h1></div></div>
    <div class="flex flex-col gap-5 md:flex-row">
      <aside class="h-fit w-full shrink-0 rounded-lg border border-brand-border-light bg-white p-3 md:w-64">
        <div class="mb-3 border-b border-brand-border-light px-3 pb-4"><ChatAvatar :name="detail.fullName || detail.email" size="lg" /><p class="mt-2 truncate text-sm font-bold text-brand-text">{{ detail.fullName || 'Usuario invitado' }}</p><p class="truncate text-xs text-brand-text-muted">{{ detail.email }}</p></div>
        <button v-for="item in [{ key: 'profile', label: 'Perfil', icon: UserRound }, { key: 'access', label: 'Acceso', icon: KeyRound }, { key: 'chat', label: 'Permisos de chat', icon: ShieldCheck }]" :key="item.key" class="mb-1 flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-sm font-medium" :class="activeTab === item.key ? 'bg-brand-sidebar-active-bg font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg'" @click="activeTab = item.key as any"><component :is="item.icon" class="h-4 w-4" />{{ item.label }}</button>
      </aside>

      <main class="min-w-0 flex-1">
        <section v-if="activeTab === 'profile'" class="rounded-lg border border-brand-border-light bg-white">
          <header class="border-b border-brand-border-light px-6 py-5"><h2 class="text-base font-bold text-brand-text">Perfil del trabajador</h2><p class="mt-1 text-sm text-brand-text-muted">Información registrada para esta organización.</p></header>
          <dl class="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2"><div><dt class="text-xs font-semibold text-brand-text-muted">Nombre completo</dt><dd class="mt-1 text-sm font-medium text-brand-text">{{ detail.fullName || 'Sin capturar' }}</dd></div><div><dt class="text-xs font-semibold text-brand-text-muted">Correo electrónico</dt><dd class="mt-1 text-sm font-medium text-brand-text">{{ detail.email }}</dd></div><div><dt class="text-xs font-semibold text-brand-text-muted">Teléfono</dt><dd class="mt-1 text-sm font-medium text-brand-text">{{ detail.phone || 'Sin capturar' }}</dd></div><div><dt class="text-xs font-semibold text-brand-text-muted">Puesto</dt><dd class="mt-1 text-sm font-medium text-brand-text">{{ detail.jobTitle || 'Sin capturar' }}</dd></div><div><dt class="text-xs font-semibold text-brand-text-muted">Zona horaria</dt><dd class="mt-1 text-sm font-medium text-brand-text">{{ detail.timezone || 'Predeterminada de la organización' }}</dd></div><div><dt class="text-xs font-semibold text-brand-text-muted">Miembro desde</dt><dd class="mt-1 text-sm font-medium text-brand-text">{{ new Date(detail.createdAt).toLocaleDateString('es-MX', { dateStyle: 'long' }) }}</dd></div></dl>
        </section>
        <section v-else-if="activeTab === 'access'" class="rounded-lg border border-brand-border-light bg-white">
          <header class="border-b border-brand-border-light px-6 py-5"><h2 class="text-base font-bold text-brand-text">Acceso y rol</h2><p class="mt-1 text-sm text-brand-text-muted">Controla lo que puede hacer el trabajador en FlowERP.</p></header>
          <div class="space-y-6 p-6"><div><label class="mb-1.5 block text-xs font-semibold text-brand-text-secondary">Rol</label><select v-model="roleId" class="h-10 w-full rounded border border-brand-border bg-white px-3 text-sm text-brand-text outline-none focus:border-brand-blue"><option v-for="role in rolesData?.roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></div><div class="flex items-center justify-between rounded border border-brand-border-light p-4"><div><p class="text-sm font-semibold text-brand-text">Acceso activo</p><p class="mt-1 text-xs text-brand-text-muted">Permite que este trabajador inicie sesión.</p></div><button class="flex h-6 w-11 items-center rounded-full p-0.5 transition" :class="isActive ? 'justify-end bg-brand-orange' : 'justify-start bg-[#CBD6E2]'" @click="isActive = !isActive"><span class="h-5 w-5 rounded-full bg-white shadow" /></button></div><div class="flex items-center justify-between rounded border border-brand-border-light p-4"><div><p class="text-sm font-semibold text-brand-text">Sesiones abiertas</p><p class="mt-1 text-xs text-brand-text-muted">Obliga a iniciar sesión nuevamente en todos sus dispositivos.</p></div><button class="rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text hover:bg-brand-bg" @click="closeSessions">Cerrar sesiones</button></div></div>
        </section>
        <section v-else class="rounded-lg border border-brand-border-light bg-white">
          <header class="border-b border-brand-border-light px-6 py-5"><h2 class="text-base font-bold text-brand-text">Permisos de chat</h2><p class="mt-1 text-sm text-brand-text-muted">Usa el rol como base y define excepciones solo cuando sean necesarias.</p></header>
          <div class="divide-y divide-brand-border-light">
            <div v-for="permission in permissionRows" :key="permission.key" class="flex flex-col gap-3 px-6 py-5 lg:flex-row lg:items-center lg:justify-between"><div><p class="text-sm font-semibold text-brand-text">{{ permission.title }}</p><p class="mt-1 text-xs text-brand-text-muted">{{ permission.description }}</p><p class="mt-1 text-[11px] font-medium" :class="effective(permission.key) ? 'text-brand-success-text' : 'text-brand-error-text'">Permiso efectivo: {{ effective(permission.key) ? 'Permitido' : 'Bloqueado' }}</p></div><div class="flex rounded border border-brand-border bg-brand-bg p-0.5"><button v-for="option in [{ value: null, label: 'Heredar' }, { value: true, label: 'Permitir' }, { value: false, label: 'Bloquear' }]" :key="String(option.value)" class="rounded px-3 py-1.5 text-xs font-semibold" :class="overrides[permission.key] === option.value ? option.value === false ? 'bg-white text-brand-error-text shadow-sm' : option.value === true ? 'bg-white text-brand-success-text shadow-sm' : 'bg-white text-brand-blue shadow-sm' : 'text-brand-text-muted'" @click="setOverride(permission.key, option.value)">{{ option.label }}</button></div></div>
          </div>
        </section>
      </main>
    </div>
    <div v-if="dirty" class="fixed bottom-0 right-0 z-30 flex items-center justify-between border-t border-brand-border-light bg-white px-6 py-4 shadow-[0_-2px_8px_#33475B12] md:left-60"><span class="text-xs font-medium text-brand-warning-text">Cambios sin guardar</span><div class="flex gap-3"><button class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text" @click="discard">Descartar</button><button class="flex items-center gap-2 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white" :disabled="saving" @click="save"><Save class="h-4 w-4" />{{ saving ? 'Guardando...' : 'Guardar cambios' }}</button></div></div>
    <Teleport to="body"><div v-if="confirmBlock" class="fixed inset-0 z-[100] flex items-center justify-center bg-[#33475B80] p-4"><div class="w-full max-w-md rounded-lg bg-white shadow-xl"><div class="flex items-start justify-between border-b border-brand-border-light p-5"><div><h3 class="text-base font-bold text-brand-text">Bloquear acceso al chat</h3><p class="mt-2 text-sm leading-5 text-brand-text-secondary">El historial se conservará, pero el usuario dejará de recibir mensajes y eventos del chat.</p></div><button @click="confirmBlock = false"><X class="h-4 w-4 text-brand-text-muted" /></button></div><div class="flex justify-end gap-3 p-4"><button class="rounded border border-brand-border px-4 py-2 text-sm font-semibold" @click="confirmBlock = false">Cancelar</button><button class="rounded bg-brand-error-text px-4 py-2 text-sm font-semibold text-white" @click="overrides.canAccess = false; confirmBlock = false">Bloquear</button></div></div></div></Teleport>
  </div>
  <p v-else class="text-sm text-brand-text-muted">Cargando usuario...</p>
</template>

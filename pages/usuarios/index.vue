<script setup lang="ts">
// HU-ERD-84: Screen/Usuarios del diseño real (ERPDinamico.pen), revisado con
// las herramientas de Pencil (regla pencil-antes-de-frontend) - hasta esta HU
// no existía NINGÚN backend para esta pantalla (solo el mock). Copy, columnas
// de la tabla (Usuario/Rol/Estado/Acciones) y el modal "Invitar usuario"
// (Correo electrónico + Rol, botón "Enviar invitación") tomados 1:1 del .pen.
// El correo de invitación (Email/Invitación Usuario, otro nodo del mismo
// .pen, revisado a pedido explícito del usuario) fija la ruta real del
// enlace: /invitacion/<token> (ver pages/invitacion/[token].vue).
//
// Adiciones fuera del mock (documentadas, mismo criterio que "Nuevo Rol" en
// pages/roles/index.vue): el mock solo dibuja 4 filas de ejemplo (3 Activo +
// 1 Invitación pendiente) con pencil+trash en Acciones, sin mostrar cómo se
// ve editar una fila ni qué pasa con una invitación vencida. Se interpretó:
// - Lápiz -> modal "Editar usuario" (rol + acceso activo/inactivo).
// - Basurero -> "Cancelar invitación" (borra la fila) si está pendiente, o
//   "Desactivar acceso" (isActive:false) si ya es una cuenta activa - el
//   mock no diferencia el ícono por estado, pero el backend sí distingue
//   ambas acciones (server/utils/users.ts).
// - Enlace "Reenviar" junto al estado, solo para invitaciones pendientes -
//   necesario funcionalmente (token vencido a los 7 días) y no contradice el
//   diseño, solo lo completa.
import { UserPlus, Pencil, Trash2, Clock, Send, X, ChevronDown, Check, Copy } from '@lucide/vue'

definePageMeta({ layout: 'default', darkReady: true })

type UserStatus = 'activo' | 'inactivo' | 'invitacion_pendiente'

interface UserRow {
  id: string
  email: string
  fullName: string | null
  roleId: string | null
  roleName: string | null
  isActive: boolean
  status: UserStatus
  createdAt: string
}

interface RoleOption {
  id: string
  name: string
}

const cookieHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const {
  data: usersData,
  pending: usersPending,
  error: usersError,
  refresh: refreshUsers
} = await useFetch<{ users: UserRow[] }>('/api/users', { key: 'users-list', headers: cookieHeaders })

const { data: rolesData } = await useFetch<{ roles: RoleOption[] }>('/api/roles', { key: 'users-roles', headers: cookieHeaders })

const users = computed(() => usersData.value?.users ?? [])
const search = ref('')
const filteredUsers = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return users.value
  return users.value.filter(user =>
    (user.fullName ?? '').toLowerCase().includes(term)
    || user.email.toLowerCase().includes(term)
    || (user.roleName ?? '').toLowerCase().includes(term)
    || user.status.toLowerCase().includes(term)
  )
})
const roles = computed(() => rolesData.value?.roles ?? [])

function initials(user: UserRow): string {
  const source = user.fullName?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

// --- Selector de rol generico (mismo patron manual sin libreria que
// pages/roles/index.vue, reusado en los 2 modales de abajo) ---
function roleName(roleId: string | null): string {
  return roles.value.find((r) => r.id === roleId)?.name ?? 'Selecciona un rol'
}

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts.
const toast = useToast()
// HU-ERD-104c: cada invitación cuenta contra la cuota de 'users' del plan -
// aviso al presionar "Invitar usuario", antes de abrir el modal, y mismo
// aviso si el servidor responde 402 al enviarla.
const { checkBeforeCreate, handlePlanLimitError } = usePlanLimit()

// --- Invitar usuario (Invite Modal del diseño) ---
const inviteOpen = ref(false)
const inviteEmail = ref('')
const inviteRoleId = ref<string | null>(null)
const inviteRoleSelectorOpen = ref(false)
const inviteError = ref<string | null>(null)
const inviting = ref(false)
const inviteUrl = ref<string | null>(null)
const inviteCopied = ref(false)

async function openInviteModal() {
  if (!await checkBeforeCreate('users')) return
  inviteEmail.value = ''
  inviteRoleId.value = roles.value[0]?.id ?? null
  inviteRoleSelectorOpen.value = false
  inviteError.value = null
  inviteUrl.value = null
  inviteCopied.value = false
  inviteOpen.value = true
}

async function copyInviteUrl() {
  if (!inviteUrl.value) return
  await navigator.clipboard.writeText(inviteUrl.value)
  inviteCopied.value = true
}

async function onInvite() {
  const email = inviteEmail.value.trim()
  if (!email) {
    inviteError.value = 'El correo es obligatorio'
    return
  }
  if (!inviteRoleId.value) {
    inviteError.value = 'Selecciona un rol'
    return
  }
  inviteError.value = null
  inviting.value = true
  try {
    const result = await $fetch<{ inviteUrl?: string }>('/api/users', { method: 'POST', body: { email, roleId: inviteRoleId.value } })
    inviteUrl.value = result.inviteUrl ?? null
    await refreshUsers()
    if (!result.inviteUrl) inviteOpen.value = false
    toast.success('Invitación enviada', `Se envió una invitación a ${email}.`)
  } catch (err: any) {
    if (await handlePlanLimitError(err)) {
      inviteOpen.value = false
      return
    }
    inviteError.value = err?.data?.statusMessage || 'No se pudo enviar la invitación'
    toast.error('No se pudo enviar la invitación', inviteError.value)
  } finally {
    inviting.value = false
  }
}

// --- Editar usuario (rol + acceso activo/inactivo) ---
const editOpen = ref(false)
const editUser = ref<UserRow | null>(null)
const editRoleId = ref<string | null>(null)
const editRoleSelectorOpen = ref(false)
const editIsActive = ref(true)
const editError = ref<string | null>(null)
const editSaving = ref(false)

function openEditModal(user: UserRow) {
  void navigateTo(`/usuarios/${user.id}`)
}

async function onSaveEdit() {
  if (!editUser.value) return
  editError.value = null
  editSaving.value = true
  try {
    await $fetch(`/api/users/${editUser.value.id}`, {
      method: 'PUT',
      body: { roleId: editRoleId.value ?? undefined, isActive: editIsActive.value }
    })
    await refreshUsers()
    editOpen.value = false
    toast.updated('Usuario actualizado', `Los cambios de ${editUser.value.email} se guardaron correctamente.`)
  } catch (err: any) {
    editError.value = err?.data?.statusMessage || 'No se pudieron guardar los cambios'
    toast.error('No se pudieron guardar los cambios', editError.value)
  } finally {
    editSaving.value = false
  }
}

// --- Confirmacion (cancelar invitacion / desactivar acceso) ---
const confirmOpen = ref(false)
const confirmTarget = ref<UserRow | null>(null)
const confirmError = ref<string | null>(null)
const confirmLoading = ref(false)

function openConfirm(user: UserRow) {
  confirmTarget.value = user
  confirmError.value = null
  confirmOpen.value = true
}

const confirmIsCancel = computed(() => confirmTarget.value?.status === 'invitacion_pendiente')

async function onConfirm() {
  if (!confirmTarget.value) return
  confirmError.value = null
  confirmLoading.value = true
  try {
    if (confirmIsCancel.value) {
      await $fetch(`/api/users/${confirmTarget.value.id}`, { method: 'DELETE' })
      toast.success('Invitación cancelada', `Se canceló la invitación de ${confirmTarget.value.email}.`)
    } else {
      await $fetch(`/api/users/${confirmTarget.value.id}`, { method: 'PUT', body: { isActive: false } })
      toast.updated('Usuario desactivado', `${confirmTarget.value.email} ya no puede acceder.`)
    }
    await refreshUsers()
    confirmOpen.value = false
  } catch (err: any) {
    confirmError.value = err?.data?.statusMessage || 'No se pudo completar la acción'
    toast.error('No se pudo completar la acción', confirmError.value)
  } finally {
    confirmLoading.value = false
  }
}

// --- Reenviar invitacion (no forma parte literal del mock, ver comentario
// de arriba - necesario porque el enlace vence a los 7 dias) ---
const resendingId = ref<string | null>(null)
const resendMessage = ref<string | null>(null)

async function onResend(user: UserRow) {
  resendingId.value = user.id
  resendMessage.value = null
  try {
    await $fetch(`/api/users/${user.id}/resend-invitation`, { method: 'POST' })
    resendMessage.value = `Invitación reenviada a ${user.email}`
  } catch (err: any) {
    resendMessage.value = err?.data?.statusMessage || 'No se pudo reenviar la invitación'
  } finally {
    resendingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <ListPageHeader
      v-model:search="search"
      title="Usuarios"
      description="Administra quién tiene acceso a esta organización y con qué rol."
      :count="users.length"
      count-noun="usuario"
      search-placeholder="Buscar usuarios..."
      :refreshing="usersPending"
      @refresh="refreshUsers"
    >
      <template #actions>
        <button
          type="button"
          class="flex h-[35px] items-center gap-1.5 rounded bg-brand-orange px-4 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover"
          @click="openInviteModal"
        >
          <UserPlus class="h-4 w-4" :stroke-width="1.75" />
          Invitar usuario
        </button>
      </template>
    </ListPageHeader>

    <p v-if="usersPending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="usersError" class="text-sm text-brand-error-text">
      No se pudo cargar el listado de usuarios{{ usersError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else>
      <p v-if="resendMessage" class="text-sm text-brand-text-secondary">{{ resendMessage }}</p>

      <p v-if="users.length === 0" class="text-sm text-brand-text-muted">Todavía no invitaste a nadie a esta organización.</p>
      <p v-else-if="filteredUsers.length === 0" class="text-sm text-brand-text-muted">Ningún usuario coincide con "{{ search }}".</p>

      <div v-else class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725)]">
        <table class="min-w-full text-sm">
          <thead class="border-b border-brand-border-light bg-brand-bg">
            <tr>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Usuario</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Rol</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Estado</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-border-light">
            <tr v-for="user in filteredUsers" :key="user.id" class="hover:bg-brand-bg">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-brand-blue-bg">
                    <span class="text-xs font-bold text-brand-blue">{{ initials(user) }}</span>
                  </div>
                  <div class="flex flex-col">
                    <span class="font-semibold text-brand-text">{{ user.fullName || user.email }}</span>
                    <span class="text-xs text-brand-text-muted">{{ user.email }}</span>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-brand-text">{{ user.roleName ?? 'Sin rol' }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-1.5">
                  <template v-if="user.status === 'invitacion_pendiente'">
                    <Clock class="h-2.5 w-2.5 text-brand-warning-text" :stroke-width="2.5" />
                    <span class="text-xs font-semibold text-brand-warning-text">Invitación pendiente</span>
                    <button
                      type="button"
                      :disabled="resendingId === user.id"
                      class="ml-1 text-xs font-semibold text-brand-blue hover:underline disabled:opacity-60"
                      @click="onResend(user)"
                    >
                      {{ resendingId === user.id ? 'Reenviando...' : 'Reenviar' }}
                    </button>
                  </template>
                  <span v-else class="flex items-center gap-1.5" :class="user.status === 'activo' ? 'text-brand-success-text' : 'text-brand-neutral-text'">
                    <span class="h-1.5 w-1.5 rounded-full bg-current" />
                    <span class="text-xs font-semibold">{{ user.status === 'activo' ? 'Activo' : 'Inactivo' }}</span>
                  </span>
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    title="Editar usuario"
                    class="flex h-7 w-7 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg"
                    @click="openEditModal(user)"
                  >
                    <Pencil class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                  <button
                    type="button"
                    :title="user.status === 'invitacion_pendiente' ? 'Cancelar invitación' : 'Desactivar acceso'"
                    class="flex h-7 w-7 items-center justify-center rounded text-brand-error-text hover:bg-brand-bg"
                    @click="openConfirm(user)"
                  >
                    <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Modal "Invitar usuario" (Invite Modal del diseño) -->
    <div v-if="inviteOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-modal-overlay/40 p-4">
      <div class="flex w-full max-w-[440px] flex-col rounded-lg bg-brand-surface shadow-xl">
        <div class="relative border-b border-brand-border-light p-5">
          <h2 class="text-[15px] font-bold text-brand-text">Invitar usuario</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Le enviaremos una invitación por correo</p>
          <button
            type="button"
            title="Cerrar"
            class="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg"
            @click="inviteOpen = false"
          >
            <X class="h-4 w-4" :stroke-width="1.75" />
          </button>
        </div>

        <div class="flex flex-col gap-5 p-5">
          <div class="flex flex-col gap-1.5">
            <label for="invite-email" class="text-xs font-semibold text-brand-text-secondary">Correo electrónico</label>
            <input
              id="invite-email"
              v-model="inviteEmail"
              type="email"
              placeholder="nuevo.usuario@acme.com"
              class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:border-brand-orange focus:outline-none"
              @keydown.enter="onInvite"
            />
            <p class="text-xs text-brand-text-muted">Se le enviará un enlace de invitación a este correo</p>
          </div>

          <div class="relative flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-brand-text-secondary">Rol</label>
            <button
              type="button"
              class="flex items-center justify-between rounded border border-brand-border bg-brand-surface px-3 py-2"
              @click="inviteRoleSelectorOpen = !inviteRoleSelectorOpen"
            >
              <span class="text-sm text-brand-text">{{ roleName(inviteRoleId) }}</span>
              <ChevronDown class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            </button>
            <div
              v-if="inviteRoleSelectorOpen"
              class="absolute left-0 top-full z-10 mt-1.5 flex max-h-[220px] w-full flex-col gap-0.5 overflow-y-auto rounded-lg border border-brand-border-light bg-brand-surface p-1.5 shadow-[0_4px_16px_0_rgb(var(--brand-shadow)/0.2)]"
            >
              <button
                v-for="role in roles"
                :key="role.id"
                type="button"
                class="flex items-center justify-between rounded px-2.5 py-2 text-left text-sm"
                :class="role.id === inviteRoleId ? 'bg-brand-sidebar-active-bg font-bold text-brand-blue' : 'font-medium text-brand-text hover:bg-brand-bg'"
                @click="inviteRoleId = role.id; inviteRoleSelectorOpen = false"
              >
                {{ role.name }}
                <Check v-if="role.id === inviteRoleId" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
              </button>
            </div>
          </div>

          <div v-if="inviteUrl" class="flex flex-col gap-2 rounded border border-brand-border-light bg-brand-bg p-3">
            <label for="invite-url" class="text-xs font-semibold text-brand-text-secondary">Enlace de invitación</label>
            <div class="flex items-center gap-2">
              <input id="invite-url" :value="inviteUrl" readonly class="min-w-0 flex-1 rounded border border-brand-border bg-brand-surface px-2 py-1.5 text-xs text-brand-text" />
              <button type="button" class="flex shrink-0 items-center gap-1.5 rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-brand-primary-fg hover:bg-brand-orange-hover" @click="copyInviteUrl">
                <Copy class="h-3.5 w-3.5" :stroke-width="1.75" />
                {{ inviteCopied ? 'Copiado' : 'Copiar' }}
              </button>
            </div>
          </div>

          <p v-if="inviteError" class="text-sm text-brand-error-text">{{ inviteError }}</p>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="inviteOpen = false">
            Cancelar
          </button>
          <button
            type="button"
            :disabled="inviting"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onInvite"
          >
            <Send class="h-4 w-4" :stroke-width="1.75" />
            {{ inviting ? 'Enviando...' : 'Enviar invitación' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal "Editar usuario" (fuera del mock literal - ver comentario largo arriba) -->
    <div v-if="editOpen && editUser" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-modal-overlay/40 p-4">
      <div class="flex w-full max-w-[440px] flex-col rounded-lg bg-brand-surface shadow-xl">
        <div class="relative border-b border-brand-border-light p-5">
          <h2 class="text-[15px] font-bold text-brand-text">Editar usuario</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">{{ editUser.email }}</p>
          <button
            type="button"
            title="Cerrar"
            class="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg"
            @click="editOpen = false"
          >
            <X class="h-4 w-4" :stroke-width="1.75" />
          </button>
        </div>

        <div class="flex flex-col gap-5 p-5">
          <div class="relative flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-brand-text-secondary">Rol</label>
            <button
              type="button"
              class="flex items-center justify-between rounded border border-brand-border bg-brand-surface px-3 py-2"
              @click="editRoleSelectorOpen = !editRoleSelectorOpen"
            >
              <span class="text-sm text-brand-text">{{ roleName(editRoleId) }}</span>
              <ChevronDown class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            </button>
            <div
              v-if="editRoleSelectorOpen"
              class="absolute left-0 top-full z-10 mt-1.5 flex max-h-[220px] w-full flex-col gap-0.5 overflow-y-auto rounded-lg border border-brand-border-light bg-brand-surface p-1.5 shadow-[0_4px_16px_0_rgb(var(--brand-shadow)/0.2)]"
            >
              <button
                v-for="role in roles"
                :key="role.id"
                type="button"
                class="flex items-center justify-between rounded px-2.5 py-2 text-left text-sm"
                :class="role.id === editRoleId ? 'bg-brand-sidebar-active-bg font-bold text-brand-blue' : 'font-medium text-brand-text hover:bg-brand-bg'"
                @click="editRoleId = role.id; editRoleSelectorOpen = false"
              >
                {{ role.name }}
                <Check v-if="role.id === editRoleId" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <p class="text-sm font-semibold text-brand-text">Acceso activo</p>
              <p class="text-xs text-brand-text-muted">Si lo desactivás, no va a poder iniciar sesión</p>
            </div>
            <button
              type="button"
              class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
              :class="editIsActive ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
              @click="editIsActive = !editIsActive"
            >
              <span class="h-[18px] w-[18px] rounded-full bg-brand-switch-thumb shadow" />
            </button>
          </div>

          <p v-if="editError" class="text-sm text-brand-error-text">{{ editError }}</p>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="editOpen = false">
            Cancelar
          </button>
          <button
            type="button"
            :disabled="editSaving"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSaveEdit"
          >
            {{ editSaving ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Confirmacion: cancelar invitacion / desactivar acceso -->
    <div v-if="confirmOpen && confirmTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-modal-overlay/40 p-4">
      <div class="flex w-full max-w-[400px] flex-col gap-5 rounded-lg bg-brand-surface p-5 shadow-xl">
        <div class="flex flex-col gap-1">
          <h2 class="text-[15px] font-bold text-brand-text">
            {{ confirmIsCancel ? 'Cancelar invitación' : 'Desactivar acceso' }}
          </h2>
          <p class="text-sm text-brand-text-secondary">
            {{
              confirmIsCancel
                ? `Se cancelará la invitación pendiente para ${confirmTarget.email}. Podés volver a invitarla más tarde.`
                : `${confirmTarget.fullName || confirmTarget.email} no va a poder iniciar sesión hasta que reactivés su acceso.`
            }}
          </p>
        </div>
        <p v-if="confirmError" class="text-sm text-brand-error-text">{{ confirmError }}</p>
        <div class="flex items-center justify-end gap-3">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="confirmOpen = false">
            Volver
          </button>
          <button
            type="button"
            :disabled="confirmLoading"
            class="rounded bg-brand-error-text px-4 py-2 text-sm font-semibold text-brand-error-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            @click="onConfirm"
          >
            {{ confirmLoading ? 'Aplicando...' : 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
input, textarea, select { color-scheme: inherit; }
</style>

<script setup lang="ts">
// HU-ERD-21: layout base (header + sidebar + contenido). Las pantallas
// autenticadas (dashboard, listados, formularios dinamicos) se montan
// dentro del <slot />.
// HU-ERD-22: nombre del usuario autenticado + logout.
//
// Diseno Pencil (ERPDinamico.pen): aplicado aca por primera vez a todo el
// layout autenticado (antes solo pages/login.vue seguia el diseno real, ver
// componente AppHeader del .pen). No hay endpoint de nombre de tenant hoy
// (AuthUser solo trae tenantId, no un nombre legible) - se omite el chip de
// "Acme S.A." del diseno en vez de inventar un dato que el backend no expone.
import { Boxes, Bell, LogOut, ChevronDown, PanelLeftClose } from '@lucide/vue'

const { user, logout } = useAuth()

// HU-ERD-83 (parte 2): sesion deslizante + aviso de inactividad - ver
// composables/useIdleTimeout.ts. Solo tiene sentido en el layout autenticado
// (login.vue usa layout: false).
const { showWarning, countdown, confirmActive } = useIdleTimeout(async () => {
  await onLogout('inactividad')
})

const initials = computed(() => {
  const source = user.value?.fullName || user.value?.email || ''
  const parts = source.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
})

async function onLogout(reason?: 'inactividad') {
  await logout()
  await navigateTo(reason ? `/login?reason=${reason}` : '/login')
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-brand-bg font-sans">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-brand-border-light bg-brand-surface px-6">
      <div class="flex items-center gap-2.5">
        <div class="flex h-7 w-7 items-center justify-center rounded-md bg-brand-blue">
          <Boxes class="h-4 w-4 text-white" :stroke-width="2" />
        </div>
        <span class="text-base font-bold text-brand-text">ERP Dinámico</span>
      </div>

      <div class="flex items-center gap-4">
        <button
          type="button"
          title="Notificaciones"
          class="flex h-8 w-8 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg"
        >
          <Bell class="h-[17px] w-[17px]" :stroke-width="1.75" />
        </button>

        <div class="h-6 w-px bg-brand-border-light" />

        <NuxtLink to="/mi-cuenta" class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-brand-bg">
          <div class="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-brand-blue-bg">
            <span class="text-xs font-bold text-brand-blue">{{ initials }}</span>
          </div>
          <span v-if="user" class="text-sm font-semibold text-brand-text">{{ user.fullName || user.email }}</span>
          <ChevronDown class="h-[15px] w-[15px] text-brand-text-muted" :stroke-width="2" />
        </NuxtLink>

        <button
          type="button"
          class="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg"
          @click="onLogout()"
        >
          <LogOut class="h-4 w-4" :stroke-width="2" />
          Salir
        </button>
      </div>
    </header>

    <!-- HU-ERD-83 (parte 2): ver composables/useIdleTimeout.ts -->
    <InactivityWarningModal v-if="showWarning" :countdown="countdown" @confirm="confirmActive" />

    <div class="flex flex-1">
      <aside class="hidden w-60 shrink-0 flex-col border-r border-brand-border-light bg-brand-surface sm:flex">
        <div class="flex items-center justify-between border-b border-brand-border-light px-4 py-3.5">
          <span class="text-xs font-bold tracking-wide text-brand-text-muted">MENÚ</span>
          <div class="flex h-[26px] w-[26px] items-center justify-center rounded text-brand-text-secondary">
            <PanelLeftClose class="h-4 w-4" :stroke-width="1.75" />
          </div>
        </div>
        <div class="flex flex-1 flex-col gap-px p-2.5">
          <AppNav />
        </div>
      </aside>

      <main class="flex-1 overflow-x-auto p-8">
        <slot />
      </main>
    </div>
  </div>
</template>

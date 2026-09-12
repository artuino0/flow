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
import { Bell, LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen, Menu, X } from '@lucide/vue'

const { user, logout } = useAuth()

// Bug reportado por el usuario (2026-09-07): "el menu no se colapsa tiene el
// icono pero no funciona" - el icono `panel-left-close` de la barra "MENÚ"
// (fiel al mock: `Sidebar/Top` en el .pen lo dibuja como un `IconButton`
// real, ver R8Du5) se habia dejado como un <div> decorativo sin @click ni
// estado, nunca se terminó de conectar. El .pen no diseña un estado
// "colapsado" del Sidebar (ningún mock alternativo, revisado con las
// herramientas de Pencil) - se implementa el patrón estándar de "colapsar a
// riel angosto" (solo el botón, sin MENÚ/items) en vez de ocultar el aside
// por completo, para que el botón de reabrir siga siempre visible en el
// mismo lugar. Persistido en localStorage con el mismo criterio que
// sectionsOpen de AppNav.vue (preferencia de navegador, no dato de negocio).
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'flowerp-sidebar-collapsed'
const sidebarCollapsed = ref(false)
const mobileMenuOpen = ref(false)
const navRoute = useRoute()
watch(() => navRoute.path, () => { mobileMenuOpen.value = false })
onMounted(() => {
  try {
    sidebarCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    // localStorage no disponible - se queda con el default (expandido).
  }
})
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed.value ? '1' : '0')
  } catch {
    // idem - si no se puede persistir, el toggle igual funciona para esta sesion.
  }
}

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
      <div class="flex items-center gap-2">
        <button type="button" aria-label="Abrir menú" :aria-expanded="mobileMenuOpen" class="rounded p-1 text-brand-text-secondary sm:hidden" @click="mobileMenuOpen = true; sidebarCollapsed = false"><Menu class="h-5 w-5" /></button>
        <img src="/brand/isotipo.png" alt="FlowERP" class="h-7 w-7 object-contain" />
        <span class="text-base font-bold text-brand-text">FlowERP</span>
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

    <!-- HU-ERD-83 (parte 2): ver composables/useIdleTimeout.ts. "Cerrar
    sesión" (rediseño del modal, ver InactivityWarningModal.vue) es una
    salida deliberada del usuario, no un cierre automatico por timeout - no
    manda reason=inactividad como sí hace onTimeout(). -->
    <InactivityWarningModal
      v-if="showWarning"
      :countdown="countdown"
      :total="WARNING_DURATION_SECONDS"
      @confirm="confirmActive"
      @logout="onLogout()"
    />

    <div class="flex flex-1">
      <button v-if="mobileMenuOpen" type="button" aria-label="Cerrar menú" class="fixed inset-0 z-30 bg-black/30 sm:hidden" @click="mobileMenuOpen = false" />
      <aside
        class="shrink-0 flex-col border-r border-brand-border-light bg-brand-surface transition-[width] duration-150 sm:static sm:flex"
        :class="[sidebarCollapsed ? 'w-16' : 'w-60', mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 flex overflow-y-auto' : 'hidden']"
        @keydown.esc="mobileMenuOpen = false"
      >
        <div class="flex items-center border-b border-brand-border-light py-3.5" :class="sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'">
          <span v-if="!sidebarCollapsed" class="text-xs font-bold tracking-wide text-brand-text-muted">MENÚ</span>
          <button v-if="mobileMenuOpen" type="button" aria-label="Cerrar menú" class="rounded p-1 text-brand-text-secondary sm:hidden" @click="mobileMenuOpen = false"><X class="h-4 w-4" /></button>
          <button
            type="button"
            :title="sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'"
            class="flex h-[26px] w-[26px] items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg"
            @click="toggleSidebar"
          >
            <PanelLeftOpen v-if="sidebarCollapsed" class="h-4 w-4" :stroke-width="1.75" />
            <PanelLeftClose v-else class="h-4 w-4" :stroke-width="1.75" />
          </button>
        </div>
        <div class="flex flex-1 flex-col gap-px overflow-y-auto p-2.5">
          <AppNav :compact="sidebarCollapsed" />
        </div>
      </aside>

      <main class="flex-1 overflow-x-auto p-8">
        <slot />
      </main>
    </div>

    <!-- Pedido directo del usuario ("aplica los toast, checa donde deben ir"):
    montado una sola vez aca (layout autenticado) para que cualquier pantalla
    de adentro pueda usar useToast() sin volver a declarar el contenedor - ver
    components/ToastContainer.vue. -->
    <ToastContainer />
  </div>
</template>

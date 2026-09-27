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
import { LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen, Menu, X, Settings, MessageCircle } from '@lucide/vue'

const { user, logout } = useAuth()
const chat = useChat()
const { dirty: settingsDirty, saveHandler, discardHandler } = useSettingsDirty()
const { dialog: confirmDialog, settle: settleConfirm } = useConfirm()

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
const profileMenuOpen = ref(false)
const navRoute = useRoute()
const { activeKey } = useFlowApps()
const editorFullscreen = computed(() => navRoute.meta.editorFullscreen === true)
// El chat es una superficie de trabajo de borde a borde. A diferencia de
// formularios y listados, no debe heredar el padding ni el scroll general del
// layout: sus propios paneles controlan el desplazamiento interno.
const fullBleedRoute = computed(() => navRoute.meta.fullBleed === true || navRoute.path === '/chat' || navRoute.path.startsWith('/chat/') || navRoute.path === '/sites' || navRoute.path.startsWith('/sites/'))
watch(() => navRoute.path, () => { mobileMenuOpen.value = false; profileMenuOpen.value = false })
onMounted(() => {
  try {
    sidebarCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    // localStorage no disponible - se queda con el default (expandido).
  }
  window.addEventListener('click', closeProfileMenu)
  void chat.initialize()
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeProfileMenu)
  chat.dispose()
})
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed.value ? '1' : '0')
  } catch {
    // idem - si no se puede persistir, el toggle igual funciona para esta sesion.
  }
}

function closeProfileMenu(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-profile-menu]')) profileMenuOpen.value = false
}

// HU-ERD-83 (parte 2): sesion deslizante + aviso de inactividad - ver
// composables/useIdleTimeout.ts. Solo tiene sentido en el layout autenticado
// (login.vue usa layout: false).
const { showWarning, countdown, warningSeconds, confirmActive } = useIdleTimeout(async () => {
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
  <div class="flex h-screen flex-col overflow-hidden bg-brand-bg font-sans">
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-brand-border-light bg-brand-surface px-6">
      <div class="flex items-center gap-2">
        <button v-if="!editorFullscreen" type="button" aria-label="Abrir menú" :aria-expanded="mobileMenuOpen" class="rounded p-1 text-brand-text-secondary sm:hidden" @click="mobileMenuOpen = true; sidebarCollapsed = false"><Menu class="h-5 w-5" /></button>
        <img src="/brand/isotipo.png" alt="Flow" class="h-7 w-7 object-contain" />
        <span class="text-base font-bold text-brand-text">Flow</span>
        <div class="mx-1 hidden h-5 w-px bg-brand-border-light sm:block" />
        <FlowAppLauncher v-if="!editorFullscreen" />
      </div>

      <GlobalSearch />
      <div class="flex items-center gap-2 sm:gap-4">
        <NuxtLink v-if="chat.canAccess.value" to="/chat" aria-label="Abrir chat" class="relative flex h-8 w-8 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/25">
          <MessageCircle class="h-[18px] w-[18px]" :stroke-width="1.75" />
          <span v-if="chat.unreadCount.value" class="absolute -right-1.5 -top-1.5 flex min-w-[17px] items-center justify-center rounded-full bg-brand-orange px-1 text-[9px] font-bold leading-[17px] text-white">{{ chat.unreadCount.value > 99 ? '99+' : chat.unreadCount.value }}</span>
        </NuxtLink>
        <NotificationCenter />

        <div class="h-6 w-px bg-brand-border-light" />

        <div class="relative" data-profile-menu>
          <button
            type="button"
            aria-label="Abrir menú de cuenta"
            :aria-expanded="profileMenuOpen"
            class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-brand-bg"
            @click.stop="profileMenuOpen = !profileMenuOpen"
          >
            <div class="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-brand-blue-bg">
              <span class="text-xs font-bold text-brand-blue">{{ initials }}</span>
            </div>
            <span v-if="user" class="hidden text-sm font-semibold text-brand-text sm:inline">{{ user.fullName || user.email }}</span>
            <ChevronDown class="h-[15px] w-[15px] text-brand-text-muted transition-transform" :class="profileMenuOpen ? 'rotate-180' : ''" :stroke-width="2" />
          </button>

          <div v-if="profileMenuOpen" class="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-brand-border-light bg-white py-1 shadow-[0_8px_24px_#33475B22]">
            <div class="border-b border-brand-border-light px-4 py-3">
              <p class="truncate text-sm font-semibold text-brand-text">{{ user?.fullName || user?.email }}</p>
              <p v-if="user?.fullName" class="truncate text-xs text-brand-text-muted">{{ user.email }}</p>
            </div>
            <NuxtLink to="/ajustes?section=perfil" class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-brand-text-secondary hover:bg-brand-bg">
              <Settings class="h-4 w-4 text-brand-text-muted" :stroke-width="1.8" />
              Ajustes de cuenta
            </NuxtLink>
            <button type="button" class="flex w-full items-center gap-3 border-t border-brand-border-light px-4 py-3 text-left text-sm font-medium text-brand-text-secondary hover:bg-brand-bg" @click="onLogout()">
              <LogOut class="h-4 w-4 text-brand-text-muted" :stroke-width="1.8" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- HU-ERD-83 (parte 2): ver composables/useIdleTimeout.ts. "Cerrar
    sesión" (rediseño del modal, ver InactivityWarningModal.vue) es una
    salida deliberada del usuario, no un cierre automatico por timeout - no
    manda reason=inactividad como sí hace onTimeout(). -->
    <InactivityWarningModal
      v-if="showWarning"
      :countdown="countdown"
      :total="warningSeconds"
      @confirm="confirmActive"
      @logout="onLogout()"
    />
    <SettingsConfirmDialog
      v-if="confirmDialog"
      :title="confirmDialog.title"
      :confirm-label="confirmDialog.confirmLabel"
      :cancel-label="confirmDialog.cancelLabel"
      :destructive="confirmDialog.destructive"
      @cancel="settleConfirm(false)"
      @confirm="settleConfirm(true)"
    >{{ confirmDialog.message }}</SettingsConfirmDialog>

    <div class="relative flex min-h-0 flex-1">
      <button v-if="mobileMenuOpen" type="button" aria-label="Cerrar menú" class="fixed inset-0 z-30 bg-black/30 sm:hidden" @click="mobileMenuOpen = false" />
      <aside
        v-if="!editorFullscreen"
        class="z-20 h-full shrink-0 flex-col border-r border-brand-border-light bg-brand-surface transition-[width] duration-150 sm:static sm:flex"
        :class="[sidebarCollapsed ? 'w-16' : activeKey === 'sites' ? 'w-60' : 'w-80', mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 flex overflow-y-auto' : 'hidden']"
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
        <div class="sidebar-scroll flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overflow-x-hidden p-2.5">
          <AppNav :compact="sidebarCollapsed" />
        </div>
      </aside>

      <main class="min-h-0 min-w-0 flex-1" :class="fullBleedRoute ? 'overflow-hidden p-0' : editorFullscreen ? 'overflow-auto p-0' : 'overflow-auto p-8 pb-24'">
        <slot />
      </main>
    </div>

    <div v-if="settingsDirty" class="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between gap-4 border-t border-brand-border-light bg-white px-6 py-4 shadow-[0_-2px_8px_#33475B12]" :class="sidebarCollapsed ? 'sm:left-16' : activeKey === 'sites' ? 'sm:left-60' : 'sm:left-80'">
      <span class="text-xs font-medium text-brand-warning-text">Cambios sin guardar</span>
      <div class="flex gap-3"><button class="rounded border border-brand-border px-4 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="discardHandler?.()">Descartar</button><button class="rounded bg-brand-orange px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover" @click="saveHandler?.()">Guardar cambios</button></div>
    </div>

    <ChatFloatingDock />

    <!-- Pedido directo del usuario ("aplica los toast, checa donde deben ir"):
    montado una sola vez aca (layout autenticado) para que cualquier pantalla
    de adentro pueda usar useToast() sin volver a declarar el contenedor - ver
    components/ToastContainer.vue. -->
    <ToastContainer />
  </div>
</template>

<style scoped>
.sidebar-scroll { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.sidebar-scroll::-webkit-scrollbar-button { display: none; }
</style>



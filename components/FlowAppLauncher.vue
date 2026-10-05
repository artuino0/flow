<script setup lang="ts">
import { ChevronDown, LockKeyhole, SlidersHorizontal } from '@lucide/vue'
import { FLOW_APP_LIST, type FlowAppKey } from '~/utils/flowApps'

const { activeKey, activeApp, openApp } = useFlowApps()
const chat = useChat()
const open = ref(false)
const { data: access, load: loadAccess } = useFlowAppAccess()
await loadAccess()
const { data: isAdmin } = await useIsAdmin()
const availability = computed(() => new Map((access.value?.apps ?? []).map(app => [app.key, app])))
const appRows = computed(() => FLOW_APP_LIST.map(app => ({
  ...app,
  enabled: availability.value.get(app.key)?.enabled ?? false,
  accessible: availability.value.get(app.key)?.accessible ?? false
})))
const canAccessSites = () => Boolean(availability.value.get('sites')?.enabled && availability.value.get('sites')?.accessible)
const { data: siteData } = useShellResource<{ sites: Array<{ id: string }> }>('flow-app-launcher-sites', '/api/sites', canAccessSites)

function badge(key: FlowAppKey) { return key === 'communications' ? chat.unreadCount.value : 0 }
function state(app: { key: FlowAppKey; enabled: boolean; accessible: boolean }) {
  if (!app.enabled) return { label: 'No activada', pending: false }
  if (!app.accessible) return { label: 'Sin permiso', pending: false }
  if (app.key === 'sites' && siteData.value?.sites.length === 0) return { label: 'Configuración pendiente', pending: true }
  return null
}
async function select(app: { key: FlowAppKey; enabled: boolean; accessible: boolean }) {
  if (!app.enabled || !app.accessible) return
  open.value = false
  await openApp(app.key)
}
function closeOnOutside(event: MouseEvent) { if (!(event.target as HTMLElement).closest('[data-flow-app-launcher]')) open.value = false }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false }
onMounted(() => { window.addEventListener('click', closeOnOutside); window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { window.removeEventListener('click', closeOnOutside); window.removeEventListener('keydown', onKeydown) })
</script>

<template>
  <div class="relative" data-flow-app-launcher>
    <button
      type="button"
      class="group flex h-9 items-center gap-2 rounded-md border border-transparent px-2 text-brand-text-secondary transition-colors hover:border-brand-border-light hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/25"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="Cambiar aplicación de Flow"
      @click.stop="open = !open"
    >
      <span class="relative grid grid-cols-3 gap-[2px]" aria-hidden="true">
        <span v-for="cell in 6" :key="cell" class="h-[4px] w-[4px] rounded-[1px] bg-current" />
        <span v-if="chat.unreadCount.value" class="absolute -right-2.5 -top-2.5 flex min-w-[17px] items-center justify-center rounded-full bg-brand-orange px-1 text-[9px] font-bold leading-[17px] text-brand-primary-fg">{{ chat.unreadCount.value > 99 ? '99+' : chat.unreadCount.value }}</span>
      </span>
      <span class="hidden text-sm font-semibold md:inline">{{ activeApp.label }}</span>
      <ChevronDown class="hidden h-3.5 w-3.5 transition-transform md:block" :class="open ? 'rotate-180' : ''" />
    </button>

    <div v-if="open" class="absolute left-0 top-full z-[80] mt-2 w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_14px_34px_rgba(33,61,94,.17)]" role="menu">
      <div class="flex min-h-[72px] items-center gap-3 border-b border-brand-border-light px-5 py-4">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-blue">
          <img src="/brand/isotipo-white.png" alt="" class="h-5 w-5 object-contain" />
        </span>
        <div>
          <p class="text-base font-bold leading-5 text-brand-text">Aplicaciones</p>
          <p class="mt-0.5 text-xs leading-4 text-brand-text-secondary">Cambia de área de trabajo</p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-x-4 gap-y-1.5 p-4 sm:grid-cols-2">
        <button
          v-for="app in appRows"
          :key="app.key"
          type="button"
          role="menuitem"
          :disabled="!app.enabled || !app.accessible"
          class="group/app relative flex min-h-[58px] items-center gap-2.5 overflow-hidden rounded-md px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/25 disabled:cursor-not-allowed"
          :class="activeKey === app.key ? 'bg-brand-sidebar-active-bg pl-4' : app.enabled && app.accessible ? 'hover:bg-brand-bg' : 'opacity-55'"
          @click="select(app)"
        >
          <span v-if="activeKey === app.key" class="absolute inset-y-2.5 left-2.5 w-1 rounded-full bg-brand-orange" />
          <span class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-bg text-brand-text-secondary group-hover/app:bg-brand-surface" :class="activeKey === app.key ? 'bg-brand-surface text-brand-blue' : ''">
            <LockKeyhole v-if="app.enabled && !app.accessible" class="h-4 w-4" :stroke-width="1.75" />
            <component v-else :is="app.icon" class="h-4 w-4" :stroke-width="1.75" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-sm font-semibold leading-5" :class="activeKey === app.key ? 'text-brand-blue' : 'text-brand-text'">
              {{ app.label }}
              <span v-if="badge(app.key)" class="flex min-w-[22px] items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10px] font-bold leading-5 text-brand-primary-fg">{{ badge(app.key) > 99 ? '99+' : badge(app.key) }}</span>
            </span>
            <span class="block text-xs leading-4" :class="state(app)?.pending ? 'text-brand-app-pending-text' : state(app) ? 'text-brand-text-muted' : 'text-brand-text-secondary'">{{ state(app)?.label || app.description }}</span>
          </span>
          <span v-if="state(app)?.pending" class="h-2 w-2 shrink-0 rounded-full bg-brand-app-pending-dot" aria-label="Configuración pendiente" />
        </button>
      </div>

      <NuxtLink v-if="isAdmin" to="/roles" class="flex min-h-10 items-center gap-2.5 border-t border-brand-border-light px-5 text-sm font-semibold text-brand-text-muted transition hover:bg-brand-bg hover:text-brand-blue" @click="open = false">
        <SlidersHorizontal class="h-4 w-4" :stroke-width="1.75" />
        Administrar aplicaciones
      </NuxtLink>
    </div>
  </div>
</template>


<script setup lang="ts">
import { LayoutDashboard, ShieldCheck, Blocks, Users, Zap, Library, ChevronDown, BarChart3, FolderTree, MessageCircle, ReceiptText } from '@lucide/vue'
import type { NavigationEntity, NavigationNode } from '~/utils/moduleNavigation'
import AppNavGroup from '~/components/AppNavGroup.vue'
import AppNavEntity from '~/components/AppNavEntity.vue'
defineProps<{ compact?: boolean }>()
const chat = useChat()
onMounted(() => chat.initialize())
onBeforeUnmount(() => chat.dispose())
const { data: nav } = await useFetch<{ groups: NavigationNode[]; unassigned: NavigationEntity[] }>('/api/nav/entities', {
  key: 'appnav-modules', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const { data: isAdmin } = await useIsAdmin()
const { user } = useAuth()
const sections = computed(() => [
  { key: 'general', label: 'GENERAL', items: [
    { label: 'Tablero', to: '/', icon: LayoutDashboard },
    ...(chat.canAccess.value ? [{ label: 'Chat', to: '/chat', icon: MessageCircle, badge: chat.unreadCount.value }] : []),
    // Dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md, decisión #3):
    // Facturación solo para admins de organizaciones mexicanas; los
    // endpoints /api/facturacion/* y /api/tenant/pac/* cortan con 404 fuera de MX.
    ...(isAdmin.value && user.value?.country === 'MX' ? [{ label: 'Facturación', to: '/facturacion', icon: ReceiptText }] : [])
  ] },
  { key: 'reportes', label: 'REPORTES', items: isAdmin.value ? [{ label: 'Reportes', to: '/reportes/nuevo', icon: BarChart3 }] : [] },
  { key: 'administracion', label: 'ADMINISTRACIÓN', items: isAdmin.value ? [
    { label: 'Módulos', to: '/modulos', icon: Blocks },
    { label: 'Organización del menú', to: '/organizacion', icon: FolderTree },
    { label: 'Catálogos', to: '/catalogos', icon: Library },
    { label: 'Automatización', to: '/triggers', icon: Zap },
    { label: 'Usuarios', to: '/usuarios', icon: Users },
    { label: 'Roles y permisos', to: '/roles', icon: ShieldCheck }
  ] : [] }
])
const closed = ref<Record<string, boolean>>({})
onMounted(() => { try { closed.value = JSON.parse(localStorage.getItem('flowerp-nav-closed') || '{}') } catch {} })
function toggle(key: string) {
  closed.value[key] = !closed.value[key]
  try { localStorage.setItem('flowerp-nav-closed', JSON.stringify(closed.value)) } catch {}
}
const route = useRoute()
function active(to: string) { return route.path === to || (to !== '/' && route.path.startsWith(to + '/')) }
</script>

<template>
  <AppNavTooltip :enabled="compact">
  <nav aria-label="Menú principal" class="flex flex-col gap-4">
    <template v-for="section in sections" :key="section.key">
      <div v-if="section.items.length" class="flex flex-col gap-px" :class="compact && section.key !== 'general' ? 'border-t border-brand-border-light pt-3' : ''">
        <button v-if="!compact" type="button" class="flex items-center justify-between rounded px-3 py-1.5 text-left text-[11px] font-bold tracking-wide text-brand-text-muted" :aria-expanded="!closed[section.key]" @click="toggle(section.key)">
          {{ section.label }}<ChevronDown class="h-3.5 w-3.5" :class="{ '-rotate-90': closed[section.key] }" />
        </button>
        <template v-if="compact || !closed[section.key]">
          <NuxtLink v-for="item in section.items" :key="item.to" :to="item.to" :aria-label="item.label" :aria-current="active(item.to) ? 'page' : undefined"
            class="group relative flex items-center gap-2.5 rounded py-2 text-sm font-medium" :class="[compact ? 'justify-center px-2' : 'px-3', active(item.to) ? 'bg-brand-sidebar-active-bg font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg']">
            <span class="relative flex h-[17px] w-[17px] shrink-0 items-center justify-center">
              <component :is="item.icon" class="h-[17px] w-[17px]" :stroke-width="1.75" />
              <span v-if="item.badge" class="absolute -left-2 -top-2 z-10 flex min-w-[18px] items-center justify-center rounded-full bg-brand-orange px-1 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm">{{ item.badge > 99 ? '99+' : item.badge }}</span>
            </span>
            <span v-if="!compact" class="min-w-0 flex-1">{{ item.label }}</span>
          </NuxtLink>
        </template>
      </div>
      <div v-if="section.key === 'general' && (nav?.groups.length || nav?.unassigned.length)" class="flex flex-col gap-1" :class="compact ? 'border-t border-brand-border-light pt-3' : ''">
        <span v-if="!compact" class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">MÓDULOS</span>
        <AppNavGroup v-for="group in nav?.groups" :key="group.id" :group="group" :compact="compact" />
        <span v-if="nav?.groups.length && nav.unassigned.length && !compact" class="px-3 pt-3 text-[10px] font-semibold uppercase text-brand-text-muted">Sin área asignada</span>
        <AppNavGroup v-if="compact && nav?.unassigned.length" :compact="true" :group="{ id: 'unassigned', name: 'Otros módulos', icon: 'Blocks', modules: nav.unassigned, catalogs: [], children: [] }" />
        <template v-else><AppNavEntity v-for="entity in nav?.unassigned" :key="entity.id" :entity="entity" /></template>
      </div>
    </template>
  </nav>
  </AppNavTooltip>
</template>

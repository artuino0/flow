<script setup lang="ts">
import { LayoutDashboard, ShieldCheck, Settings, Blocks, Users, Zap, Library, ChevronDown, BarChart3, FolderTree } from '@lucide/vue'
import type { NavigationEntity, NavigationNode } from '~/utils/moduleNavigation'
import AppNavGroup from '~/components/AppNavGroup.vue'
import AppNavEntity from '~/components/AppNavEntity.vue'
defineProps<{ compact?: boolean }>()
const { data: nav } = await useFetch<{ groups: NavigationNode[]; unassigned: NavigationEntity[] }>('/api/nav/entities', {
  key: 'appnav-modules', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const { data: isAdmin } = await useIsAdmin()
const sections = computed(() => [
  { key: 'general', label: 'GENERAL', items: [{ label: 'Tablero', to: '/', icon: LayoutDashboard }] },
  { key: 'reportes', label: 'REPORTES', items: isAdmin.value ? [{ label: 'Reportes', to: '/reportes/nuevo', icon: BarChart3 }] : [] },
  { key: 'administracion', label: 'ADMINISTRACIÓN', items: isAdmin.value ? [
    { label: 'Módulos', to: '/modulos', icon: Blocks },
    { label: 'Organización del menú', to: '/organizacion', icon: FolderTree },
    { label: 'Catálogos', to: '/catalogos', icon: Library },
    { label: 'Automatización', to: '/triggers', icon: Zap },
    { label: 'Usuarios', to: '/usuarios', icon: Users },
    { label: 'Roles y permisos', to: '/roles', icon: ShieldCheck },
    { label: 'Ajustes', to: '/ajustes', icon: Settings }
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
  <nav aria-label="Menú principal" class="flex flex-col gap-4">
    <template v-for="section in sections" :key="section.key">
      <div v-if="section.items.length" class="flex flex-col gap-px">
        <button v-if="!compact" type="button" class="flex items-center justify-between rounded px-3 py-1.5 text-left text-[11px] font-bold tracking-wide text-brand-text-muted" :aria-expanded="!closed[section.key]" @click="toggle(section.key)">
          {{ section.label }}<ChevronDown class="h-3.5 w-3.5" :class="{ '-rotate-90': closed[section.key] }" />
        </button>
        <template v-if="compact || !closed[section.key]">
          <NuxtLink v-for="item in section.items" :key="item.to" :to="item.to" :title="compact ? item.label : undefined" :aria-label="item.label" :aria-current="active(item.to) ? 'page' : undefined"
            class="flex items-center gap-2.5 rounded py-2 text-sm font-medium" :class="[compact ? 'justify-center px-2' : 'px-3', active(item.to) ? 'bg-brand-sidebar-active-bg font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg']">
            <component :is="item.icon" class="h-[17px] w-[17px] shrink-0" :stroke-width="1.75" /><span v-if="!compact">{{ item.label }}</span>
          </NuxtLink>
        </template>
      </div>
      <div v-if="section.key === 'general' && (nav?.groups.length || nav?.unassigned.length)" class="flex flex-col gap-1">
        <span v-if="!compact" class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">MÓDULOS</span>
        <AppNavGroup v-for="group in nav?.groups" :key="group.id" :group="group" :compact="compact" />
        <span v-if="nav?.groups.length && nav.unassigned.length && !compact" class="px-3 pt-3 text-[10px] font-semibold uppercase text-brand-text-muted">Sin área asignada</span>
        <AppNavEntity v-for="entity in nav?.unassigned" :key="entity.id" :entity="entity" :compact="compact" />
      </div>
    </template>
  </nav>
</template>

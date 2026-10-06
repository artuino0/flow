<script setup lang="ts">
import { BarChart3, Blocks, BookOpen, Building2, ClipboardList, CreditCard, FileText, FolderTree, Globe, Globe2, History, Home, LayoutDashboard, LayoutTemplate, Library, Link2, MessageCircle, Palette, PanelsTopLeft, Plug, ReceiptText, Settings, ShieldCheck, Sparkles, UserRound, Users, UsersRound, Zap, ChevronDown } from '@lucide/vue'
import type { NavigationEntity, NavigationNode } from '~/utils/moduleNavigation'
import AppNavGroup from '~/components/AppNavGroup.vue'
import AppNavEntity from '~/components/AppNavEntity.vue'
import { showDesignerAccess, tourNeedsAdministration } from '~/utils/onboardingTours'
import { isSettingsNavigation } from '~/utils/unifiedNavigation'
import { moduleIconComponent } from '~/utils/moduleIcons'

defineProps<{ compact?: boolean }>()
const { nav: navResource, areas, pinned, pins, load, pinError } = useUnifiedNavigation()
const nav = navResource.data
const { navigationTourId: activeTourId } = useOnboarding()
const route = useRoute()
const settingsMenu = computed(() => isSettingsNavigation(route.path))
await Promise.all([load(), navResource.execute(), pins.execute()])
const { data: isAdmin } = await useIsAdmin()
const { user } = useAuth()
const { data: planUsage } = useDesignerPlanUsage(isAdmin)

interface NavItem { label: string; to: string; icon: ReturnType<typeof moduleIconComponent>; badge?: number }
interface NavSection { key: string; label: string; items: NavItem[] }

const globalItems = computed<NavItem[]>(() => [{ label: 'Tablero', to: '/', icon: LayoutDashboard }])

const sections = computed<NavSection[]>(() => {
  if (settingsMenu.value) return [
      { key: 'account', label: 'CUENTA', items: [
        { label: 'Mi perfil', to: '/ajustes?section=perfil', icon: UserRound },
        { label: 'Seguridad y sesiones', to: '/ajustes?section=seguridad', icon: ShieldCheck }
      ] },
      { key: 'organization', label: 'ORGANIZACIÓN', items: isAdmin.value ? [
        { label: 'Plan y consumo', to: '/ajustes?section=plan', icon: CreditCard },
        { label: 'Organización', to: '/ajustes?section=organizacion', icon: Building2 },
        { label: 'Identidad visual', to: '/ajustes?section=identidad', icon: Palette },
        { label: 'Preferencias regionales', to: '/ajustes?section=regional', icon: Globe },
        ...(user.value?.country === 'MX' ? [{ label: 'Facturación', to: '/ajustes?section=facturacion', icon: ReceiptText }] : []),
        { label: 'API e integraciones', to: '/ajustes?section=integraciones', icon: Plug },
        { label: 'Grupos de notificación', to: '/ajustes?section=grupos', icon: UsersRound }
      ] : [] },
      { key: 'administration', label: 'ADMINISTRACIÓN', items: isAdmin.value ? [
        { label: 'Módulos de Core', to: '/modulos', icon: Blocks }, { label: 'Organización de Core', to: '/organizacion', icon: FolderTree },
        ...(showDesignerAccess(planUsage.value?.code) ? [{ label: 'Diseñador de estructura', to: '/disenador', icon: Sparkles }] : []),
        { label: 'Catálogos', to: '/catalogos', icon: Library }, { label: 'Usuarios', to: '/usuarios', icon: Users },
        { label: 'Roles y permisos', to: '/roles', icon: ShieldCheck }, { label: 'Administrar aplicaciones', to: '/roles', icon: Settings }
      ] : [] }
    ]
  return areas.value.filter(area => area.enabled && area.accessible && area.key !== 'communications').map(area => ({ key: area.key, label: area.label, items: area.key === 'core' ? [] : area.items.map(item => ({ ...item, icon: moduleIconComponent(item.icon) })) }))
})

const closed = ref<Record<string, boolean>>({})
const defaultClosed = { sites: true, automation: true, billing: true }
onMounted(() => { try { closed.value = { ...defaultClosed, ...JSON.parse(localStorage.getItem('flow-nav-closed') || localStorage.getItem('flowerp-nav-closed') || '{}') } } catch { closed.value = { ...defaultClosed } } })
function toggle(key: string) { closed.value[key] = !closed.value[key]; try { localStorage.setItem('flow-nav-closed', JSON.stringify(closed.value)) } catch { /* Preferencia opcional. */ } }
function sectionIsCurrent(section: NavSection) { return section.items.some(item => active(item.to)) }
function active(to: string) {
  const [path, query] = to.split('?')
  if (path === '/sites') return route.path === path
  if (!(route.path === path || (path !== '/' && route.path.startsWith(`${path}/`)))) return false
  if (!query) return true
  return new URLSearchParams(query).get('section') === String(route.query.section || '')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
  <AppNavTooltip :enabled="compact" class="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2.5">
    <nav aria-label="Menú de la aplicación" class="flex flex-col gap-4">
      <NuxtLink v-if="settingsMenu" to="/" aria-label="Volver a la navegación" class="flex h-9 min-h-9 max-sm:h-11 max-sm:min-h-11 items-center rounded px-3 py-0 text-sm font-medium text-brand-text-secondary hover:bg-brand-bg">← <span v-if="!compact" class="ml-2">Volver</span></NuxtLink>
      <div v-else class="flex flex-col gap-px">
        <NuxtLink
          :prefetch-on="{ interaction: true }"
          v-for="item in globalItems"
          :key="item.to"
          :to="item.to"
          :aria-label="item.label"
          :aria-current="active(item.to) ? 'page' : undefined"
          class="group relative flex h-9 min-h-9 max-sm:h-11 max-sm:min-h-11 items-center gap-2.5 rounded py-0 text-sm font-medium"
          :class="[compact ? 'justify-center px-2' : 'px-3', active(item.to) ? 'bg-brand-sidebar-active-bg font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg']"
        >
          <span class="relative flex h-[17px] w-[17px] shrink-0 items-center justify-center">
            <component :is="item.icon" class="h-[17px] w-[17px]" :stroke-width="1.75" />
            <span v-if="item.badge" class="absolute -left-2 -top-2 z-10 flex min-w-[18px] items-center justify-center rounded-full bg-brand-orange px-1 py-0.5 text-[9px] font-bold leading-none text-brand-primary-fg shadow-sm">{{ item.badge > 99 ? '99+' : item.badge }}</span>
          </span>
          <span v-if="!compact" class="min-w-0 flex-1">{{ item.label }}</span>
        </NuxtLink>
      </div>

      <div v-if="!settingsMenu && pinned.length" class="flex flex-col gap-px">
        <span v-if="!compact" class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">ANCLADOS</span>
        <NavigationPinnedItem v-for="item in pinned" :key="item.key" :item="item" :compact="compact" />
      </div>
      <p v-if="pinError" role="alert" class="px-3 text-xs text-brand-error-text">{{ pinError }}</p>
      <template v-for="section in sections" :key="section.key">
        <div v-if="section.items.length" class="flex flex-col gap-px" :class="compact && section.key !== sections[0]?.key ? 'border-t border-brand-border-light pt-3' : ''">
          <button v-if="!compact" type="button" class="flex min-h-8 items-center justify-between rounded px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-brand-text-muted" :aria-expanded="!closed[section.key] || sectionIsCurrent(section) || tourNeedsAdministration(activeTourId, section.key)" @click="toggle(section.key)">{{ section.label }}<ChevronDown class="h-3.5 w-3.5" :class="{ '-rotate-90': closed[section.key] && !sectionIsCurrent(section) && !tourNeedsAdministration(activeTourId, section.key) }" /></button>
          <template v-if="compact || !closed[section.key] || sectionIsCurrent(section) || tourNeedsAdministration(activeTourId, section.key)">
            <NuxtLink v-for="item in section.items" :key="item.to + item.label" :to="item.to" :prefetch-on="{ interaction: true }" :data-tour="item.to === '/modulos' ? 'modules-core' : item.to === '/disenador' ? 'designer-access' : undefined" :aria-label="item.label" :aria-current="active(item.to) ? 'page' : undefined" class="group relative flex h-9 min-h-9 max-sm:h-11 max-sm:min-h-11 items-center gap-2.5 rounded py-0 text-sm font-medium" :class="[compact ? 'justify-center px-2' : 'px-3', active(item.to) ? 'bg-brand-sidebar-active-bg font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg']">
              <span class="relative flex h-[17px] w-[17px] shrink-0 items-center justify-center"><component :is="item.icon" class="h-[17px] w-[17px]" :stroke-width="1.75" /><span v-if="item.badge" class="absolute -left-2 -top-2 z-10 flex min-w-[18px] items-center justify-center rounded-full bg-brand-orange px-1 py-0.5 text-[9px] font-bold leading-none text-brand-primary-fg shadow-sm">{{ item.badge > 99 ? '99+' : item.badge }}</span></span>
              <span v-if="!compact" class="min-w-0 flex-1">{{ item.label }}</span>
            </NuxtLink>
          </template>
        </div>
        <div v-if="section.key === 'core' && (nav?.groups.length || nav?.unassigned.length)" class="flex flex-col gap-1" :class="compact ? 'border-t border-brand-border-light pt-3' : ''">
          <span v-if="!compact" class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">MÓDULOS</span>
          <AppNavGroup v-for="group in nav?.groups" :key="group.id" :group="group" :compact="compact" />
          <span v-if="nav?.groups.length && nav.unassigned.length && !compact" class="px-3 pt-3 text-[10px] font-semibold uppercase text-brand-text-muted">Sin área asignada</span>
          <AppNavGroup v-if="compact && nav?.unassigned.length" :compact="true" :group="{ id: 'unassigned', name: 'Otros módulos', icon: 'Blocks', modules: nav.unassigned, catalogs: [], children: [] }" />
          <template v-else><AppNavEntity v-for="entity in nav?.unassigned" :key="entity.id" :entity="entity" /></template>
        </div>
      </template>
    </nav>
  </AppNavTooltip>
  <div v-if="!settingsMenu" class="shrink-0 border-t border-brand-border-light px-2 py-1"><NavigationMore :compact="compact" /></div>
  <SidebarPlanUsage :compact="compact" />
  </div>
</template>


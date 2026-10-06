<script setup lang="ts">
import { ChevronDown, ChevronRight, X } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'
import type { NavigationNode } from '~/utils/moduleNavigation'
import AppNavEntity from '~/components/AppNavEntity.vue'
const props = defineProps<{ group: NavigationNode; compact?: boolean }>()
const open = ref(true)
const catalogsOpen = ref(false)
const route = useRoute()
const active = computed(() => containsCurrent(props.group))
const activePanel = useState<string | null>('navigation-area-panel', () => null)
const panelOpen = computed(() => props.compact && activePanel.value === props.group.id)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = useId()
const position = ref({ left: '72px', top: '64px', maxHeight: '80vh' })
function closePanel(restoreFocus = false) {
  if (!panelOpen.value) return
  activePanel.value = null
  if (restoreFocus) trigger.value?.focus()
}
async function togglePanel() {
  if (panelOpen.value) return closePanel()
  activePanel.value = props.group.id
  const rect = trigger.value!.getBoundingClientRect()
  position.value = { left: rect.right + 18 + 'px', top: '64px', maxHeight: Math.max(120, window.innerHeight - 80) + 'px' }
  await nextTick()
  if (!panelOpen.value || !panel.value) return
  position.value.top = Math.max(64, Math.min(rect.top, window.innerHeight - panel.value.offsetHeight - 12)) + 'px'
  panel.value.focus()
}
function outside(event: Event) {
  const target = event.target
  if (target instanceof Node && !panel.value?.contains(target) && !trigger.value?.contains(target)) closePanel()
}
function onResize() { closePanel() }
function onScroll(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return
  closePanel()
}
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('focusin', outside)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onScroll, true)
})
onBeforeUnmount(() => {
  closePanel()
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onScroll, true)
})
watch(() => props.compact, () => { if (activePanel.value === props.group.id) activePanel.value = null })
watch(() => route.fullPath, () => closePanel())
function containsCurrent(group: NavigationNode): boolean {
  return [...group.modules, ...group.catalogs].some(item => route.path === `/registros/${item.slug}` || route.path.startsWith(`/registros/${item.slug}/`)) || group.children.some(containsCurrent)
}
function revealCurrent() {
  if (containsCurrent(props.group)) open.value = true
  if (props.group.catalogs.some(item => route.path === `/registros/${item.slug}` || route.path.startsWith(`/registros/${item.slug}/`))) catalogsOpen.value = true
}
onMounted(() => {
  try { open.value = localStorage.getItem('flowerp-group-' + props.group.id) !== 'closed' } catch {}
  revealCurrent()
})
watch(() => route.path, revealCurrent)
function toggle() {
  open.value = !open.value
  try { localStorage.setItem('flowerp-group-' + props.group.id, open.value ? 'open' : 'closed') } catch {}
}
</script>
<template>
  <div>
    <button ref="trigger" type="button" :aria-label="group.name" :aria-expanded="compact ? !!panelOpen : open" :aria-controls="compact ? panelId : undefined" :aria-haspopup="compact ? 'dialog' : undefined" class="relative flex h-9 min-h-9 max-sm:h-11 max-sm:min-h-11 w-full items-center gap-2 rounded py-0 text-left text-[13px] font-semibold" :class="[compact ? 'justify-center px-1' : 'px-3', active || panelOpen ? 'bg-brand-sidebar-active-bg text-brand-blue' : 'text-brand-text hover:bg-brand-bg']" @click="compact ? togglePanel() : toggle()" @keydown.esc="closePanel(true)">
      <component :is="moduleIconComponent(group.icon)" class="h-4 w-4 shrink-0" :stroke-width="1.75" />
      <span v-if="!compact" class="flex-1 leading-5">{{ group.name }}</span>
      <ChevronDown v-if="!compact" class="h-3.5 w-3.5 shrink-0" :class="{ '-rotate-90': !open }" />
      <ChevronRight v-else class="absolute right-0.5 h-2.5 w-2.5 opacity-60" />
    </button>
    <div v-if="!compact && open" class="mt-1 ml-3 space-y-0.5 border-l border-brand-border-light pl-1 pb-1">
      <AppNavEntity v-for="entity in group.modules" :key="entity.id" :entity="entity" :compact="compact" />
      <AppNavGroup v-for="child in group.children" :key="child.id" :group="child" :compact="compact" />
      <template v-if="group.catalogs.length">
        <button v-if="!compact" type="button" :aria-expanded="catalogsOpen" class="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold text-brand-text-muted" @click="catalogsOpen = !catalogsOpen">Catálogos<ChevronDown class="h-3 w-3" :class="{ '-rotate-90': !catalogsOpen }" /></button>
        <template v-if="compact || catalogsOpen"><AppNavEntity v-for="entity in group.catalogs" :key="entity.id" :entity="entity" :compact="compact" /></template>
      </template>
    </div>
    <Teleport to="body">
      <section data-theme-shell v-if="panelOpen" :id="panelId" ref="panel" role="dialog" :aria-label="group.name" tabindex="-1" :style="position"
        class="fixed z-[65] flex w-72 max-w-[calc(100vw-88px)] flex-col overflow-hidden rounded-xl border border-brand-border-light bg-brand-surface text-brand-text shadow-[0_12px_36px_#33475B26] outline-none"
        @keydown.esc.stop.prevent="closePanel(true)">
        <header class="flex shrink-0 items-center gap-3 border-b border-brand-border-light px-4 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-blue-bg text-brand-blue"><component :is="moduleIconComponent(group.icon)" class="h-4 w-4" /></span>
          <div class="min-w-0 flex-1"><p class="text-[10px] font-semibold uppercase tracking-wide text-brand-text-muted">Área de trabajo</p><h2 class="break-words text-sm font-semibold">{{ group.name }}</h2></div>
          <button type="button" aria-label="Cerrar panel" class="rounded p-1 text-brand-text-muted hover:bg-brand-bg" @click="closePanel(true)"><X class="h-4 w-4" /></button>
        </header>
        <nav :aria-label="'Módulos de ' + group.name" class="min-h-0 overflow-y-auto overscroll-contain p-2">
          <AppNavEntity v-for="entity in group.modules" :key="entity.id" :entity="entity" />
          <div v-for="child in group.children" :key="child.id" class="border-t border-brand-border-light px-1 pb-1 pt-3 first:border-t-0 first:pt-1">
            <div class="flex items-center gap-2 px-2 pb-1.5 text-xs font-semibold text-brand-text">
              <component :is="moduleIconComponent(child.icon)" class="h-3.5 w-3.5 text-brand-blue" :stroke-width="1.8" />
              <span>{{ child.name }} </span>
            </div>
            <AppNavEntity v-for="entity in child.modules" :key="entity.id" :entity="entity" />
            <template v-if="child.catalogs.length">
              <p class="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-brand-text-muted">Catálogos</p>
              <AppNavEntity v-for="entity in child.catalogs" :key="entity.id" :entity="entity" />
            </template>
          </div>
          <template v-if="group.catalogs.length">
            <p class="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-text-muted">Catálogos</p>
            <AppNavEntity v-for="entity in group.catalogs" :key="entity.id" :entity="entity" />
          </template>
        </nav>
      </section>
    </Teleport>
  </div>
</template>

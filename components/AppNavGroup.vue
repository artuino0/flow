<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'
import type { NavigationNode } from '~/utils/moduleNavigation'
import AppNavEntity from '~/components/AppNavEntity.vue'
const props = defineProps<{ group: NavigationNode; compact?: boolean }>()
const open = ref(true)
const catalogsOpen = ref(false)
const route = useRoute()
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
    <button type="button" :title="group.name" :aria-label="group.name" :aria-expanded="open" class="flex w-full items-center gap-2 rounded py-2 text-left text-[13px] font-semibold text-brand-text hover:bg-brand-bg" :class="compact ? 'justify-center px-1' : 'px-3'" @click="toggle">
      <component :is="moduleIconComponent(group.icon)" class="h-4 w-4 shrink-0" :stroke-width="1.75" />
      <span v-if="!compact" class="flex-1 leading-5">{{ group.name }}</span>
      <ChevronDown v-if="!compact" class="h-3.5 w-3.5 shrink-0" :class="{ '-rotate-90': !open }" />
    </button>
    <div v-if="open" :class="compact ? '' : 'ml-3 border-l border-brand-border-light pl-1'">
      <AppNavEntity v-for="entity in group.modules" :key="entity.id" :entity="entity" :compact="compact" />
      <AppNavGroup v-for="child in group.children" :key="child.id" :group="child" :compact="compact" />
      <template v-if="group.catalogs.length">
        <button v-if="!compact" type="button" :aria-expanded="catalogsOpen" class="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold text-brand-text-muted" @click="catalogsOpen = !catalogsOpen">Catálogos<ChevronDown class="h-3 w-3" :class="{ '-rotate-90': !catalogsOpen }" /></button>
        <template v-if="compact || catalogsOpen"><AppNavEntity v-for="entity in group.catalogs" :key="entity.id" :entity="entity" :compact="compact" /></template>
      </template>
    </div>
  </div>
</template>

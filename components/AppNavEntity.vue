<script setup lang="ts">
import { moduleIconComponent } from '~/utils/moduleIcons'
import type { NavigationEntity } from '~/utils/moduleNavigation'
const props = defineProps<{ entity: NavigationEntity; compact?: boolean }>()
const route = useRoute()
const to = computed(() => `/registros/${props.entity.slug}`)
const active = computed(() => route.path === to.value || route.path.startsWith(to.value + '/'))
</script>
<template>
  <NuxtLink :to="to" :title="entity.name" :aria-label="entity.name" :aria-current="active ? 'page' : undefined" class="flex items-center gap-2 rounded py-2 text-sm" :class="[compact ? 'justify-center px-2' : 'px-3', active ? 'border-l-[3px] border-brand-blue bg-brand-sidebar-active-bg font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg']">
    <component :is="moduleIconComponent(entity.icon)" class="h-[17px] w-[17px] shrink-0" :stroke-width="1.75" />
    <span v-if="!compact" class="leading-5">{{ entity.name }}</span>
  </NuxtLink>
</template>

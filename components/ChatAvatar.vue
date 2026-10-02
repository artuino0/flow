<script setup lang="ts">
import { Users } from '@lucide/vue'

const props = withDefaults(defineProps<{ name: string; group?: boolean; online?: boolean; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
const initials = computed(() => props.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?')
const sizeClass = computed(() => ({ sm: 'h-8 w-8 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-12 w-12 text-sm' }[props.size]))
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <span class="flex items-center justify-center rounded-full bg-brand-blue-bg font-bold text-brand-blue" :class="sizeClass">
      <Users v-if="group" class="h-[45%] w-[45%]" :stroke-width="1.8" />
      <span v-else>{{ initials }}</span>
    </span>
    <span v-if="online && !group" class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-brand-surface bg-brand-stage-cyan" />
  </span>
</template>

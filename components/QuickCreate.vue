<script setup lang="ts">
import { Plus } from '@lucide/vue'
const { quickCreate } = useUnifiedNavigation()
const open = ref(false), root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>()
function outside(event: Event) { if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); open.value = false; trigger.value?.focus() }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const links = [...(root.value?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]; const index = links.indexOf(event.target as HTMLAnchorElement); links[(index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus() }
}
async function show() { open.value = !open.value; await nextTick(); if (open.value) root.value?.querySelector('a')?.focus() }
onMounted(() => document.addEventListener('pointerdown', outside)); onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div v-if="quickCreate.length" ref="root" class="relative" @keydown="keydown">
    <button ref="trigger" type="button" aria-label="Crear registro" aria-haspopup="menu" :aria-expanded="open" class="flex h-11 w-11 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" @click.stop="show"><Plus class="h-[18px] w-[18px]" /></button>
    <div v-if="open" role="menu" aria-label="Crear registro" class="absolute left-0 top-full z-[80] mt-2 w-60 rounded-lg border border-brand-border-light bg-brand-surface p-1 text-brand-text shadow-lg sm:left-auto sm:right-0"><NuxtLink v-for="entity in quickCreate" :key="entity.id" :to="`/registros/${entity.slug}/nuevo`" role="menuitem" class="flex min-h-11 items-center rounded px-3 py-2 text-sm hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" @click="open = false">{{ entity.name }}</NuxtLink></div>
  </div>
</template>

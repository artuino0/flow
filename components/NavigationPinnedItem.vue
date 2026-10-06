<script setup lang="ts">
import { EllipsisVertical, PinOff } from '@lucide/vue'
import type { NavigationLink } from '~/utils/unifiedNavigation'
import { moduleIconComponent } from '~/utils/moduleIcons'
defineProps<{ item: NavigationLink; compact?: boolean }>()
const { togglePin, pinBusy } = useUnifiedNavigation()
const open = ref(false), trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
const position = ref({ left: '248px', top: '64px' })
async function show() { const rect = trigger.value!.getBoundingClientRect(); position.value = { left: Math.max(12,Math.min(rect.right + 8, window.innerWidth - 188)) + 'px', top: Math.min(rect.top, window.innerHeight - 60) + 'px' }; open.value = !open.value; await nextTick(); panel.value?.querySelector('button')?.focus() }
function close(restore = false) { open.value = false; if (restore) trigger.value?.focus() }
function outside(event: Event) { if (event.target instanceof Node && !trigger.value?.contains(event.target) && !panel.value?.contains(event.target)) close() }
onMounted(() => document.addEventListener('pointerdown', outside)); onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div class="group/pin relative flex items-center rounded hover:bg-brand-bg">
    <NuxtLink :to="item.to" :aria-label="item.label" class="flex h-9 min-h-9 max-sm:h-11 max-sm:min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded px-3 text-sm text-brand-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" :class="compact ? 'justify-center' : ''"><component :is="moduleIconComponent(item.icon)" class="h-[17px] w-[17px] shrink-0" /><span v-if="!compact" class="truncate">{{ item.label }}</span></NuxtLink>
    <button ref="trigger" type="button" :aria-label="`Opciones de ${item.label}`" :aria-expanded="open" aria-haspopup="menu" class="flex h-9 w-9 max-sm:h-11 max-sm:w-11 shrink-0 items-center justify-center rounded text-brand-text-secondary sm:opacity-0 sm:group-hover/pin:opacity-100 sm:focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" :class="compact ? 'absolute right-0 h-6 w-6' : ''" @click.stop="show"><EllipsisVertical class="h-4 w-4" /></button>
    <Teleport to="body"><div v-if="open" ref="panel" role="menu" :aria-label="`Opciones de ${item.label}`" :style="position" class="fixed z-[90] w-44 rounded-lg border border-brand-border-light bg-brand-surface p-1 text-brand-text shadow-lg" @keydown.esc.stop.prevent="close(true)"><button type="button" role="menuitem" :disabled="pinBusy" class="flex min-h-11 w-full items-center gap-2 rounded px-3 text-sm hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" @click="togglePin(item.key); close(true)"><PinOff class="h-4 w-4" />Desanclar</button></div></Teleport>
  </div>
</template>

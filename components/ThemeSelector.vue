<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Sun, Moon, Monitor, Check } from '@lucide/vue'
import type { ThemeMode } from '~/utils/theme'

defineProps<{ touchTarget?: boolean }>()

const { mode, setMode } = useTheme()
const options = [{ value: 'light', label: 'Claro', icon: Sun }, { value: 'dark', label: 'Oscuro', icon: Moon }, { value: 'system', label: 'Sistema', icon: Monitor }] as const
const selected = computed(() => options.find(option => option.value === mode.value) ?? options[2])
const open = ref(false)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
let focusIndex = 0
async function focusOption(index: number) {
  focusIndex = (index + options.length) % options.length
  await nextTick()
  menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[focusIndex]?.focus()
}
function show(last = false) {
  open.value = true
  void focusOption(last ? options.length - 1 : options.findIndex(option => option.value === mode.value))
}
function close(returnFocus = true) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}
function choose(value: ThemeMode) { setMode(value); close() }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Tab') { close(false); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Escape') close()
  else void focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : focusIndex + (event.key === 'ArrowDown' ? 1 : -1))
}
function outside(event: MouseEvent) { if (!root.value?.contains(event.target as Node)) close(false) }
onMounted(() => document.addEventListener('click', outside))
onBeforeUnmount(() => document.removeEventListener('click', outside))
</script>

<template>
  <div ref="root" class="relative">
    <button ref="trigger" type="button" :aria-label="`Tema: ${selected.label}`" aria-haspopup="menu" :aria-expanded="open" class="flex items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" :class="touchTarget ? 'h-11 w-11 bg-brand-surface' : 'h-8 w-8'" @click.stop="open ? close() : show()" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <component :is="selected.icon" class="h-[17px] w-[17px]" :stroke-width="1.75" />
    </button>
    <div v-if="open" ref="menu" role="menu" aria-label="Tema de la aplicación" class="absolute right-0 top-full z-50 mt-2 w-40 rounded-lg border border-brand-border-light bg-brand-surface p-1 shadow-lg" @keydown="keydown">
      <button v-for="option in options" :key="option.value" type="button" role="menuitemradio" :aria-checked="mode === option.value" :tabindex="-1" class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-brand-text hover:bg-brand-bg focus:bg-brand-sidebar-active-bg focus:outline-none" @focus="focusIndex = options.indexOf(option)" @click="choose(option.value)">
        <component :is="option.icon" class="h-4 w-4 text-brand-text-secondary" />{{ option.label }}<Check v-if="mode === option.value" class="ml-auto h-4 w-4 text-brand-blue" />
      </button>
    </div>
  </div>
</template>

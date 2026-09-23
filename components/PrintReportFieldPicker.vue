<script setup lang="ts">
import { ChevronDown, Database, Search } from '@lucide/vue'

interface FieldOption { value: string; label: string }
const props = defineProps<{
  modelValue: string
  options: FieldOption[]
  ariaLabel: string
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(0)
const position = ref({ top: 0, left: 0, width: 320, maxHeight: 320 })

const selected = computed(() => props.options.find(option => option.value === props.modelValue))
function parts(label: string): string[] { return label.split(' › ').filter(Boolean) }
const selectedParts = computed(() => parts(selected.value?.label ?? ''))
const selectedPath = computed(() => selectedParts.value.slice(0, -1).join(' › '))
const selectedField = computed(() => selectedParts.value.at(-1) || props.placeholder || 'Elegir campo')
const nested = computed(() => selectedParts.value.length > 2)
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}
const visibleOptions = computed(() => {
  const term = normalize(query.value.trim())
  return term ? props.options.filter(option => normalize(option.label).includes(term)) : props.options
})
watch(query, () => { activeIndex.value = 0 })

function updatePosition() {
  if (!trigger.value || !import.meta.client) return
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 320), 460, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const spaceBelow = window.innerHeight - rect.bottom - 12
  const above = spaceBelow < 200 && rect.top > spaceBelow
  const maxHeight = Math.min(360, Math.max(140, above ? rect.top - 16 : spaceBelow))
  position.value = { top: above ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6, left, width, maxHeight }
}
async function toggle() {
  if (open.value) { open.value = false; return }
  query.value = ''
  activeIndex.value = 0
  updatePosition()
  open.value = true
  await nextTick()
  searchInput.value?.focus()
}
function choose(value: string) {
  emit('update:modelValue', value)
  open.value = false
  trigger.value?.focus()
}
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { open.value = false; trigger.value?.focus(); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex.value = Math.min(activeIndex.value + 1, visibleOptions.value.length - 1) }
  if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex.value = Math.max(activeIndex.value - 1, 0) }
  if (event.key === 'Enter' && visibleOptions.value[activeIndex.value]) {
    event.preventDefault()
    choose(visibleOptions.value[activeIndex.value]!.value)
  }
}
function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (!trigger.value?.contains(target) && !panel.value?.contains(target)) open.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="flex w-full min-w-0 items-center gap-2 rounded border px-3 py-2 text-left text-xs text-brand-text hover:border-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
    :class="open || nested ? 'border-brand-blue bg-brand-blue-bg' : 'border-brand-border bg-[#F8FBFD]'"
    :aria-label="ariaLabel"
    :aria-expanded="open"
    aria-haspopup="listbox"
    @click="toggle"
    @keydown.down.prevent="!open && toggle()"
  >
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span v-if="selectedPath" class="truncate text-[11px] font-medium" :class="open || nested ? 'text-brand-blue' : 'text-brand-text-muted'">{{ selectedPath }}</span>
      <span class="flex min-w-0 items-center gap-2 text-[13px] font-bold text-brand-text"><Database class="h-3.5 w-3.5 shrink-0 text-brand-text-secondary" :stroke-width="1.75" /><span class="truncate">{{ selectedField }}</span></span>
    </span>
    <ChevronDown class="h-3.5 w-3.5 shrink-0 text-brand-text-muted transition-transform" :class="open ? 'rotate-180' : ''" :stroke-width="1.75" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="panel" class="fixed z-[100] overflow-hidden rounded-md border border-brand-border bg-white shadow-[0_12px_32px_#33475B24]" :style="{ top: `${position.top}px`, left: `${position.left}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px` }">
      <div class="flex items-center gap-2 border-b border-brand-border-light px-3 py-2">
        <Search class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
        <input ref="searchInput" v-model="query" type="search" class="min-w-0 flex-1 border-0 bg-transparent text-sm text-brand-text outline-none placeholder:text-brand-text-muted" placeholder="Buscar campo o módulo…" :aria-label="`Buscar para ${ariaLabel.toLowerCase()}`" @keydown="onSearchKeydown" />
      </div>
      <div role="listbox" :aria-label="ariaLabel" class="overflow-y-auto py-1" :style="{ maxHeight: `${Math.max(90, position.maxHeight - 48)}px` }">
        <p v-if="visibleOptions.length === 0" class="px-3 py-4 text-center text-xs text-brand-text-muted">No hay campos que coincidan.</p>
        <button v-for="(option, index) in visibleOptions" :key="option.value" type="button" role="option" :aria-selected="option.value === modelValue" class="block w-full px-3 py-2 text-left text-xs leading-5 text-brand-text hover:bg-brand-blue-bg" :class="index === activeIndex ? 'bg-brand-blue-bg' : ''" @mouseenter="activeIndex = index" @click="choose(option.value)">{{ option.label }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ArrowLeft, ChevronRight, Ellipsis, LockKeyhole, Pin } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'
defineProps<{ compact?: boolean }>()
const { areas, pinned, pinBusy, pinError, togglePin } = useUnifiedNavigation()
const open = ref(false), mobileItems = ref(false), selected = ref('core')
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>(), panelId = useId(), route = useRoute()
const position = ref({ left: '248px', top: '64px' })
const current = computed(() => areas.value.find(area => area.key === selected.value))
function close(restore = false) { open.value = false; if (restore) trigger.value?.focus() }
async function show() {
  if (open.value) return close()
  const rect = trigger.value!.getBoundingClientRect(), mobile = window.innerWidth < 640
  position.value = { left: mobile ? '12px' : Math.max(12,Math.min(rect.right + 8, window.innerWidth - 492)) + 'px', top: mobile ? '64px' : Math.max(12, Math.min(rect.top, window.innerHeight - 360)) + 'px' }
  mobileItems.value = false; open.value = true
  await nextTick(); panel.value?.querySelector<HTMLButtonElement>('[data-area]')?.focus()
}
function highlight(key: string) {
  const area = areas.value.find(item => item.key === key)
  if (window.innerWidth >= 640 && area?.enabled && area.accessible) selected.value = key
}
async function select(key: string, focus = false) {
  const area = areas.value.find(item => item.key === key)
  if (!area?.enabled || !area.accessible) return
  selected.value = key; mobileItems.value = true
  if (focus) { await nextTick(); panel.value?.querySelector<HTMLAnchorElement>('[data-column="items"] a')?.focus() }
}
function outside(event: Event) { if (event.target instanceof Node && !trigger.value?.contains(event.target) && !panel.value?.contains(event.target)) close() }
function resized() { close() }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  const target = event.target as HTMLElement
  if (event.key === 'ArrowRight' && target.dataset.area) { event.preventDefault(); void select(target.dataset.area, true); return }
  if (event.key === 'ArrowLeft') { event.preventDefault(); mobileItems.value = false; void nextTick(() => panel.value?.querySelector<HTMLButtonElement>(`[data-area="${selected.value}"]`)?.focus()); return }
  const column = target.closest('[data-column]')
  const items = [...((event.key === 'Tab' ? panel.value : column)?.querySelectorAll<HTMLElement>('a,button') ?? [])].filter(item => item.getClientRects().length)
  const index = items.indexOf(target)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }
  if (event.key === 'Tab' && items.length && ((event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1))) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus() }
}
watch(() => route.fullPath, () => close())
onMounted(() => { document.addEventListener('pointerdown', outside); window.addEventListener('resize', resized) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resized) })
</script>
<template>
  <button ref="trigger" type="button" aria-label="Más" :aria-expanded="open" :aria-controls="panelId" aria-haspopup="dialog" class="flex h-9 min-h-9 max-sm:h-11 max-sm:min-h-11 w-full items-center gap-2.5 rounded px-3 py-0 text-sm font-medium text-brand-text-secondary hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" :class="compact ? 'justify-center' : ''" @click.stop="show"><Ellipsis class="h-[17px] w-[17px] shrink-0" /><span v-if="!compact" class="flex-1 text-left">Más</span><ChevronRight v-if="!compact" class="h-4 w-4" /></button>
  <Teleport to="body">
    <div v-if="open" :id="panelId" ref="panel" role="dialog" aria-label="Más navegación" :style="position" class="fixed z-[80] flex max-h-[calc(100dvh-80px)] w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface text-brand-text shadow-lg sm:w-[480px]" @keydown="keydown">
      <div data-column="areas" class="w-full shrink-0 overflow-y-auto p-2 sm:w-48 sm:border-r sm:border-brand-border-light" :class="mobileItems ? 'hidden sm:block' : ''">
        <button v-for="area in areas" :key="area.key" :data-area="area.key" type="button" :aria-disabled="!area.enabled || !area.accessible" class="flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" :class="[selected === area.key ? 'bg-brand-sidebar-active-bg text-brand-blue' : 'hover:bg-brand-bg', !area.enabled || !area.accessible ? 'text-brand-text-muted' : '']" @focus="highlight(area.key)" @mouseenter="highlight(area.key)" @click="select(area.key,true)">
          <span class="min-w-0 flex-1"><span class="block font-medium">{{ area.label }}</span><span v-if="!area.enabled || !area.accessible || area.pending" class="block text-xs text-brand-text-secondary">{{ !area.enabled ? 'No activada' : !area.accessible ? 'Sin permiso' : 'Configuración pendiente' }}</span></span><LockKeyhole v-if="!area.enabled || !area.accessible" class="h-4 w-4 shrink-0" /><ChevronRight v-else class="h-4 w-4 shrink-0" />
        </button>
      </div>
      <div data-column="items" class="min-w-0 flex-1 overflow-y-auto p-2" :class="mobileItems ? '' : 'hidden sm:block'">
        <button type="button" class="mb-2 flex min-h-11 items-center gap-2 rounded px-3 text-sm text-brand-text-secondary hover:bg-brand-bg sm:hidden" @click="mobileItems = false"><ArrowLeft class="h-4 w-4" />Volver</button>
        <p class="px-3 py-2 text-xs font-semibold text-brand-text-secondary">{{ current?.label }}</p>
        <template v-if="current?.enabled && current.accessible">
          <div v-for="item in current.items" :key="item.key" class="flex items-center rounded hover:bg-brand-bg">
            <NuxtLink :to="item.to" class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" @click="close()"><component :is="moduleIconComponent(item.icon)" class="h-4 w-4 shrink-0" /><span class="break-words">{{ item.label }}</span></NuxtLink>
            <button type="button" :aria-label="`${pinned.some(pin => pin.key === item.key) ? 'Desanclar' : 'Anclar'} ${item.label}`" :aria-pressed="pinned.some(pin => pin.key === item.key)" :disabled="pinBusy" class="flex h-11 w-11 shrink-0 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-sidebar-active-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:opacity-50" @click="togglePin(item.key)"><Pin class="h-4 w-4" :class="pinned.some(pin => pin.key === item.key) ? 'fill-brand-blue text-brand-blue' : ''" /></button>
          </div>
          <p v-if="!current.items.length" class="px-3 py-4 text-sm text-brand-text-secondary">No hay elementos disponibles.</p>
        </template>
        <p v-if="pinError" role="alert" class="px-3 py-2 text-sm text-brand-error-text">{{ pinError }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ enabled?: boolean }>()
const root = ref<HTMLElement | null>(null)
const tooltip = ref<HTMLElement | null>(null)
const label = ref('')
const position = ref({ left: '0px', top: '0px' })
const id = useId()
let anchor: HTMLElement | null = null

function hide() {
  anchor?.removeAttribute('aria-describedby')
  anchor = null
  label.value = ''
}

async function show(event: Event) {
  const target = event.target
  const item = target instanceof Element ? target.closest<HTMLElement>('a[aria-label],button[aria-label]') : null
  if (!props.enabled || !item || !root.value?.contains(item) || (item.getAttribute('aria-haspopup') === 'dialog' && item.getAttribute('aria-expanded') === 'true')) return hide()
  if (anchor === item) return
  hide()
  anchor = item
  label.value = item.getAttribute('aria-label') || ''
  item.setAttribute('aria-describedby', id)
  const rect = item.getBoundingClientRect()
  position.value = { left: rect.right + 14 + 'px', top: rect.top + rect.height / 2 + 'px' }
  await nextTick()
  if (anchor !== item || !tooltip.value) return
  const height = tooltip.value.offsetHeight
  position.value.top = Math.max(height / 2 + 8, Math.min(window.innerHeight - height / 2 - 8, rect.top + rect.height / 2)) + 'px'
}

function leave(event: MouseEvent | FocusEvent) {
  if (event.relatedTarget instanceof Node && anchor?.contains(event.relatedTarget)) return
  hide()
}

watch(() => props.enabled, hide)
const route = useRoute()
watch(() => route.fullPath, hide)
onMounted(() => {
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
})
onBeforeUnmount(() => {
  hide()
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('resize', hide)
})
</script>

<template>
  <div ref="root" @mouseover="show" @mouseout="leave" @focusin="show" @focusout="leave" @click="hide" @keydown.esc="hide">
    <slot />
    <Teleport to="body">
      <div v-if="enabled && label" :id="id" ref="tooltip" role="tooltip"
        class="nav-tooltip fixed z-[70] -translate-y-1/2 rounded-md border border-brand-border-light bg-white px-3 py-2 text-xs font-semibold text-brand-text shadow-[0_6px_18px_#33475B20]"
        :style="position">
        {{ label }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nav-tooltip { pointer-events: none; max-width: min(280px, calc(100vw - 90px)); overflow-wrap: anywhere; }
.nav-tooltip::before { content: ''; position: absolute; left: -5px; top: 50%; width: 8px; height: 8px; background: white; border-left: 1px solid; border-bottom: 1px solid; border-color: inherit; transform: translateY(-50%) rotate(45deg); }
</style>

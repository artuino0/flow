<script setup lang="ts">
const props = defineProps<{ title: string; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const titleId = useId()
let previous: HTMLElement | null = null
let overflow = ''
const hidden: Array<{ element: HTMLElement; inert: boolean }> = []
onMounted(() => {
  previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  let branch = panel.value?.parentElement
  while (branch && branch !== document.body) {
    for (const sibling of branch.parentElement?.children ?? []) if (sibling !== branch && sibling instanceof HTMLElement) { hidden.push({ element: sibling, inert: sibling.inert }); sibling.inert = true }
    branch = branch.parentElement
  }
  nextTick(() => (panel.value?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') ?? panel.value)?.focus())
})
onBeforeUnmount(() => { hidden.forEach(({ element, inert }) => { element.inert = inert }); document.body.style.overflow = overflow; previous?.focus() })
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); if (!props.busy) emit('close') }
  if (event.key !== 'Tab') return
  const focusable = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? [])
  const first = focusable[0], last = focusable.at(-1)
  if (!first) { event.preventDefault(); panel.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>
<template>
  <div class="agenda-ui agenda-modal-backdrop" data-dark-ready="true" @keydown="keydown">
    <section ref="panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" class="agenda-modal">
      <header class="agenda-card-heading"><h2 :id="titleId">{{ title }}</h2><button class="settings-button" type="button" aria-label="Cerrar diálogo" :disabled="busy" @click="emit('close')">×</button></header>
      <div class="agenda-card-body"><slot /></div><slot name="footer" />
    </section>
  </div>
</template>

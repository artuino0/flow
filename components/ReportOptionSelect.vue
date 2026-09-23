<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
const props = defineProps<{ label: string; modelValue: string; options: { value: string; label: string }[]; joined?: boolean; labelHidden?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const open = ref(false)
const id = useId()
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? props.modelValue)
function buttons() { return [...root.value!.querySelectorAll<HTMLButtonElement>('[role="option"]')] }
async function expand() { open.value = true; await nextTick(); buttons()[Math.max(0, props.options.findIndex(option => option.value === props.modelValue))]?.focus() }
function close(restore = false) { open.value = false; if (restore) trigger.value?.focus() }
function choose(value: string) { emit('update:modelValue', value); close(true) }
function navigate(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const options = buttons()
  const current = options.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  options[next]?.focus()
}
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) close() }
function blur(event: FocusEvent) { if (!root.value?.contains(event.relatedTarget as Node)) close() }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div ref="root" class="report-option" @focusout="blur" @keydown.esc.stop.prevent="close(true)">
    <span :id="id + '-label'" class="report-option-label" :class="{ 'is-visually-hidden': labelHidden }">{{ label }}</span>
    <div class="report-option-anchor">
      <button ref="trigger" type="button" class="report-option-trigger" :class="{ 'is-open': open, 'is-joined': joined }" :aria-labelledby="id + '-label ' + id + '-value'" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? id + '-list' : undefined" @click="open ? close() : expand()" @keydown.down.prevent="expand" @keydown.up.prevent="expand"><span :id="id + '-value'">{{ selected }}</span><ChevronDown :size="14" :class="{ rotated: open }" /></button>
      <div v-if="open" :id="id + '-list'" role="listbox" :aria-labelledby="id + '-label'" class="report-option-menu" @keydown="navigate">
        <button v-for="option in options" :key="option.value" type="button" role="option" tabindex="-1" :aria-selected="option.value === modelValue" @click="choose(option.value)"><span>{{ option.label }}</span><Check v-if="option.value === modelValue" :size="15" /></button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.report-option { display:flex; align-items:center; gap:8px; }
.report-option-label { color:#8DA1B5; font-size:12px; font-weight:600; white-space:nowrap; }
.report-option-label.is-visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0; }
.report-option-anchor { position:relative; }
.report-option-trigger { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:34px; padding:6px 10px; border:1px solid #CBD6E2; border-radius:6px; background:#fff; color:#33475B; font-size:13px; font-weight:600; white-space:nowrap; }
.report-option-trigger svg { color:#8DA1B5; transition:transform .15s ease-out; }
.report-option-trigger svg.rotated { transform:rotate(180deg); }
.report-option-trigger:hover { background:#F5F8FA; border-color:#8DA1B5; }
.report-option-trigger.is-open { border-color:#FF7A59; box-shadow:0 0 0 1px #FF7A59; }
.report-option-trigger:focus-visible { outline:2px solid #FF7A59; outline-offset:2px; }
.report-option-trigger.is-joined { min-height:32px; padding:6px 8px; border:0; border-radius:0; box-shadow:none; }
.report-option-trigger.is-joined.is-open { border-color:transparent; box-shadow:none; }
.report-option-trigger.is-joined:focus-visible { outline:none; box-shadow:none; }
.report-option-menu { position:absolute; left:0; top:calc(100% + 6px); z-index:30; min-width:100%; width:max-content; max-width:calc(100vw - 32px); padding:5px; border:1px solid #CBD6E2; border-radius:8px; background:#fff; box-shadow:0 8px 20px #33475B26; }
.report-option-menu button { display:flex; align-items:center; justify-content:space-between; gap:24px; width:100%; min-width:104px; padding:8px 10px; border-radius:4px; color:#33475B; font-size:13px; text-align:left; white-space:nowrap; }
.report-option-menu button[aria-selected=true] { color:#0091AE; font-weight:600; background:#EAF3F6; }
.report-option-menu button:hover, .report-option-menu button:focus-visible { outline:none; background:#F5F8FA; box-shadow:inset 0 0 0 1px #CBD6E2; }
@media print { .report-option-menu { display:none; } }
</style>

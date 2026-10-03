<script setup lang="ts">
import { Check, ChevronDown, Search } from '@lucide/vue'
const props = defineProps<{ modelValue?: string; label: string; options: { value: string; label: string }[]; pending?: boolean; disabled?: boolean; error?: string; more?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string]; search: [string] }>()
const open = ref(false)
const query = ref('')
const chosen = ref('')
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const trigger = ref<HTMLButtonElement>()
const listId = useId()
const above = ref(false)
const popoverStyle = ref<Record<string, string>>({})
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => [props.modelValue, props.options] as const, () => {
  if (!props.modelValue) chosen.value = ''
  const option = props.options.find(option => option.value === props.modelValue)
  if (option) chosen.value = option.label
}, { immediate: true })
watch(query, value => { clearTimeout(timer); timer = setTimeout(() => emit('search', value), 250) })
watch(() => props.disabled, value => { if (value) open.value = false })
// El popover es `position: fixed` (medido contra el disparador) para que el
// contenedor con scroll del modal no lo recorte ni lo esconda bajo la cabecera:
// se abre hacia abajo y completo; solo sube si abajo casi no hay espacio.
function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const margin = 12
  const below = window.innerHeight - rect.bottom - margin
  const top = rect.top - margin
  above.value = below < 180 && top > below
  const maxHeight = Math.max(120, Math.min(320, above.value ? top : below))
  popoverStyle.value = {
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
    ...(above.value ? { bottom: `${window.innerHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` })
  }
}
async function toggle() {
  open.value = !open.value
  if (open.value) {
    place()
    await nextTick(); input.value?.focus()
  }
}
function close() { open.value = false; trigger.value?.focus() }
function select(option: { value: string; label: string }) { chosen.value = option.label; emit('update:modelValue', option.value); close() }
function move(event: KeyboardEvent, delta: number) {
  event.preventDefault()
  const buttons = [...root.value!.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[(index + delta + buttons.length) % buttons.length]?.focus()
}
function outside(event: MouseEvent) { if (!root.value?.contains(event.target as Node)) open.value = false }
function reposition() { if (open.value) place() }
onMounted(() => {
  document.addEventListener('click', outside)
  window.addEventListener('resize', reposition)
  document.addEventListener('scroll', reposition, true)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  document.removeEventListener('click', outside)
  window.removeEventListener('resize', reposition)
  document.removeEventListener('scroll', reposition, true)
})
</script>
<template>
  <div ref="root" class="filter-select" @keydown.esc.stop.prevent="close">
    <button ref="trigger" type="button" class="filter-select-trigger" :class="{ expanded: open }" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="listId" @click="toggle" @keydown.down.prevent="!open && toggle()">
      <span v-if="chosen" class="filter-select-chip">{{ chosen }}</span><span v-else class="filter-placeholder">{{ pending ? 'Cargando opciones…' : 'Selecciona una opción' }}</span><ChevronDown :size="14" :class="{ 'rotate-180': open }" />
    </button>
    <div v-if="open" class="filter-select-popover" :class="{ above }" :style="popoverStyle" @keydown.down="move($event, 1)" @keydown.up="move($event, -1)">
      <label class="filter-select-search"><Search :size="14" /><input ref="input" v-model="query" :aria-label="`Buscar ${label}`" :placeholder="`Buscar ${label.toLocaleLowerCase()}…`" @keydown.enter.prevent="emit('search', query)" /></label>
      <p v-if="pending" role="status" class="filter-select-message">Cargando opciones…</p>
      <div v-else :id="listId" role="listbox" :aria-label="label" class="filter-select-list">
        <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="option.value === modelValue" @click="select(option)"><span class="filter-select-avatar">{{ option.label.slice(0, 1).toUpperCase() }}</span><span class="filter-option-label">{{ option.label }}<small v-if="options.filter(item => item.label === option.label).length > 1"> · {{ option.value.slice(0, 8) }}</small></span><Check v-if="option.value === modelValue" :size="15" /></button>
      </div>
      <p v-if="error" role="alert" class="filter-select-message filter-select-error">{{ error }}</p>
      <p v-else-if="!pending && !options.length" class="filter-select-message">{{ query ? `Sin coincidencias para “${query}”` : 'No hay opciones disponibles.' }}</p>
      <p v-if="more" class="filter-select-message">Se muestran 100 opciones. Escribe para acotar la búsqueda.</p>
    </div>
  </div>
</template>
<style scoped>
.filter-select { position: relative; width: 100%; font-size: 14px; }
.filter-select-trigger { width:100%; min-height:38px; padding:7px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; border:1px solid rgb(var(--brand-control-border)); border-radius:4px; background:rgb(var(--brand-surface)); text-align:left; color:rgb(var(--brand-sites-muted)); }
.filter-select-trigger.expanded { outline:1px solid rgb(var(--brand-orange)); border-color:rgb(var(--brand-orange)); }
.filter-select-trigger:disabled { background:rgb(var(--brand-bg)); cursor:not-allowed; }
.filter-select-chip { color:rgb(var(--brand-blue)); background:rgb(var(--brand-blue-bg)); padding:2px 7px; border-radius:3px; font-size:13px; overflow-wrap:anywhere; }
.filter-select-popover { position:fixed; z-index:20; border:1px solid rgb(var(--brand-control-border)); border-radius:4px; background:rgb(var(--brand-surface)); box-shadow:0 8px 20px rgb(var(--brand-shadow) / 0.2); overflow:hidden; display:flex; flex-direction:column; }
.filter-select-search { display:flex; flex:none; gap:8px; align-items:center; padding:10px 12px; border-bottom:1px solid rgb(var(--brand-border-light)); color:rgb(var(--brand-sites-muted)); }
.filter-select-search input { width:100%; min-width:0; outline:none; font-size:13px; background:rgb(var(--brand-surface)); color:rgb(var(--brand-text)); }
.filter-select-list { min-height:0; max-height:196px; overflow:auto; }
.filter-select-list button { display:flex; gap:10px; align-items:center; width:100%; padding:9px 12px; text-align:left; color:rgb(var(--brand-text)); }
.filter-option-label { flex:1; overflow-wrap:anywhere; }
.filter-select-list button[aria-selected=true], .filter-select-list button:hover, .filter-select-list button:focus-visible { background:rgb(var(--brand-blue-bg)); color:rgb(var(--brand-blue)); outline:none; }
.filter-select-avatar { display:grid; place-items:center; flex:none; width:22px; height:22px; border-radius:50%; background:rgb(var(--brand-border-light)); font-size:10px; }
[aria-selected=true] .filter-select-avatar { background:rgb(var(--brand-blue)); color:rgb(var(--brand-accent-fg)); }
.filter-select-message { padding:10px 12px; font-size:12px; color:rgb(var(--brand-sites-muted)); }
.filter-select-error { color:rgb(var(--brand-error-text)); }
.filter-select-trigger:focus-visible { outline:2px solid rgb(var(--brand-orange)); outline-offset:2px; }
</style>

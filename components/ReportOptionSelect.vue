<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
const props = defineProps<{ label: string; modelValue: string; options: { value: string; label: string }[]; joined?: boolean; labelHidden?: boolean; fill?: boolean; menuPortal?: boolean; searchable?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const open = ref(false)
const query = ref('')
const portalStyle = ref<Record<string, string>>({})
const id = useId()
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? props.modelValue)
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX')
const visibleOptions = computed(() => props.searchable && query.value.trim()
  ? props.options.filter(option => normalize(option.label).includes(normalize(query.value.trim())))
  : props.options)
function buttons() { return [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])] }
async function expand() {
  if (props.menuPortal && trigger.value) {
    const rect = trigger.value.getBoundingClientRect()
    const width = Math.min(520, window.innerWidth - 32)
    const below = window.innerHeight - rect.bottom - 16
    const above = rect.top - 16
    const height = Math.min(360, Math.max(below, above))
    portalStyle.value = {
      position: 'fixed',
      left: `${Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))}px`,
      top: `${below >= Math.min(240, height) ? rect.bottom + 6 : rect.top - height - 6}px`,
      width: `${width}px`,
      maxHeight: `${height}px`,
      overflowY: 'auto'
    }
  }
  open.value = true
  await nextTick()
  if (props.searchable) searchInput.value?.focus()
  else buttons()[Math.max(0, props.options.findIndex(option => option.value === props.modelValue))]?.focus()
}
function close(restore = false) { open.value = false; query.value = ''; if (restore) trigger.value?.focus() }
function choose(value: string) { emit('update:modelValue', value); close(true) }
function navigate(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const options = buttons()
  const current = options.indexOf(document.activeElement as HTMLButtonElement)
  if (!options.length) return
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  options[next]?.focus()
}
function contains(target: EventTarget | null) { return root.value?.contains(target as Node) || menu.value?.contains(target as Node) }
function outside(event: PointerEvent) { if (!contains(event.target)) close() }
function blur(event: FocusEvent) { if (!contains(event.relatedTarget)) close() }
function onScroll(event: Event) { if (props.menuPortal && open.value && !menu.value?.contains(event.target as Node)) close() }
function onResize() { close() }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
onMounted(() => { document.addEventListener('scroll', onScroll, true); window.addEventListener('resize', onResize) })
onBeforeUnmount(() => { document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize) })
</script>
<template>
  <div ref="root" class="report-option" :class="{ 'is-fill': fill }" @focusout="blur" @keydown.esc.stop.prevent="close(true)">
    <span :id="id + '-label'" class="report-option-label" :class="{ 'is-visually-hidden': labelHidden }">{{ label }}</span>
    <div class="report-option-anchor">
      <button ref="trigger" type="button" class="report-option-trigger" :class="{ 'is-open': open, 'is-joined': joined }" :aria-labelledby="id + '-label ' + id + '-value'" :title="selected" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? id + '-list' : undefined" @click="open ? close() : expand()" @keydown.down.prevent="expand" @keydown.up.prevent="expand"><span :id="id + '-value'">{{ selected }}</span><ChevronDown :size="14" :class="{ rotated: open }" /></button>
      <Teleport to="body" :disabled="!menuPortal">
        <div v-if="open" ref="menu" class="report-option-menu" :class="{ 'is-portal': menuPortal, 'theme-light': !!root?.closest('.theme-light') }" :style="menuPortal ? portalStyle : undefined" @keydown.esc.stop.prevent="close(true)" @focusout="blur">
          <div v-if="searchable" class="report-option-search">
            <input ref="searchInput" v-model="query" type="search" :aria-label="`Buscar en ${label}`" placeholder="Buscar campo o relación..." @keydown.down.prevent="buttons()[0]?.focus()" @keydown.enter.prevent="visibleOptions.length === 1 && choose(visibleOptions[0]!.value)" />
          </div>
          <div :id="id + '-list'" role="listbox" :aria-labelledby="id + '-label'" @keydown="navigate">
            <button v-for="option in visibleOptions" :key="option.value" type="button" role="option" tabindex="-1" :aria-selected="option.value === modelValue" @click="choose(option.value)"><span>{{ option.label }}</span><Check v-if="option.value === modelValue" :size="15" /></button>
            <p v-if="!visibleOptions.length" class="report-option-empty">No se encontraron campos.</p>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>
<style scoped>
.report-option { display:flex; align-items:center; gap:8px; }
.report-option.is-fill, .report-option.is-fill .report-option-anchor, .report-option.is-fill .report-option-trigger { width:100%; min-width:0; }
.report-option.is-fill .report-option-trigger span { overflow:hidden; text-overflow:ellipsis; }
.report-option-label { color:rgb(var(--brand-sites-muted)); font-size:12px; font-weight:600; white-space:nowrap; }
.report-option-label.is-visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0; }
.report-option-anchor { position:relative; }
.report-option-trigger { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:34px; padding:6px 10px; border:1px solid rgb(var(--brand-control-border)); border-radius:6px; background:rgb(var(--brand-surface)); color:rgb(var(--brand-text)); font-size:13px; font-weight:600; white-space:nowrap; }
.report-option-trigger svg { color:rgb(var(--brand-sites-muted)); transition:transform .15s ease-out; }
.report-option-trigger svg.rotated { transform:rotate(180deg); }
.report-option-trigger:hover { background:rgb(var(--brand-bg)); border-color:rgb(var(--brand-sites-muted)); }
.report-option-trigger.is-open { border-color:rgb(var(--brand-orange)); box-shadow:0 0 0 1px rgb(var(--brand-orange)); }
.report-option-trigger:focus-visible { outline:2px solid rgb(var(--brand-orange)); outline-offset:2px; }
.report-option-trigger.is-joined { min-height:32px; padding:6px 8px; border:0; border-radius:0; box-shadow:none; }
.report-option-trigger.is-joined.is-open { border-color:transparent; box-shadow:none; }
.report-option-trigger.is-joined:focus-visible { outline:none; box-shadow:none; }
.report-option-menu { position:absolute; left:0; top:calc(100% + 6px); z-index:30; min-width:100%; width:max-content; max-width:calc(100vw - 32px); padding:5px; border:1px solid rgb(var(--brand-control-border)); border-radius:8px; background:rgb(var(--brand-surface)); box-shadow:0 8px 20px rgb(var(--brand-text) / .14901960784313725); }
.report-option-menu.is-portal { z-index:1000; min-width:0; }
.report-option-menu.is-portal button { white-space:normal; }
.report-option-menu.is-portal button span { min-width:0; overflow-wrap:anywhere; }
.report-option-search { position:sticky; top:-5px; z-index:1; padding:5px 5px 8px; background:rgb(var(--brand-surface)); }
.report-option-search input { width:100%; min-height:34px; padding:6px 10px; border:1px solid rgb(var(--brand-control-border)); border-radius:6px; background:rgb(var(--brand-surface)); color:rgb(var(--brand-text)); font-size:13px; outline:none; }
.report-option-search input:focus { border-color:rgb(var(--brand-blue)); box-shadow:0 0 0 2px rgb(var(--brand-blue) / .14901960784313725); }
.report-option-empty { padding:10px; color:rgb(var(--brand-sites-muted)); font-size:13px; }
.report-option-menu button { display:flex; align-items:center; justify-content:space-between; gap:24px; width:100%; min-width:104px; padding:8px 10px; border-radius:4px; color:rgb(var(--brand-text)); font-size:13px; text-align:left; white-space:nowrap; }
.report-option-menu button[aria-selected=true] { color:rgb(var(--brand-blue)); font-weight:600; background:rgb(var(--brand-blue-bg)); }
.report-option-menu button:hover, .report-option-menu button:focus-visible { outline:none; background:rgb(var(--brand-bg)); box-shadow:inset 0 0 0 1px rgb(var(--brand-control-border)); }
@media print { .report-option-menu { display:none; } }
</style>

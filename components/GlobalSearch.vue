<script setup lang="ts">
import { Search, X, ArrowUpRight, CornerDownLeft, Command } from '@lucide/vue'
import { searchHistory, type SearchResult, type SearchResponse } from '~/utils/globalSearch'
import { moduleIconComponent } from '~/utils/moduleIcons'

const { user } = useAuth()
const route = useRoute()
const open = ref(false)
const query = ref('')
const input = ref<HTMLInputElement>()
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const active = ref(0)
const loading = ref(false)
const error = ref(false)
const response = ref<SearchResponse>({ results: [], commands: [], hasMore: false })
const recent = ref<string[]>([])
const history = ref<string[]>([])
const selectedEntity = ref('')
const storageKey = computed(() => `flowerp-search:${user.value?.tenantId}:${user.value?.email}`)
const options = computed(() => [...response.value.results, ...response.value.commands])
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let generation = 0

function persist() {
  try { localStorage.setItem(storageKey.value, JSON.stringify({ recent: recent.value, history: history.value })) } catch { /* Private mode may disallow persistence. */ }
}
function readHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey.value) || '{}')
    recent.value = searchHistory(stored.recent)
    history.value = Array.isArray(stored.history) ? stored.history.filter((s: unknown) => typeof s === 'string' && s.length <= 100).slice(0, 5) : []
  } catch { recent.value = []; history.value = [] }
}
async function runSearch() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true; error.value = false; active.value = 0
  try {
    const result = await $fetch<SearchResponse>('/api/search', { query: { q: query.value.trim(), recent: !query.value.trim() && recent.value.length ? recent.value.join(',') : undefined, entity: selectedEntity.value || undefined }, signal: controller.signal })
    if (current === generation && open.value) response.value = result
  } catch {
    if (current === generation && open.value) { error.value = true; response.value = { results: [], commands: [], hasMore: false } }
  } finally { if (current === generation) loading.value = false }
}
async function show() {
  if (open.value) return
  readHistory(); query.value = ''; selectedEntity.value = ''; open.value = true
  await nextTick(); input.value?.focus(); runSearch()
}
function close() {
  open.value = false; generation++; controller?.abort(); clearTimeout(timer)
  response.value = { results: [], commands: [], hasMore: false }; loading.value = false
  trigger.value?.focus()
}
function clearHistory() { recent.value = []; history.value = []; persist(); runSearch() }
watch(query, () => {
  if (!open.value) return
  clearTimeout(timer); controller?.abort(); generation++
  loading.value = true; response.value = { results: [], commands: [], hasMore: false }
  timer = setTimeout(runSearch, 250)
})
watch(selectedEntity, () => { if (open.value) runSearch() })
watch(() => route.fullPath, () => { if (open.value) close() })
watch(storageKey, () => { recent.value = []; history.value = []; if (open.value) close() })
async function choose(item: SearchResult) {
  if (item.kind === 'record') recent.value = [item.id, ...recent.value.filter(id => id !== item.id)].slice(0, 8)
  if (query.value.trim().length >= 2) history.value = [query.value.trim(), ...history.value.filter(q => q !== query.value.trim())].slice(0, 5)
  persist(); close(); await navigateTo(item.url)
}
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open.value ? close() : show(); return }
  if (!open.value) return
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + options.value.length) % Math.max(1, options.value.length)
    nextTick(() => panel.value?.querySelector(`#global-result-${active.value}`)?.scrollIntoView({ block: 'nearest' }))
  }
  if (event.key === 'Enter' && document.activeElement === input.value && options.value[active.value] && !loading.value) { event.preventDefault(); choose(options.value[active.value]) }
  if (event.key === 'Tab') {
    const focusable = Array.from(panel.value?.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]') || [])
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
onMounted(() => document.addEventListener('keydown', keydown))
onBeforeUnmount(() => { clearTimeout(timer); controller?.abort(); document.removeEventListener('keydown', keydown) })
</script>

<template>
  <button ref="trigger" type="button" aria-label="Buscar registros (Control K)" aria-haspopup="dialog" :aria-expanded="open" class="global-search-trigger mx-3 flex h-9 min-w-9 items-center gap-2 rounded-md border border-brand-border-light bg-brand-bg px-2.5 text-brand-text-secondary hover:border-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue md:w-72" @click="show">
    <Search class="h-4 w-4 shrink-0" /><span class="hidden flex-1 text-left text-[13px] md:block">Buscar en Flow…</span><kbd class="hidden rounded border border-brand-border bg-brand-surface px-1.5 py-0.5 text-[10px] md:block">Ctrl K</kbd>
  </button>
  <Teleport to="body">
    <Transition name="global-search">
      <div v-if="open" class="fixed inset-0 z-[80] flex items-start justify-center bg-brand-navy/30 px-3 pt-[8vh] sm:pt-[12vh]" @mousedown.self="close">
        <section ref="panel" role="dialog" aria-modal="true" aria-label="Buscar en Flow" class="flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-brand-border-light bg-brand-surface text-brand-text shadow-2xl">
          <div class="flex items-center gap-3 border-b border-brand-border-light px-5 py-4">
            <Search class="h-5 w-5 shrink-0 text-brand-blue" />
            <input ref="input" v-model="query" maxlength="100" role="combobox" aria-label="Buscar registros y acciones" aria-autocomplete="list" aria-controls="global-search-results" :aria-expanded="true" :aria-activedescendant="options.length ? `global-result-${active}` : undefined" placeholder="Busca un folio, nombre o módulo…" class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-brand-text-muted" />
            <button v-if="query" type="button" aria-label="Limpiar búsqueda" class="rounded p-1 hover:bg-brand-bg" @click="query = ''; input?.focus()"><X class="h-4 w-4" /></button>
            <button type="button" aria-label="Cerrar búsqueda" class="rounded border border-brand-border px-1.5 py-1 text-[10px] text-brand-text-secondary hover:bg-brand-bg" @click="close">Esc</button>
          </div>
          <div v-if="!query && history.length" class="flex flex-wrap items-center gap-2 border-b border-brand-border-light px-5 py-3">
            <span class="text-xs text-brand-text-secondary">Búsquedas recientes</span><button v-for="term in history" :key="term" type="button" class="max-w-40 truncate rounded-full bg-brand-bg px-2.5 py-1 text-xs hover:bg-brand-blue-bg" @click="query = term">{{ term }}</button>
          </div>
          <div class="flex items-center justify-between border-b border-brand-border-light bg-brand-bg/60 px-5 py-2 text-xs text-brand-text-secondary">
            <span>{{ query ? 'Resultados de tu organización' : 'Continúa donde lo dejaste' }}</span>
            <button v-if="!query && (recent.length || history.length)" type="button" class="text-brand-blue hover:underline" @click="clearHistory">Borrar historial</button>
          </div>
          <div class="min-h-40 overflow-y-auto p-2">
            <div v-if="loading" role="status" class="space-y-4 px-3 py-5"><span class="sr-only">Buscando…</span><div v-for="n in 3" :key="n" class="flex items-center gap-3"><div class="h-9 w-9 rounded bg-brand-bg" /><div class="flex-1 space-y-2"><div class="h-3 w-2/3 rounded bg-brand-bg" /><div class="h-2 w-1/3 rounded bg-brand-bg" /></div></div></div>
            <div v-else-if="error" role="alert" class="px-5 py-8 text-center"><p class="text-sm">No pudimos completar la búsqueda.</p><button class="mt-3 text-sm font-semibold text-brand-blue" @click="runSearch">Volver a intentar</button></div>
            <template v-else>
              <div v-if="!options.length" class="px-5 py-9 text-center"><Search class="mx-auto mb-3 h-7 w-7 text-brand-text-muted" /><p class="text-sm font-semibold">{{ query.length === 1 ? 'Escribe al menos dos caracteres' : query ? 'No encontramos coincidencias' : 'Tus registros recientes aparecerán aquí' }}</p><p class="mt-1 text-xs text-brand-text-secondary">{{ query ? 'Prueba con un nombre o folio diferente.' : 'Busca un registro o escribe “crear” para empezar.' }}</p></div>
              <div id="global-search-results" role="listbox" aria-label="Resultados de búsqueda">
                <template v-for="(item, index) in options" :key="item.id">
                  <p v-if="index === 0 || options[index - 1].kind !== item.kind || (query && item.kind === 'record' && options[index - 1].entity !== item.entity)" class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-brand-text-secondary">{{ item.kind === 'command' ? 'Acciones rápidas' : query ? item.entityName : 'Registros recientes' }}</p>
                  <div :id="`global-result-${index}`" role="option" :aria-selected="active === index" class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3" :class="active === index ? 'bg-brand-blue-bg' : 'hover:bg-brand-bg'" @mousemove="active = index" @mousedown.prevent @click="choose(item)">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-border-light bg-brand-surface text-brand-blue"><Command v-if="item.kind === 'command'" class="h-4 w-4" /><component :is="moduleIconComponent(item.icon)" v-else class="h-4 w-4" /></span>
                    <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-semibold">{{ item.title }}</span><span class="mt-0.5 block truncate text-xs text-brand-text-secondary">{{ item.subtitle }}</span></span><ArrowUpRight class="h-4 w-4 shrink-0 text-brand-text-muted" />
                  </div>
                </template>
              </div>
              <p v-if="response.hasMore" class="px-3 py-3 text-xs text-brand-text-secondary">Hay más coincidencias. Escribe un dato más específico.</p>
            </template>
          </div>
          <footer class="flex items-center justify-between border-t border-brand-border-light bg-brand-bg px-5 py-3 text-[11px] text-brand-text-secondary"><span class="flex items-center gap-3"><span>↑ ↓ Navegar</span><span class="flex items-center gap-1"><CornerDownLeft class="h-3 w-3" /> Abrir</span></span><span role="status" aria-live="polite">{{ loading ? 'Buscando…' : `${response.results.length} ${response.results.length === 1 ? 'registro' : 'registros'}` }}</span></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.global-search-enter-active, .global-search-leave-active { transition: opacity 150ms ease-out; }
.global-search-enter-from, .global-search-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .global-search-enter-active, .global-search-leave-active { transition: none; } }
</style>

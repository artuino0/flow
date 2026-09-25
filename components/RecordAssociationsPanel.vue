<script setup lang="ts">
// Asociaciones directas entre registros (relation_definitions + record_relations),
// genéricas para cualquier par de módulos y desde ambos lados. No confundir con
// los campos `relation` inversos que RecordDetailView muestra por su cuenta.
import { computed, reactive, ref, watch } from 'vue'
import { Link2, Plus, Search, Unlink, X } from '@lucide/vue'

interface AssociationDefinition {
  id: string
  name: string
  side: 'source' | 'target'
  selfRelation: boolean
  relatedEntityId: string
  relatedSlug: string
  relatedName: string
  canLink: boolean
}
interface AssociationRow { id: string; recordId: string; label: string; customData: Record<string, unknown> }
interface AssociationColumn { name: string; label: string; dataType: string; validationRules?: Record<string, unknown> | null }
interface AssociationState {
  rows: AssociationRow[]
  columns: AssociationColumn[]
  relationLabels: Record<string, Record<string, string>>
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: string | null
  pickerOpen: boolean
  search: string
  candidates: { id: string; label: string }[]
  searching: boolean
  busyId: string | null
}

const props = defineProps<{ entitySlug: string; recordId: string }>()
const emit = defineEmits<{ loaded: [count: number] }>()
const toast = useToast()

const definitions = ref<AssociationDefinition[]>([])
const loadingDefinitions = ref(true)
const definitionsError = ref<string | null>(null)
const states = reactive<Record<string, AssociationState>>({})
const base = computed(() => `/api/record-associations/${props.entitySlug}/${props.recordId}`)

function errorMessage(err: any, fallback: string) {
  return err?.data?.statusMessage || err?.statusMessage || fallback
}

async function loadRows(definitionId: string, page = states[definitionId]?.page ?? 1) {
  const state = states[definitionId]
  if (!state) return
  state.loading = true
  state.error = null
  try {
    const res = await $fetch<{ data: AssociationRow[]; columns: AssociationColumn[]; relationLabels: Record<string, Record<string, string>>; page: number; pageSize: number; total: number }>(base.value, { query: { definitionId, page } })
    // Si se desvinculó el último elemento de la última página, retrocede.
    if (!res.data.length && res.total > 0 && page > 1) return loadRows(definitionId, Math.ceil(res.total / res.pageSize))
    Object.assign(state, { rows: res.data, columns: res.columns, relationLabels: res.relationLabels, total: res.total, page: res.page, pageSize: res.pageSize })
  } catch (err) {
    state.error = errorMessage(err, 'No se pudieron cargar las asociaciones')
  } finally {
    state.loading = false
  }
}

async function loadDefinitions() {
  loadingDefinitions.value = true
  definitionsError.value = null
  try {
    const res = await $fetch<{ definitions: AssociationDefinition[] }>(base.value)
    definitions.value = res.definitions
    for (const key of Object.keys(states)) delete states[key]
    for (const definition of res.definitions) {
      states[definition.id] = { rows: [], columns: [], relationLabels: {}, total: 0, page: 1, pageSize: 25, loading: true, error: null, pickerOpen: false, search: '', candidates: [], searching: false, busyId: null }
    }
    emit('loaded', res.definitions.length)
    await Promise.all(res.definitions.map((definition) => loadRows(definition.id, 1)))
  } catch (err) {
    definitionsError.value = errorMessage(err, 'No se pudieron cargar las asociaciones')
    emit('loaded', 0)
  } finally {
    loadingDefinitions.value = false
  }
}
watch(() => [props.entitySlug, props.recordId], loadDefinitions, { immediate: true })

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
async function loadCandidates(definitionId: string) {
  const state = states[definitionId]
  if (!state) return
  const seq = ++searchSeq
  state.searching = true
  try {
    const res = await $fetch<{ data: { id: string; label: string }[] }>(`${base.value}/candidates`, { query: { definitionId, search: state.search || undefined } })
    if (seq === searchSeq) state.candidates = res.data
  } catch (err) {
    if (seq === searchSeq) { state.candidates = []; state.error = errorMessage(err, 'No se pudo buscar registros') }
  } finally {
    if (seq === searchSeq) state.searching = false
  }
}
function togglePicker(definitionId: string) {
  const state = states[definitionId]
  if (!state) return
  const open = !state.pickerOpen
  for (const other of Object.values(states)) other.pickerOpen = false
  state.pickerOpen = open
  state.search = ''
  state.candidates = []
  state.error = null
  if (open) void loadCandidates(definitionId)
}
function onSearchInput(definitionId: string) {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadCandidates(definitionId), 250)
}

async function associate(definition: AssociationDefinition, candidate: { id: string; label: string }) {
  const state = states[definition.id]
  if (!state || state.busyId) return
  state.busyId = candidate.id
  state.error = null
  try {
    await $fetch(base.value, { method: 'POST', body: { definitionId: definition.id, relatedRecordId: candidate.id } })
    toast.success('Asociación creada', `${candidate.label} quedó asociado.`)
    await Promise.all([loadRows(definition.id, state.page), loadCandidates(definition.id)])
  } catch (err: any) {
    const message = errorMessage(err, 'No se pudo crear la asociación')
    state.error = message
    if (err?.statusCode === 409 || err?.status === 409) {
      toast.error('Ya asociado', message)
      await Promise.all([loadRows(definition.id, state.page), loadCandidates(definition.id)])
    } else {
      toast.error('No se pudo asociar', message)
    }
  } finally {
    state.busyId = null
  }
}

async function unlink(definition: AssociationDefinition, row: AssociationRow) {
  const state = states[definition.id]
  if (!state || state.busyId) return
  if (!confirm(`¿Desvincular "${row.label}"? El registro no se elimina, solo la asociación.`)) return
  state.busyId = row.id
  state.error = null
  try {
    await $fetch(`/api/relations/${row.id}`, { method: 'DELETE' })
    toast.success('Asociación quitada', `${row.label} se desvinculó.`)
    await loadRows(definition.id, state.page)
    if (state.pickerOpen) await loadCandidates(definition.id)
  } catch (err) {
    const message = errorMessage(err, 'No se pudo desvincular')
    state.error = message
    toast.error('No se pudo desvincular', message)
  } finally {
    state.busyId = null
  }
}

function cell(state: AssociationState, column: AssociationColumn, row: AssociationRow): string {
  return formatFieldValue(column, row.customData?.[column.name], state.relationLabels)
}

function totalPages(state: AssociationState) {
  return Math.max(1, Math.ceil(state.total / state.pageSize))
}
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="record-associations">
    <p v-if="loadingDefinitions" class="text-center text-xs text-brand-text-muted">Cargando asociaciones...</p>
    <p v-else-if="definitionsError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ definitionsError }}</p>

    <section
      v-for="definition in definitions"
      :key="definition.id"
      class="flex flex-col overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface"
      :data-testid="`association-${definition.id}`"
    >
      <header class="flex items-center justify-between gap-3 border-b border-brand-border-light px-4 py-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h3 class="flex items-center gap-1.5 text-sm font-bold text-brand-text">
            <Link2 class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            <span class="truncate">{{ definition.name }}</span>
          </h3>
          <p class="text-xs text-brand-text-muted">{{ definition.relatedName }}<span v-if="definition.selfRelation"> · mismo módulo</span></p>
        </div>
        <button
          v-if="definition.canLink"
          type="button"
          class="flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-semibold"
          :class="states[definition.id]?.pickerOpen ? 'border border-brand-border text-brand-text hover:bg-brand-bg' : 'bg-brand-orange text-white hover:bg-brand-orange-hover'"
          @click="togglePicker(definition.id)"
        >
          <template v-if="states[definition.id]?.pickerOpen"><X class="h-3.5 w-3.5" :stroke-width="1.75" /> Cerrar</template>
          <template v-else><Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Asociar</template>
        </button>
      </header>

      <div v-if="states[definition.id]?.pickerOpen" class="border-b border-brand-border-light bg-brand-bg p-3">
        <label class="flex items-center gap-2 rounded border border-brand-border bg-white px-2.5">
          <Search class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
          <input
            v-model="states[definition.id]!.search"
            type="search"
            class="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            :placeholder="`Buscar en ${definition.relatedName}…`"
            :aria-label="`Buscar en ${definition.relatedName}`"
            @input="onSearchInput(definition.id)"
          >
        </label>
        <ul class="mt-2 max-h-60 overflow-auto rounded border border-brand-border-light bg-white">
          <li v-if="states[definition.id]!.searching && !states[definition.id]!.candidates.length" class="px-3 py-3 text-xs text-brand-text-muted">Buscando…</li>
          <li v-else-if="!states[definition.id]!.candidates.length" class="px-3 py-3 text-xs text-brand-text-muted">No hay registros disponibles para asociar.</li>
          <li v-for="candidate in states[definition.id]!.candidates" :key="candidate.id" class="border-b border-brand-border-light last:border-b-0">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-brand-text hover:bg-brand-blue-bg disabled:opacity-60"
              :disabled="Boolean(states[definition.id]!.busyId)"
              @click="associate(definition, candidate)"
            >
              <span class="min-w-0 truncate">{{ candidate.label }}</span>
              <span class="shrink-0 text-xs font-semibold text-brand-blue">{{ states[definition.id]!.busyId === candidate.id ? 'Asociando…' : 'Asociar' }}</span>
            </button>
          </li>
        </ul>
      </div>

      <p v-if="states[definition.id]?.error" class="m-3 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-xs text-brand-error-text" role="alert">{{ states[definition.id]!.error }}</p>

      <div v-if="states[definition.id]">
        <p v-if="states[definition.id]!.loading && !states[definition.id]!.rows.length" class="p-6 text-center text-xs text-brand-text-muted">Cargando...</p>
        <p v-else-if="!states[definition.id]!.rows.length" class="p-6 text-center text-xs text-brand-text-muted">Sin registros asociados.</p>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="border-b border-brand-border-light bg-brand-bg">
              <tr>
                <th v-for="(column, index) in states[definition.id]!.columns" :key="column.name" class="whitespace-nowrap px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">{{ column.label }}<span v-if="index === 0" class="sr-only"> (abrir ficha)</span></th>
                <th v-if="!states[definition.id]!.columns.length" class="px-4 py-2.5 text-left text-[12px] font-bold text-brand-text-secondary">Registro</th>
                <th v-if="definition.canLink" class="sticky right-0 z-10 bg-brand-bg px-4 py-2.5 text-center shadow-[inset_1px_0_0_0_#e5e7eb] text-[12px] font-bold tracking-wide text-brand-text-secondary">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-brand-border-light">
              <tr v-for="row in states[definition.id]!.rows" :key="row.id" class="hover:bg-brand-bg">
                <td v-for="(column, index) in states[definition.id]!.columns" :key="column.name" class="px-4 py-2.5 text-brand-text">
                  <NuxtLink v-if="index === 0" :to="`/registros/${definition.relatedSlug}/${row.recordId}`" class="whitespace-nowrap font-semibold text-brand-blue hover:underline">{{ cell(states[definition.id]!, column, row) === '-' ? row.label : cell(states[definition.id]!, column, row) }}</NuxtLink>
                  <template v-else>{{ cell(states[definition.id]!, column, row) }}</template>
                </td>
                <td v-if="!states[definition.id]!.columns.length" class="px-4 py-2.5"><NuxtLink :to="`/registros/${definition.relatedSlug}/${row.recordId}`" class="font-semibold text-brand-blue hover:underline">{{ row.label }}</NuxtLink></td>
                <td v-if="definition.canLink" class="sticky right-0 bg-brand-surface px-4 py-2.5 text-center shadow-[inset_1px_0_0_0_#e5e7eb]">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded border border-brand-border-light px-2 py-1 text-xs font-semibold text-brand-text-secondary hover:bg-brand-error-bg hover:text-brand-error-text disabled:opacity-60"
                    :disabled="Boolean(states[definition.id]!.busyId)"
                    @click="unlink(definition, row)"
                  >
                    <Unlink class="h-3 w-3" :stroke-width="1.75" /> {{ states[definition.id]!.busyId === row.id ? 'Desvinculando…' : 'Desvincular' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer v-if="states[definition.id]!.total > states[definition.id]!.pageSize" class="flex items-center justify-between gap-3 border-t border-brand-border-light px-4 py-2 text-xs text-brand-text-secondary">
          <span>{{ states[definition.id]!.total }} registros</span>
          <span class="flex items-center gap-2">
            <button type="button" class="rounded border border-brand-border-light px-2 py-1 disabled:opacity-40" :disabled="states[definition.id]!.page <= 1 || states[definition.id]!.loading" @click="loadRows(definition.id, states[definition.id]!.page - 1)">Anterior</button>
            Página {{ states[definition.id]!.page }} de {{ totalPages(states[definition.id]!) }}
            <button type="button" class="rounded border border-brand-border-light px-2 py-1 disabled:opacity-40" :disabled="states[definition.id]!.page >= totalPages(states[definition.id]!) || states[definition.id]!.loading" @click="loadRows(definition.id, states[definition.id]!.page + 1)">Siguiente</button>
          </span>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// HU-ERD-51: listado de triggers (automatizaciones) del tenant - primera
// forma de administrar triggers/trigger_actions/trigger_logs desde afuera de
// un test (hasta esta HU, ERD-47/48/49/50, solo se manipulaban por SQL
// crudo). Sigue el diseno real de Screen/Triggers en ERPDinamico.pen -
// pantalla disenada para esta HU (no existia mock previo), revisada/creada
// con las herramientas de Pencil antes de este cambio, mismo patron que
// pages/modulos/index.vue: breadcrumb, toolbar con buscador + selector de
// modulo + boton "Nuevo trigger", tabla con toggle activo/inactivo inline y
// badge de la ultima ejecucion.
import { ChevronRight, Search, Settings2, Trash2, Zap } from '@lucide/vue'

definePageMeta({ layout: 'default' })

interface TriggerRow {
  id: string
  name: string
  entityId: string
  entitySlug: string
  entityName: string
  triggerEvent: string
  isActive: boolean
  actionsCount: number
  lastLogStatus: string | null
  createdAt: string
}

interface EntityOption {
  id: string
  name: string
}

const EVENT_LABELS: Record<string, string> = {
  on_create: 'Al crear',
  on_update: 'Al actualizar',
  on_delete: 'Al eliminar'
}

const STATUS_LABELS: Record<string, string> = {
  success: 'Éxito',
  failed: 'Fallido',
  retrying: 'Reintentando',
  dead_letter: 'Agotado'
}
const STATUS_CLASSES: Record<string, string> = {
  success: 'bg-brand-success-bg text-brand-success-text',
  failed: 'bg-brand-error-bg text-brand-error-text',
  retrying: 'bg-brand-warning-bg text-brand-warning-text',
  dead_letter: 'bg-brand-error-bg text-brand-error-text'
}

const { data: entitiesData } = await useFetch<{ entities: EntityOption[] }>('/api/entities', {
  key: 'triggers-entities',
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const entityFilter = ref('')
const { data, pending, error: fetchError, refresh } = await useFetch<TriggerRow[]>('/api/triggers', {
  key: 'triggers-list',
  query: computed(() => (entityFilter.value ? { entityId: entityFilter.value } : {})),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const search = ref('')
const filteredTriggers = computed(() => {
  const rows = data.value ?? []
  const term = search.value.trim().toLowerCase()
  if (!term) return rows
  return rows.filter((t) => t.name.toLowerCase().includes(term) || t.entityName.toLowerCase().includes(term))
})

const toggleError = ref<string | null>(null)
async function onToggleActive(row: TriggerRow) {
  toggleError.value = null
  const next = !row.isActive
  row.isActive = next
  try {
    await $fetch(`/api/triggers/${row.id}`, { method: 'PUT', body: { isActive: next } })
  } catch (err: any) {
    row.isActive = !next
    toggleError.value = err?.data?.statusMessage || 'No se pudo cambiar el estado del trigger'
  }
}

const deleteError = ref<string | null>(null)
const deletingId = ref<string | null>(null)
async function onDelete(row: TriggerRow) {
  if (!confirm(`Eliminar el trigger "${row.name}"? Esta acción no se puede deshacer.`)) return
  deleteError.value = null
  deletingId.value = row.id
  try {
    await $fetch(`/api/triggers/${row.id}`, { method: 'DELETE' })
    await refresh()
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el trigger'
  } finally {
    deletingId.value = null
  }
}

// Modal "Nuevo trigger" - crea el trigger "en blanco" (POST /api/triggers,
// condition {} sin configurar todavia) y navega directo al editor - el
// constructor visual de condicion/acciones vive en pages/triggers/[id]/editar.vue,
// no en este modal (mismo criterio que "Crear módulo" en pages/modulos/nuevo.vue,
// que tampoco arma el modulo completo en un solo paso).
const showCreate = ref(false)
const newName = ref('')
const newEntityId = ref('')
const newEvent = ref<'on_create' | 'on_update' | 'on_delete'>('on_create')
const createError = ref<string | null>(null)
const creating = ref(false)

function openCreate() {
  newName.value = ''
  newEntityId.value = entitiesData.value?.entities[0]?.id ?? ''
  newEvent.value = 'on_create'
  createError.value = null
  showCreate.value = true
}

async function onCreate() {
  createError.value = null
  creating.value = true
  try {
    const created = await $fetch<{ id: string }>('/api/triggers', {
      method: 'POST',
      body: { name: newName.value, entityId: newEntityId.value, triggerEvent: newEvent.value }
    })
    showCreate.value = false
    await navigateTo(`/triggers/${created.id}/editar`)
  } catch (err: any) {
    createError.value = err?.data?.statusMessage || 'No se pudo crear el trigger'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <span class="font-bold text-brand-text">Automatización</span>
    </div>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar el listado de triggers{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <div class="flex items-center justify-between">
        <div class="flex flex-col gap-1">
          <h1 class="text-[22px] font-bold text-brand-text">Automatización</h1>
          <p class="text-sm text-brand-text-secondary">Reglas que se disparan solas cuando algo pasa en tus módulos</p>
        </div>

        <div class="flex items-center gap-2.5">
          <div class="flex w-56 items-center gap-2 rounded border border-brand-border bg-brand-surface px-3 py-2">
            <Search class="h-[15px] w-[15px] shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            <input
              v-model="search"
              type="text"
              placeholder="Buscar trigger..."
              class="w-full text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none"
            />
          </div>
          <select
            v-model="entityFilter"
            class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:outline-none"
          >
            <option value="">Todos los módulos</option>
            <option v-for="e in entitiesData?.entities ?? []" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover"
            @click="openCreate"
          >
            <Zap class="h-4 w-4" :stroke-width="1.75" />
            Nuevo trigger
          </button>
        </div>
      </div>

      <p v-if="deleteError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ deleteError }}</p>
      <p v-if="toggleError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ toggleError }}</p>

      <p v-if="data.length === 0" class="text-sm text-brand-text-muted">Este tenant todavía no tiene triggers configurados.</p>
      <p v-else-if="filteredTriggers.length === 0" class="text-sm text-brand-text-muted">Ningún trigger coincide con "{{ search }}".</p>

      <div v-else class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
        <table class="min-w-full text-sm">
          <thead class="border-b border-brand-border-light bg-brand-bg">
            <tr>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Trigger</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Módulo</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Evento</th>
              <th class="px-4 py-2.5 text-right text-[12px] font-bold tracking-wide text-brand-text-secondary">Acciones</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Activo</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Última ejecución</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary" />
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-border-light">
            <tr v-for="row in filteredTriggers" :key="row.id" class="hover:bg-brand-bg">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-blue-bg">
                    <Zap class="h-4 w-4 text-brand-blue" :stroke-width="1.75" />
                  </div>
                  <span class="font-semibold text-brand-text">{{ row.name }}</span>
                </div>
              </td>
              <td class="px-4 py-3 text-brand-text-secondary">{{ row.entityName }}</td>
              <td class="px-4 py-3 text-brand-text-secondary">{{ EVENT_LABELS[row.triggerEvent] ?? row.triggerEvent }}</td>
              <td class="px-4 py-3 text-right text-brand-text">{{ row.actionsCount }} acción{{ row.actionsCount === 1 ? '' : 'es' }}</td>
              <td class="px-4 py-3">
                <button
                  type="button"
                  class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
                  :class="row.isActive ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
                  @click="onToggleActive(row)"
                >
                  <span class="h-[18px] w-[18px] rounded-full bg-white shadow" />
                </button>
              </td>
              <td class="px-4 py-3">
                <span
                  v-if="row.lastLogStatus"
                  class="rounded-full px-2 py-0.5 text-xs font-semibold"
                  :class="STATUS_CLASSES[row.lastLogStatus] ?? 'bg-brand-neutral-bg text-brand-neutral-text'"
                >{{ STATUS_LABELS[row.lastLogStatus] ?? row.lastLogStatus }}</span>
                <span v-else class="rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">Sin ejecuciones</span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5">
                  <NuxtLink
                    :to="`/triggers/${row.id}/editar`"
                    title="Editar"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-text-secondary hover:bg-brand-bg"
                  >
                    <Settings2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </NuxtLink>
                  <button
                    type="button"
                    title="Eliminar"
                    :disabled="deletingId === row.id"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-error-text hover:bg-brand-error-bg disabled:cursor-not-allowed disabled:opacity-60"
                    @click="onDelete(row)"
                  >
                    <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="showCreate" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showCreate = false">
      <div class="flex w-full max-w-[420px] flex-col rounded-lg bg-brand-surface shadow-xl">
        <div class="flex items-start justify-between border-b border-brand-border-light p-5">
          <div class="flex flex-col gap-0.5">
            <h2 class="text-[17px] font-bold text-brand-text">Nuevo trigger</h2>
            <p class="text-sm text-brand-text-secondary">Elige el módulo y el evento - configura la condición y las acciones después</p>
          </div>
        </div>
        <div class="flex flex-col gap-4 p-5">
          <div class="flex flex-col gap-1.5">
            <label for="trigger-name" class="text-[13px] font-semibold text-brand-text">Nombre <span class="text-brand-error-text">*</span></label>
            <input
              id="trigger-name"
              v-model="newName"
              type="text"
              placeholder="Ej. Notificar factura vencida"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="trigger-entity" class="text-[13px] font-semibold text-brand-text">Módulo <span class="text-brand-error-text">*</span></label>
            <select
              id="trigger-entity"
              v-model="newEntityId"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            >
              <option v-for="e in entitiesData?.entities ?? []" :key="e.id" :value="e.id">{{ e.name }}</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="trigger-event" class="text-[13px] font-semibold text-brand-text">Evento <span class="text-brand-error-text">*</span></label>
            <select
              id="trigger-event"
              v-model="newEvent"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            >
              <option value="on_create">Al crear</option>
              <option value="on_update">Al actualizar</option>
              <option value="on_delete">Al eliminar</option>
            </select>
          </div>
          <p v-if="createError" class="text-sm text-brand-error-text">{{ createError }}</p>
        </div>
        <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="showCreate = false">Cancelar</button>
          <button
            type="button"
            :disabled="creating || !newName || !newEntityId"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onCreate"
          >
            {{ creating ? 'Creando...' : 'Crear trigger' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowUp, FolderTree, Plus, Search, Trash2, X } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'
import { navigationLayoutSchema, type NavigationEntity, type NavigationGroup, type NavigationLayout } from '~/utils/moduleNavigation'
definePageMeta({ layout: 'default' })
type Entity = NavigationEntity & { isActive: boolean }
const { data, error, refresh } = await useFetch<{ layout: NavigationLayout; revision: number; entities: Entity[] }>('/api/navigation', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const layout = ref<NavigationLayout>({ groups: [] })
const revision = ref(0)
const baseline = ref('')
function accept(value: { layout: NavigationLayout; revision: number }) {
  layout.value = JSON.parse(JSON.stringify(value.layout))
  revision.value = value.revision
  baseline.value = JSON.stringify(layout.value)
}
if (data.value) accept(data.value)
const dirty = computed(() => JSON.stringify(layout.value) !== baseline.value)
const selectedId = ref<string | null>(layout.value.groups[0]?.id ?? null)
const selected = computed(() => layout.value.groups.find(group => group.id === selectedId.value))
const roots = computed(() => layout.value.groups.filter(group => !group.parentId))
const entities = computed(() => data.value?.entities ?? [])
const search = ref('')
const selectedEntities = computed(() => selected.value?.entityIds.flatMap(id => entities.value.find(entity => entity.id === id) ?? []) ?? [])
const available = computed(() => entities.value.filter(entity => !selected.value?.entityIds.includes(entity.id) && entity.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const unassigned = computed(() => entities.value.filter(entity => !layout.value.groups.some(group => group.entityIds.includes(entity.id))).length)
const saving = ref(false)
const saveError = ref('')
const toast = useToast()
function add(parentId: string | null) {
  const group: NavigationGroup = { id: crypto.randomUUID(), name: parentId ? 'Nuevo subgrupo' : 'Nuevo grupo', parentId, icon: parentId ? 'Package' : 'Factory', entityIds: [] }
  layout.value.groups.push(group)
  selectedId.value = group.id
}
function remove() {
  if (!selected.value) return
  const id = selected.value.id
  layout.value.groups = layout.value.groups.filter(group => group.id !== id && group.parentId !== id)
  selectedId.value = layout.value.groups[0]?.id ?? null
}
function owner(id: string) { return layout.value.groups.find(group => group.entityIds.includes(id))?.name }
function assign(id: string) {
  if (!selected.value) return
  for (const group of layout.value.groups) group.entityIds = group.entityIds.filter(entityId => entityId !== id)
  selected.value.entityIds.push(id)
}
function moveEntity(index: number, delta: number) {
  const ids = selected.value?.entityIds
  if (!ids || index + delta < 0 || index + delta >= ids.length) return
  const [id] = ids.splice(index, 1)
  ids.splice(index + delta, 0, id!)
}
function moveGroup(delta: number) {
  if (!selected.value) return
  const siblings = layout.value.groups.filter(group => group.parentId === selected.value!.parentId)
  const index = siblings.findIndex(group => group.id === selected.value!.id)
  const other = siblings[index + delta]
  if (!other) return
  const a = layout.value.groups.indexOf(selected.value)
  const b = layout.value.groups.indexOf(other)
  ;[layout.value.groups[a], layout.value.groups[b]] = [layout.value.groups[b]!, layout.value.groups[a]!]
}
function canMove(delta: number) {
  if (!selected.value) return false
  const siblings = layout.value.groups.filter(group => group.parentId === selected.value!.parentId)
  return !!siblings[siblings.findIndex(group => group.id === selected.value!.id) + delta]
}
async function save() {
  const parsed = navigationLayoutSchema.safeParse(layout.value)
  if (!parsed.success) { saveError.value = parsed.error.issues[0]!.message; return }
  saving.value = true
  saveError.value = ''
  try {
    const saved = await $fetch('/api/navigation', { method: 'PUT', body: { layout: parsed.data, revision: revision.value } })
    accept(saved)
    await refreshNuxtData('appnav-modules')
    toast.success('Menú actualizado', 'Los grupos ya están disponibles.')
  } catch (err: any) { saveError.value = err?.data?.statusMessage || 'No se pudo guardar el menú. Inténtalo de nuevo.' }
  finally { saving.value = false }
}
async function reload() { await refresh(); if (data.value) { accept(data.value); selectedId.value = layout.value.groups[0]?.id ?? null; saveError.value = '' } }
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-[22px] font-bold text-brand-text">Organización del menú</h1><p class="mt-1 text-sm text-brand-text-secondary">Organiza los módulos según el trabajo de cada equipo.</p></div>
      <button v-if="data" type="button" :disabled="saving || !dirty" class="rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-50" @click="save">{{ saving ? 'Guardando…' : 'Guardar organización' }}</button>
    </header>
    <p v-if="error" role="alert" class="text-sm text-brand-error-text">{{ error.statusCode === 403 ? 'Solo un administrador puede organizar los módulos.' : 'No se pudo cargar la organización del menú.' }}</p>
    <template v-else-if="data">
      <div class="flex flex-wrap items-center justify-between gap-3 rounded border border-brand-border-light bg-brand-surface px-4 py-3 text-xs text-brand-text-secondary">
        <span>Grupo → Subgrupo → Módulos · {{ unassigned }} sin asignar</span>
        <NuxtLink to="/roles" class="font-semibold text-brand-blue hover:underline">Configurar visibilidad por rol →</NuxtLink>
      </div>
      <p v-if="saveError" role="alert" class="text-sm text-brand-error-text">{{ saveError }} <button type="button" class="underline" @click="reload">Recargar configuración</button></p>
      <div class="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <section class="rounded-lg border border-brand-border-light bg-brand-surface">
          <div class="flex items-center justify-between border-b border-brand-border-light p-4"><h2 class="text-sm font-bold text-brand-text">Estructura del menú</h2><button type="button" title="Agregar grupo" aria-label="Agregar grupo" class="rounded p-1 text-brand-blue hover:bg-brand-bg" @click="add(null)"><Plus class="h-4 w-4" /></button></div>
          <div class="space-y-1 p-2">
            <p v-if="!roots.length" class="p-3 text-sm text-brand-text-muted">Crea un grupo como Empaque y embarque o Facturación.</p>
            <div v-for="area in roots" :key="area.id">
              <button type="button" class="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm font-semibold" :class="selectedId === area.id ? 'bg-brand-sidebar-active-bg text-brand-blue' : 'text-brand-text hover:bg-brand-bg'" @click="selectedId = area.id"><component :is="moduleIconComponent(area.icon)" class="h-4 w-4 shrink-0" /><span class="min-w-0 truncate">{{ area.name }}</span></button>
              <div class="ml-4 border-l border-brand-border-light pl-1">
                <button v-for="child in layout.groups.filter(group => group.parentId === area.id)" :key="child.id" type="button" class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm" :class="selectedId === child.id ? 'bg-brand-sidebar-active-bg text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg'" @click="selectedId = child.id"><component :is="moduleIconComponent(child.icon)" class="h-4 w-4 shrink-0" /><span class="min-w-0 truncate">{{ child.name }}</span></button>
                <button type="button" class="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-brand-blue" @click="add(area.id)"><Plus class="h-3 w-3" />Agregar subgrupo</button>
              </div>
            </div>
          </div>
          <button type="button" class="flex w-full items-center gap-2 border-t border-brand-border-light px-4 py-3 text-sm font-semibold text-brand-blue hover:bg-brand-bg" @click="add(null)"><Plus class="h-4 w-4" />Agregar grupo</button>
        </section>
        <section v-if="selected" class="min-w-0 rounded-lg border border-brand-border-light bg-brand-surface">
          <div class="flex flex-wrap items-end gap-4 border-b border-brand-border-light p-5">
            <IconPicker v-model="selected.icon" />
            <div class="min-w-0 flex-1"><label for="group-name" class="mb-1.5 block text-xs font-semibold text-brand-text-secondary">{{ selected.parentId ? 'Nombre del subgrupo' : 'Nombre del grupo' }}</label><input id="group-name" v-model="selected.name" maxlength="80" class="w-full rounded border border-brand-border px-3 py-2 text-sm text-brand-text focus:border-brand-orange focus:outline-none" /></div>
            <div class="flex gap-1"><button type="button" aria-label="Subir grupo" title="Subir grupo" :disabled="!canMove(-1)" class="rounded border border-brand-border p-2 text-brand-text-secondary disabled:opacity-30" @click="moveGroup(-1)"><ArrowUp class="h-4 w-4" /></button><button type="button" aria-label="Bajar grupo" title="Bajar grupo" :disabled="!canMove(1)" class="rounded border border-brand-border p-2 text-brand-text-secondary disabled:opacity-30" @click="moveGroup(1)"><ArrowDown class="h-4 w-4" /></button></div>
            <ReportOptionSelect v-if="selected.parentId" label="Grupo principal" :model-value="selected.parentId" :options="roots.map(area => ({ value: area.id, label: area.name }))" @update:model-value="selected.parentId = $event" />
          </div>
          <div class="grid gap-5 p-5 xl:grid-cols-2">
            <div class="min-w-0"><h2 class="text-sm font-bold text-brand-text">Módulos del grupo <span class="font-normal text-brand-text-muted">({{ selectedEntities.length }})</span></h2><p class="mb-3 mt-1 text-xs text-brand-text-muted">Ordena con las flechas. Los catálogos se utilizan desde los selectores.</p>
              <p v-if="!selectedEntities.length" class="rounded border border-dashed border-brand-border p-5 text-sm text-brand-text-muted">Agrega módulos desde la lista de disponibles.</p>
              <ol class="divide-y divide-brand-border-light"><li v-for="(entity, index) in selectedEntities" :key="entity.id" class="flex items-center gap-2 py-3"><component :is="moduleIconComponent(entity.icon)" class="h-4 w-4 shrink-0 text-brand-text-secondary" /><div class="min-w-0 flex-1"><p class="text-sm font-medium text-brand-text">{{ entity.name }}</p><p class="text-[11px] text-brand-text-muted">{{ entity.moduleKind === 'dimension' ? 'Catálogo' : 'Módulo' }}{{ !entity.isActive ? ' · Inactivo' : '' }}</p></div><button type="button" :aria-label="`Subir ${entity.name}`" :disabled="index === 0" class="p-1 text-brand-text-secondary disabled:opacity-25" @click="moveEntity(index, -1)"><ArrowUp class="h-3.5 w-3.5" /></button><button type="button" :aria-label="`Bajar ${entity.name}`" :disabled="index === selectedEntities.length - 1" class="p-1 text-brand-text-secondary disabled:opacity-25" @click="moveEntity(index, 1)"><ArrowDown class="h-3.5 w-3.5" /></button><button type="button" :aria-label="`Quitar ${entity.name} del grupo`" class="p-1 text-brand-text-muted hover:text-brand-error-text" @click="selected.entityIds = selected.entityIds.filter(id => id !== entity.id)"><X class="h-4 w-4" /></button></li></ol>
            </div>
            <div class="min-w-0"><h2 class="text-sm font-bold text-brand-text">Disponibles para agregar</h2><div class="my-3 flex items-center gap-2 rounded border border-brand-border px-3 py-2"><Search class="h-4 w-4 text-brand-text-muted" /><input v-model="search" aria-label="Buscar módulos" placeholder="Buscar módulo…" class="min-w-0 flex-1 text-sm text-brand-text outline-none" /></div>
              <div class="max-h-[440px] overflow-y-auto"><button v-for="entity in available" :key="entity.id" type="button" class="flex w-full items-center gap-2 rounded px-2 py-2.5 text-left hover:bg-brand-bg" :aria-label="`${owner(entity.id) ? 'Mover' : 'Agregar'} ${entity.name}`" @click="assign(entity.id)"><component :is="moduleIconComponent(entity.icon)" class="h-4 w-4 shrink-0 text-brand-text-secondary" /><span class="min-w-0 flex-1"><span class="block text-sm text-brand-text">{{ entity.name }}</span><span class="block text-[11px] text-brand-text-muted">{{ entity.moduleKind === 'dimension' ? 'Catálogo' : 'Módulo' }} · {{ owner(entity.id) ? `Mover desde ${owner(entity.id)}` : 'Sin asignar' }}</span></span><Plus class="h-4 w-4 text-brand-blue" /></button><p v-if="!available.length" class="py-4 text-sm text-brand-text-muted">No hay módulos que coincidan.</p></div>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-brand-border-light px-5 py-4"><p class="max-w-lg text-xs text-brand-text-muted">Quitar un grupo deja sus módulos sin asignar. Sus registros y relaciones se conservan.</p><button type="button" class="flex items-center gap-1.5 text-xs font-semibold text-brand-error-text" @click="remove"><Trash2 class="h-3.5 w-3.5" />Quitar {{ selected.parentId ? 'subgrupo' : 'grupo' }}</button></div>
        </section>
        <div v-else class="flex min-h-72 flex-col items-center justify-center gap-3 text-center"><FolderTree class="h-9 w-9 text-brand-text-muted" /><h2 class="text-base font-semibold text-brand-text">El menú empieza con un grupo</h2><p class="max-w-sm text-sm text-brand-text-secondary">Después podrás agregar subgrupos y asignar los módulos que usa tu equipo.</p><button type="button" class="mt-2 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white" @click="add(null)">Crear primer grupo</button></div>
      </div>
      <p class="text-xs text-brand-text-muted">{{ dirty ? 'Tienes cambios sin guardar. ' : '' }}La organización del menú no cambia permisos ni relaciones. Cada usuario verá solo los módulos habilitados para su rol.</p>
    </template>
  </div>
</template>

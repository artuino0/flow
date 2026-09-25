<script setup lang="ts">
// Tabla editable de registros hijos dentro de la ficha de un registro padre
// ("líneas" o "partidas"). Es genérica: cualquier módulo con un campo `relation`
// hacia el padre puede mostrarse así (detailLayout.relations[].editable) y sumar
// campos numéricos al pie (detailLayout.relations[].totals). Las escrituras usan
// los endpoints normales de /api/records, así que permisos, validaciones y campos
// calculados del módulo hijo se aplican igual que en su propio formulario.
import { computed, ref, watch } from 'vue'
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import type { EntityFieldMeta, EntityPermissions, ListLayout } from '~/composables/useEntityFields'

const props = defineProps<{
  parentId: string
  childSlug: string
  childName: string
  fieldName: string
  totals?: string[]
  /** Etiqueta del registro padre, se muestra bajo el título del panel. */
  parentLabel?: string
}>()
const emit = defineEmits<{ changed: [] }>()
const toast = useToast()

interface Row { id: string; customData: Record<string, unknown> }
const PAGE_SIZE = 100
const fields = ref<EntityFieldMeta[]>([])
const entityId = ref('')
const listLayout = ref<ListLayout | null>(null)
const permissions = ref<EntityPermissions>({ canRead: true, canCreate: false, canUpdate: false, canDelete: false })
const rows = ref<Row[]>([])
const total = ref(0)
const relationLabels = ref<Record<string, Record<string, string>>>({})
const totalsValues = ref<Record<string, number>>({})
const loading = ref(true)
const loadError = ref<string | null>(null)
const editing = ref<{ id: string | null; values: Record<string, unknown> } | null>(null)
const saving = ref(false)
const drawerRef = ref<{ focusFirst: () => Promise<void> } | null>(null)
const formRef = ref<{ validateAll: () => boolean } | null>(null)
const busyId = ref<string | null>(null)
const pendingDelete = ref<Row | null>(null)

const HIDDEN_TYPES = new Set(['file', 'tabla', 'json'])
const columns = computed(() => {
  const usable = fields.value.filter(f => f.name !== 'id' && f.name !== props.fieldName && !HIDDEN_TYPES.has(f.dataType))
  const visible = listLayout.value?.columns.filter(c => c.visible).map(c => c.name)
  const ordered = visible?.length ? visible.map(name => usable.find(f => f.name === name)).filter((f): f is EntityFieldMeta => Boolean(f)) : usable
  const base = (ordered.length ? ordered : usable).slice(0, 8)
  // Los campos a totalizar siempre se muestran, aunque el listado del módulo no los incluya.
  const extra = (props.totals ?? []).map(name => usable.find(f => f.name === name)).filter((f): f is EntityFieldMeta => Boolean(f) && !base.some(b => b.name === f!.name))
  return [...base, ...extra]
})
const formFields = computed(() => fields.value.filter(f => f.name !== props.fieldName))
const summable = computed(() => (props.totals ?? []).map(name => fields.value.find(f => f.name === name)).filter((f): f is EntityFieldMeta => Boolean(f)))
const canWrite = computed(() => permissions.value.canCreate)

function errorMessage(err: any, fallback: string) {
  const details = err?.data?.data?.fieldErrors
  const first = details && Object.values(details).flat()[0]
  return (typeof first === 'string' ? first : null) || err?.data?.statusMessage || fallback
}

async function loadTotals() {
  if (!props.totals?.length) { totalsValues.value = {}; return }
  try {
    const res = await $fetch<{ totals: Record<string, number> }>(`/api/records/${props.childSlug}/totals`, {
      query: { filterField: props.fieldName, filterValue: props.parentId, fields: props.totals.join(',') }
    })
    totalsValues.value = res.totals
  } catch { totalsValues.value = {} }
}

async function loadRows() {
  const res = await $fetch<{ data: Row[]; total: number; relationLabels: Record<string, Record<string, string>> }>(`/api/records/${props.childSlug}`, {
    query: { filterField: props.fieldName, filterValues: props.parentId, pageSize: PAGE_SIZE, sortBy: 'createdAt', sortDir: 'asc' }
  })
  rows.value = res.data
  total.value = res.total
  relationLabels.value = res.relationLabels ?? {}
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const meta = await $fetch<{ entity: { id: string }; fields: EntityFieldMeta[]; permissions: EntityPermissions; listLayout: ListLayout }>(`/api/entities/${props.childSlug}/fields`)
    fields.value = meta.fields
    entityId.value = meta.entity.id
    permissions.value = meta.permissions
    listLayout.value = meta.listLayout
    await Promise.all([loadRows(), loadTotals()])
  } catch (err) {
    loadError.value = errorMessage(err, `No se pudo cargar ${props.childName}`)
  } finally {
    loading.value = false
  }
}
watch(() => [props.parentId, props.childSlug, props.fieldName, (props.totals ?? []).join(',')], load, { immediate: true })

async function refreshAfterWrite() {
  await Promise.all([loadRows(), loadTotals()])
  emit('changed')
}

function startAdd() {
  editing.value = { id: null, values: {} }
}
function startEdit(row: Row) {
  editing.value = { id: row.id, values: JSON.parse(JSON.stringify(row.customData)) }
}
function cancel() {
  editing.value = null
}

async function save(addAnother = false) {
  const current = editing.value
  if (!current || saving.value) return
  if (formRef.value && !formRef.value.validateAll()) return
  saving.value = true
  try {
    const customData = { ...current.values, [props.fieldName]: props.parentId }
    if (current.id) await $fetch(`/api/records/${props.childSlug}/${current.id}`, { method: 'PUT', body: { customData } })
    else await $fetch(`/api/records/${props.childSlug}`, { method: 'POST', body: { customData } })
    toast.success(current.id ? 'Línea actualizada' : 'Línea agregada', `${props.childName} se guardó correctamente.`)
    editing.value = addAnother && !current.id ? { id: null, values: {} } : null
    await refreshAfterWrite()
    if (editing.value) void drawerRef.value?.focusFirst()
  } catch (err) {
    toast.error('No se pudo guardar', errorMessage(err, 'No se pudo guardar la línea'))
  } finally {
    saving.value = false
  }
}

function remove(row: Row) {
  if (busyId.value) return
  pendingDelete.value = row
}

async function confirmRemove() {
  const row = pendingDelete.value
  if (!row || busyId.value) return
  pendingDelete.value = null
  busyId.value = row.id
  try {
    await $fetch(`/api/records/${props.childSlug}/${row.id}`, { method: 'DELETE' })
    toast.success('Línea eliminada', 'La línea se eliminó correctamente.')
    await refreshAfterWrite()
  } catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err, 'No se pudo eliminar la línea'))
  } finally {
    busyId.value = null
  }
}

function totalText(field: EntityFieldMeta): string {
  return formatFieldValue(field.dataType === 'currency' ? field : { ...field, dataType: 'number' }, totalsValues.value[field.name] ?? 0)
}
</script>

<template>
  <div data-testid="record-lines">
    <p v-if="loading && !rows.length" class="p-6 text-center text-xs text-brand-text-muted">Cargando...</p>
    <p v-else-if="loadError" class="m-3 rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-xs text-brand-error-text" role="alert">{{ loadError }}</p>
    <template v-else>
      <p v-if="!rows.length" class="p-6 text-center text-xs text-brand-text-muted">Sin registros todavía.</p>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="border-b border-brand-border-light bg-brand-bg">
            <tr>
              <th v-for="field in columns" :key="field.name" class="whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">{{ field.label }}</th>
              <th v-if="permissions.canUpdate || permissions.canDelete" class="sticky right-0 z-10 bg-brand-bg px-3 py-2.5 text-center shadow-[inset_1px_0_0_0_#e5e7eb] text-[12px] font-bold tracking-wide text-brand-text-secondary">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-border-light">
            <tr v-for="row in rows" :key="row.id" class="hover:bg-brand-bg">
              <td v-for="(field, index) in columns" :key="field.name" class="whitespace-nowrap px-3 py-2.5 text-brand-text">
                <NuxtLink v-if="index === 0" :to="`/registros/${childSlug}/${row.id}`" class="whitespace-nowrap font-semibold text-brand-blue hover:underline">{{ formatFieldValue(field, row.customData[field.name], relationLabels) }}</NuxtLink>
                <template v-else>{{ formatFieldValue(field, row.customData[field.name], relationLabels) }}</template>
              </td>
              <td v-if="permissions.canUpdate || permissions.canDelete" class="sticky right-0 whitespace-nowrap bg-brand-surface px-3 py-2.5 text-center shadow-[inset_1px_0_0_0_#e5e7eb]">
                <button v-if="permissions.canUpdate" type="button" title="Editar línea" aria-label="Editar línea" class="rounded p-1.5 text-brand-text-secondary hover:bg-brand-blue-bg hover:text-brand-blue" :disabled="Boolean(busyId) || saving" @click="startEdit(row)"><Pencil class="h-3.5 w-3.5" :stroke-width="1.75" /></button>
                <button v-if="permissions.canDelete" type="button" title="Eliminar línea" aria-label="Eliminar línea" class="rounded p-1.5 text-brand-text-secondary hover:bg-brand-error-bg hover:text-brand-error-text disabled:opacity-60" :disabled="Boolean(busyId) || saving" @click="remove(row)"><Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" /></button>
              </td>
            </tr>
          </tbody>
          <tfoot v-if="summable.length" class="border-t-2 border-brand-border-light bg-brand-bg">
            <tr>
              <td v-for="(field, index) in columns" :key="field.name" class="whitespace-nowrap px-3 py-2.5 text-sm font-bold text-brand-text" :data-total="field.name">
                <template v-if="summable.some(s => s.name === field.name)">{{ totalText(field) }}</template>
                <template v-else-if="index === 0">Total</template>
              </td>
              <td v-if="permissions.canUpdate || permissions.canDelete" class="sticky right-0 bg-brand-bg" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p v-if="total > rows.length" class="border-t border-brand-border-light px-4 py-2 text-xs text-brand-text-muted">Mostrando {{ rows.length }} de {{ total }} registros.</p>
      <div v-if="canWrite" class="border-t border-brand-border-light p-3">
        <button type="button" class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="startAdd">
          <Plus class="h-3.5 w-3.5" :stroke-width="1.75" /> Agregar línea
        </button>
      </div>
    </template>

    <RecordDrawer ref="drawerRef" :open="Boolean(editing)" :title="editing?.id ? `Editar línea` : `Nueva línea`" :subtitle="parentLabel ? `${childName} · ${parentLabel}` : childName" :busy="saving" @close="cancel">
      <DynamicForm v-if="editing" ref="formRef" v-model="editing.values" :fields="formFields" :entity-id="entityId" :disabled="saving" />
      <template #footer>
        <button type="button" class="rounded border border-brand-border px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg disabled:opacity-60" :disabled="saving" @click="cancel">Cancelar</button>
        <button v-if="!editing?.id" type="button" class="rounded border border-brand-orange px-3 py-2 text-[13px] font-semibold text-brand-orange hover:bg-brand-bg disabled:opacity-60" :disabled="saving" @click="save(true)">Guardar y agregar otra</button>
        <button type="button" class="rounded bg-brand-orange px-3 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-60" :disabled="saving" @click="save(false)">{{ saving ? 'Guardando…' : 'Guardar' }}</button>
      </template>
    </RecordDrawer>
    <SettingsConfirmDialog v-if="pendingDelete" title="Eliminar línea" confirm-label="Eliminar" cancel-label="Cancelar" @cancel="pendingDelete = null" @confirm="confirmRemove">¿Eliminar esta línea? Esta acción no se puede deshacer.</SettingsConfirmDialog>
  </div>
</template>

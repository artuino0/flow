<script setup lang="ts">
import { ArrowUpRight, Building2, Mail, MoreVertical, Phone, UserRound } from '@lucide/vue'
import type { BoardConfig, EntityFieldMeta, StateWorkflowConfig } from '~/composables/useEntityFields'

interface BoardRecord {
  id: string
  customData: Record<string, unknown>
  updatedAt: string
}
interface BoardColumn {
  key: string
  label: string
  color?: string
  records: BoardRecord[]
  total: number
}

const props = defineProps<{
  entitySlug: string
  config: BoardConfig
  fields: EntityFieldMeta[]
  columns: BoardColumn[]
  relationLabels?: Record<string, Record<string, string>>
  canUpdate: boolean
  search?: string
  filterField?: string | null
  filterValues?: string[]
  filterOperator?: string
  workflowConfig?: StateWorkflowConfig | null
  userRoleId?: string | null
}>()
const emit = defineEmits<{ updated: [record: BoardRecord] }>()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()
const localColumns = ref<BoardColumn[]>([])
const movingId = ref<string | null>(null)
const draggedId = ref<string | null>(null)
const loadingColumn = ref<string | null>(null)
const localRelationLabels = ref<Record<string, Record<string, string>>>({})

watch(() => props.columns, value => {
  localColumns.value = value.map(column => ({ ...column, records: column.records.map(record => ({ ...record, customData: { ...record.customData } })) }))
}, { immediate: true, deep: true })
watch(() => props.relationLabels, value => {
  localRelationLabels.value = Object.fromEntries(Object.entries(value || {}).map(([field, labels]) => [field, { ...labels }]))
}, { immediate: true, deep: true })

const fieldsByName = computed(() => new Map(props.fields.map(field => [field.name, field])))
const statusOptions = computed(() => localColumns.value.filter(column => column.key !== '__unset__'))

function fieldLabel(name: string) {
  return fieldsByName.value.get(name)?.label ?? name
}
function isFileField(name: string) { return fieldsByName.value.get(name)?.dataType === 'file' }
function fileId(record: BoardRecord, name: string) {
  const value = record.customData[name]
  return typeof value === 'string' ? value : ''
}
function displayValue(record: BoardRecord, name: string): string {
  const field = fieldsByName.value.get(name)
  const value = record.customData[name]
  if (value === null || value === undefined || value === '') return '—'
  if (field?.dataType === 'relation') return localRelationLabels.value[name]?.[String(value)] ?? String(value).slice(0, 8)
  if (field?.dataType === 'user') return (Array.isArray(value) ? value : [value]).map(id => localRelationLabels.value[name]?.[String(id)] ?? `${String(id).slice(0, 8)} (inactivo)`).join(', ')
  if (field?.dataType === 'select') {
    const options = Array.isArray(field.validationRules?.options) ? field.validationRules.options as Array<{ value: string; label: string }> : []
    return options.find(option => option.value === value)?.label ?? String(value)
  }
  if (field?.dataType === 'boolean') return value ? 'Sí' : 'No'
  if (field?.dataType === 'file') return 'Archivo'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
function fieldIcon(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes('mail') || normalized.includes('correo')) return Mail
  if (normalized.includes('tel') || normalized.includes('phone')) return Phone
  if (normalized.includes('empresa') || normalized.includes('company')) return Building2
  return UserRound
}
function colorValue(color?: string) {
  const semantic: Record<string, string> = {
    blue: 'rgb(var(--brand-blue))', cyan: 'rgb(var(--brand-stage-cyan))', success: 'rgb(var(--brand-success-text))', green: 'rgb(var(--brand-success-text))',
    warning: 'rgb(var(--brand-warning-text))', yellow: 'rgb(var(--brand-warning-text))', orange: 'rgb(var(--brand-orange))', error: 'rgb(var(--brand-error-text))',
    red: 'rgb(var(--brand-error-text))', purple: 'rgb(var(--brand-stage-purple))', gray: 'rgb(var(--brand-text-muted))', grey: 'rgb(var(--brand-text-muted))'
  }
  if (!color) return 'rgb(var(--brand-text-muted))'
  return semantic[color.toLowerCase()] || (/^(#|rgb|hsl)/i.test(color) ? color : 'rgb(var(--brand-text-muted))')
}
function startDrag(recordId: string, event: DragEvent) {
  if (!props.canUpdate) return
  draggedId.value = recordId
  event.dataTransfer?.setData('text/plain', recordId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function finishDrag() {
  window.setTimeout(() => { draggedId.value = null }, 0)
}
async function moveRecord(recordId: string, targetKey: string) {
  if (!props.canUpdate || movingId.value) return
  const source = localColumns.value.find(column => column.records.some(record => record.id === recordId))
  const target = localColumns.value.find(column => column.key === targetKey)
  const record = source?.records.find(item => item.id === recordId)
  if (!source || !target || !record || source.key === target.key || !props.config.statusField) return
  if (props.workflowConfig?.enabled) {
    const current = String(record.customData[props.workflowConfig.field] ?? '')
    const allowed = !props.workflowConfig.states[current] || props.workflowConfig.transitions.some(item => item.from === current && item.to === targetKey && (item.roles === 'all' || Boolean(props.userRoleId && item.roles.includes(props.userRoleId))))
    if (!allowed) {
      toast.error('Transición no permitida', `No tienes permiso para pasar de “${source.label}” a “${target.label}”.`)
      return
    }
  }

  const snapshot = localColumns.value.map(column => ({ ...column, records: [...column.records], total: column.total }))
  source.records = source.records.filter(item => item.id !== recordId)
  source.total = Math.max(0, source.total - 1)
  const nextValue = targetKey === '__unset__' ? null : targetKey
  const optimistic = { ...record, customData: { ...record.customData, [props.config.statusField]: nextValue } }
  target.records = [optimistic, ...target.records]
  target.total += 1
  movingId.value = recordId

  try {
    const body = { changes: { [props.config.statusField]: nextValue }, expectedUpdatedAt: record.updatedAt }
    let updated: BoardRecord
    try {
      updated = await $fetch<BoardRecord>(`/api/records/${props.entitySlug}/${recordId}`, { method: 'PATCH', body })
    } catch (error) {
      const warnings = (error as { data?: { data?: { warnings?: string[] } } })?.data?.data?.warnings
      if (!warnings?.length || !await confirmAction({ title: 'Advertencias de transición', message: warnings.join('\n'), confirmLabel: 'Continuar de todos modos' })) throw error
      updated = await $fetch<BoardRecord>(`/api/records/${props.entitySlug}/${recordId}`, { method: 'PATCH', body: { ...body, acknowledgeWarnings: true } })
    }
    optimistic.updatedAt = updated.updatedAt
    optimistic.customData = { ...updated.customData }
    emit('updated', updated)
    toast.updated('Estado actualizado', `El registro ahora está en “${target.label}”.`)
  } catch (error: any) {
    localColumns.value = snapshot
    toast.error('No se pudo cambiar el estado', error?.data?.statusMessage || 'Actualiza el tablero e inténtalo otra vez.')
  } finally {
    movingId.value = null
    draggedId.value = null
  }
}
function onDrop(columnKey: string, event: DragEvent) {
  event.preventDefault()
  const id = event.dataTransfer?.getData('text/plain') || draggedId.value
  if (id) void moveRecord(id, columnKey)
}
async function loadMore(column: BoardColumn) {
  if (loadingColumn.value || column.records.length >= column.total) return
  loadingColumn.value = column.key
  try {
    const response = await $fetch<{
      columns: BoardColumn[]
      relationLabels?: Record<string, Record<string, string>>
    }>(`/api/records/${props.entitySlug}/board`, {
      query: {
        column: column.key,
        offset: column.records.length,
        pageSize: 40,
        search: props.search || undefined,
        filterField: props.filterField || undefined,
        filterValues: props.filterValues?.length ? props.filterValues.join(',') : undefined,
        filterOperator: props.filterField ? props.filterOperator : undefined
      }
    })
    const next = response.columns[0]
    if (next) {
      const known = new Set(column.records.map(record => record.id))
      column.records.push(...next.records.filter(record => !known.has(record.id)))
      column.total = next.total
    }
    for (const [field, labels] of Object.entries(response.relationLabels || {})) {
      localRelationLabels.value[field] = { ...(localRelationLabels.value[field] || {}), ...labels }
    }
  } catch (error: any) {
    toast.error('No se pudieron cargar más registros', error?.data?.statusMessage || 'Inténtalo de nuevo.')
  } finally {
    loadingColumn.value = null
  }
}
function cardInitials(record: BoardRecord) {
  if (props.config.titleField && isFileField(props.config.titleField)) return record.id.slice(0, 2).toUpperCase()
  const source = props.config.titleField ? displayValue(record, props.config.titleField) : record.id.slice(0, 8)
  const parts = source.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase()
}
function formatUpdated(value: string) {
  const time = new Date(value).getTime()
  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return 'Ahora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `Hace ${days} d`
}

function openRecord(recordId: string) {
  if (draggedId.value) return
  void navigateTo(`/registros/${props.entitySlug}/${recordId}`)
}
</script>

<template>
  <div class="kanban-shell">
    <div class="kanban-scroll">
      <section
        v-for="column in localColumns"
        :key="column.key"
        class="kanban-column"
        @dragover.prevent
        @drop="onDrop(column.key, $event)"
      >
        <header class="column-header">
          <div class="column-title">
            <span class="status-mark" :style="{ backgroundColor: colorValue(column.color) }" />
            <h2>{{ column.label }}</h2>
            <span class="column-count">{{ column.total }}</span>
          </div>
          <button type="button" class="column-menu" :aria-label="'Acciones de ' + column.label">
            <MoreVertical :size="16" :stroke-width="1.75" />
          </button>
        </header>

        <div class="column-body">
          <article
            v-for="record in column.records"
            :key="record.id"
            class="kanban-card"
            :class="{ moving: movingId === record.id, draggable: canUpdate }"
            :draggable="canUpdate"
            tabindex="0"
            @dragstart="startDrag(record.id, $event)"
            @dragend="finishDrag"
            @click="openRecord(record.id)"
            @keydown.enter="openRecord(record.id)"
          >
            <div class="card-top">
              <div class="card-title-copy">
                <DynamicFileValue v-if="config.titleField && isFileField(config.titleField) && fileId(record, config.titleField)" :file-id="fileId(record, config.titleField)" compact />
                <FieldDateValue v-else-if="config.titleField && fieldsByName.get(config.titleField)?.dataType === 'date'" :value="record.customData[config.titleField]" :rules="fieldsByName.get(config.titleField)?.validationRules" />
                <strong v-else>{{ config.titleField ? displayValue(record, config.titleField) : record.id.slice(0, 8) }}</strong>
                <DynamicFileValue v-if="config.secondaryFields[0] && isFileField(config.secondaryFields[0]) && fileId(record, config.secondaryFields[0])" :file-id="fileId(record, config.secondaryFields[0])" compact />
                <FieldDateValue v-else-if="config.secondaryFields[0] && fieldsByName.get(config.secondaryFields[0])?.dataType === 'date'" :value="record.customData[config.secondaryFields[0]]" :rules="fieldsByName.get(config.secondaryFields[0])?.validationRules" />
                <span v-else-if="config.secondaryFields[0]">{{ displayValue(record, config.secondaryFields[0]) }}</span>
              </div>
              <button type="button" class="card-menu" aria-label="Acciones del registro" @click.stop>
                <MoreVertical :size="15" :stroke-width="1.75" />
              </button>
            </div>

            <dl v-if="config.secondaryFields.slice(1, 3).length" class="card-meta">
              <div v-for="field in config.secondaryFields.slice(1, 3)" :key="field">
                <component :is="fieldIcon(field)" :size="12" :stroke-width="1.75" />
                <dt class="sr-only">{{ fieldLabel(field) }}</dt>
                <dd><DynamicFileValue v-if="isFileField(field) && fileId(record, field)" :file-id="fileId(record, field)" compact /><FieldDateValue v-else-if="fieldsByName.get(field)?.dataType === 'date'" :value="record.customData[field]" :rules="fieldsByName.get(field)?.validationRules" /><template v-else>{{ displayValue(record, field) }}</template></dd>
              </div>
            </dl>

            <div class="stage-badge">
              <span :style="{ backgroundColor: colorValue(column.color) }" />
              {{ column.label }}
            </div>

            <footer class="card-footer">
              <span class="card-avatar">{{ cardInitials(record) }}</span>
              <span class="updated-at">{{ formatUpdated(record.updatedAt) }}</span>
              <ArrowUpRight :size="14" :stroke-width="1.75" />
            </footer>

            <label v-if="canUpdate" class="mobile-status" @click.stop>
              <span>Estado</span>
              <select :value="String(record.customData[config.statusField || ''] ?? '')" @change="moveRecord(record.id, ($event.target as HTMLSelectElement).value || '__unset__')">
                <option value="">Sin estado</option>
                <option v-for="option in statusOptions" :key="option.key" :value="option.key">{{ option.label }}</option>
              </select>
            </label>
          </article>

          <div v-if="!column.records.length" class="column-empty">
            <span class="empty-icon">+</span>
            <strong>Sin registros</strong>
            <p>Arrastra aquí una tarjeta</p>
          </div>

          <button
            v-if="column.total > column.records.length"
            class="column-more"
            type="button"
            :disabled="loadingColumn === column.key"
            @click="loadMore(column)"
          >
            {{ loadingColumn === column.key ? 'Cargando…' : 'Cargar más' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.kanban-shell{height:100%;min-height:0;min-width:0;overflow:hidden}
.kanban-scroll{display:flex;height:100%;min-height:0;align-items:stretch;gap:16px;overflow-x:auto;overflow-y:hidden;padding:0;scrollbar-width:thin;scrollbar-color:rgb(var(--brand-border)) transparent}
.kanban-scroll::-webkit-scrollbar{height:8px}.kanban-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:rgb(var(--brand-border))}
.kanban-column{display:flex;height:100%;min-height:0;width:292px;min-width:292px;flex-direction:column;overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:8px;background:rgb(var(--brand-kanban-column))}
.column-header{display:flex;height:41px;min-height:41px;align-items:center;justify-content:space-between;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-surface));padding:0 14px}
.column-title{display:flex;min-width:0;align-items:center;gap:8px}.status-mark{height:8px;width:8px;flex:none;border-radius:999px}.column-title h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700;color:rgb(var(--brand-text))}.column-count{min-width:24px;border-radius:999px;background:rgb(var(--brand-neutral-bg));padding:2px 7px;text-align:center;font-size:11px;font-weight:700;line-height:15px;color:rgb(var(--brand-text-secondary))}
.column-menu,.card-menu{display:flex;flex:none;align-items:center;justify-content:center;border-radius:4px;color:rgb(var(--brand-text-muted))}.column-menu{height:26px;width:26px}.card-menu{height:24px;width:18px}.column-menu:hover,.card-menu:hover{background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary))}
.column-body{display:flex;min-height:0;flex:1;flex-direction:column;gap:10px;overflow-y:auto;padding:14px;scrollbar-width:thin;scrollbar-color:rgb(var(--brand-border)) transparent}.column-body::-webkit-scrollbar{width:5px}.column-body::-webkit-scrollbar-thumb{border-radius:999px;background:rgb(var(--brand-border))}
.kanban-card{display:flex;min-height:173px;flex:none;flex-direction:column;gap:10px;border:1px solid rgb(var(--brand-border-light));border-radius:8px;background:rgb(var(--brand-surface));padding:14px;box-shadow:0 1px 2px rgb(var(--brand-shadow) / .03);cursor:pointer;transition:border-color .14s ease,box-shadow .14s ease,transform .14s ease}
.kanban-card.draggable{cursor:grab}.kanban-card.draggable:active{cursor:grabbing}.kanban-card:hover,.kanban-card:focus-visible{border-color:rgb(var(--brand-kanban-focus));box-shadow:0 5px 16px rgb(var(--brand-shadow) / .1);outline:none;transform:translateY(-1px)}.kanban-card.moving{opacity:.55}
.card-top{display:flex;min-height:34px;align-items:flex-start}.card-title-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}.card-title-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700;line-height:17px;color:rgb(var(--brand-text))}.card-title-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;line-height:15px;color:rgb(var(--brand-text-secondary))}
.card-meta{display:flex;min-height:34px;flex-direction:column;gap:4px}.card-meta>div{display:flex;min-width:0;align-items:center;gap:6px;color:rgb(var(--brand-text-muted))}.card-meta dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:15px}
.stage-badge{display:flex;height:19px;width:max-content;max-width:100%;align-items:center;gap:5px;border-radius:999px;background:rgb(var(--brand-neutral-bg));padding:0 9px;font-size:11px;font-weight:600;color:rgb(var(--brand-text-secondary))}.stage-badge>span{height:6px;width:6px;flex:none;border-radius:999px}
.card-footer{display:flex;height:28px;align-items:center;border-top:1px solid rgb(var(--brand-border-light));padding-top:6px;color:rgb(var(--brand-text-muted))}.card-avatar{display:flex;height:22px;width:22px;align-items:center;justify-content:center;border-radius:999px;background:rgb(var(--brand-blue-bg));font-size:10px;font-weight:700;color:rgb(var(--brand-blue))}.updated-at{margin-left:auto;margin-right:auto;font-size:11px}
.column-empty{display:flex;min-height:145px;flex:none;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:rgb(var(--brand-text-muted))}.empty-icon{display:flex;height:30px;width:30px;align-items:center;justify-content:center;border:1px dashed rgb(var(--brand-border));border-radius:999px;font-size:18px}.column-empty strong{font-size:12px;color:rgb(var(--brand-text-secondary))}.column-empty p{font-size:11px}
.column-more{height:34px;flex:none;border:1px solid rgb(var(--brand-border-light));border-radius:4px;background:rgb(var(--brand-surface));font-size:12px;font-weight:600;color:rgb(var(--brand-blue))}.column-more:hover{background:rgb(var(--brand-bg))}.column-more:disabled{cursor:wait;color:rgb(var(--brand-text-muted))}
.mobile-status{display:none}
@media(max-width:768px){.kanban-column{width:270px;min-width:270px}.kanban-scroll{gap:12px}.kanban-card{min-height:173px}.mobile-status{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid rgb(var(--brand-kanban-divider));padding-top:9px;font-size:10px;font-weight:700;color:rgb(var(--brand-text-muted))}.mobile-status select{max-width:150px;border:1px solid rgb(var(--brand-border));border-radius:4px;background:rgb(var(--brand-surface));padding:5px 7px;color:rgb(var(--brand-text));font-size:11px}}
@media(prefers-reduced-motion:reduce){.kanban-card{transition:none}}
.mobile-status select{color-scheme:inherit}.mobile-status option{background:rgb(var(--brand-surface));color:rgb(var(--brand-text))}
</style>

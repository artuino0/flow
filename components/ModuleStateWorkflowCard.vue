<script setup lang="ts">
import type { EntityFieldMeta, StateWorkflowConfig } from '~/composables/useEntityFields'
import { toRaw } from 'vue'
import { applyWorkflowMapPositions, canConnectWorkflowStates, clampWorkflowMapPosition, layoutWorkflowMap, workflowMapEdgePath, WORKFLOW_MAP_HEIGHT, WORKFLOW_MAP_WIDTH, type WorkflowMapPositions } from '~/utils/workflowMapLayout'

const props = defineProps<{ moduleId: string; fields: EntityFieldMeta[]; config?: StateWorkflowConfig | null; selectedField?: string | null }>()
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()
const saving = ref(false)
const enabled = ref(Boolean(props.config?.enabled))
const fieldName = ref(props.config?.field ?? props.selectedField ?? '')
const initial = ref(props.config?.initial ?? '')
const clonePlain = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
const states = ref<StateWorkflowConfig['states']>(clonePlain(props.config?.states ?? {}))
const transitions = ref<StateWorkflowConfig['transitions']>(clonePlain(props.config?.transitions ?? []))
const mapPositions = ref<WorkflowMapPositions>(clonePlain(props.config?.layout ?? {}))
const roles = ref<Array<{ id: string; name: string }>>([])
const from = ref('')
const to = ref('')
const roleSelection = ref('all')

const selectFields = computed(() => props.fields.filter(field => field.dataType === 'select'))
const selectedField = computed(() => selectFields.value.find(field => field.name === fieldName.value))
const options = computed(() => Array.isArray(selectedField.value?.validationRules?.options) ? selectedField.value.validationRules.options as Array<{ value: string; label: string }> : [])
const editableFields = computed(() => props.fields.filter(field => field.name !== fieldName.value && field.name !== 'id'))
const mapNodes = computed(() => applyWorkflowMapPositions(layoutWorkflowMap(options.value.map(option => option.value)), mapPositions.value))
const mapNodeByValue = computed(() => new Map(mapNodes.value.map(node => [node.value, node])))
const mapEdges = computed(() => transitions.value.flatMap((transition, index) => {
  const source = mapNodeByValue.value.get(transition.from)
  const target = mapNodeByValue.value.get(transition.to)
  return source && target ? [{ key: `${transition.from}-${transition.to}-${index}`, from: transition.from, to: transition.to, path: workflowMapEdgePath(source, target) }] : []
}))
const selectedMapValue = ref('')
const selectedEdgeKey = ref('')
const highlightedMapValue = computed(() => mapNodeByValue.value.has(selectedMapValue.value) ? selectedMapValue.value : '')
const activeEdgeKey = computed(() => mapEdges.value.some(edge => edge.key === selectedEdgeKey.value) ? selectedEdgeKey.value : '')
const mapSvg = ref<SVGSVGElement | null>(null)
const pointerAction = ref<{ id: number; kind: 'move' | 'connect'; value: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null)
const guidePoint = ref<{ x: number; y: number } | null>(null)
const guideFrom = computed(() => pointerAction.value?.kind === 'connect' ? mapNodeByValue.value.get(pointerAction.value.value) : null)

function mapPoint(event: PointerEvent): { x: number; y: number } | null {
  const svg = mapSvg.value
  if (!svg) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const mapped = point.matrixTransform(matrix.inverse())
  return { x: Math.min(WORKFLOW_MAP_WIDTH, Math.max(0, mapped.x)), y: Math.min(WORKFLOW_MAP_HEIGHT, Math.max(0, mapped.y)) }
}

function startMapPointer(event: PointerEvent, value: string, kind: 'move' | 'connect') {
  if (event.button !== 0) return
  const point = mapPoint(event)
  const node = mapNodeByValue.value.get(value)
  if (!point || !node) return
  selectedMapValue.value = value
  selectedEdgeKey.value = ''
  pointerAction.value = { id: event.pointerId, kind, value, startX: point.x, startY: point.y, nodeX: node.x, nodeY: node.y }
  if (kind === 'connect') guidePoint.value = point
  mapSvg.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function moveMapPointer(event: PointerEvent) {
  const action = pointerAction.value
  if (!action || action.id !== event.pointerId) return
  const point = mapPoint(event)
  if (!point) return
  if (action.kind === 'connect') guidePoint.value = point
  else mapPositions.value = { ...mapPositions.value, [action.value]: clampWorkflowMapPosition(action.nodeX + point.x - action.startX, action.nodeY + point.y - action.startY) }
}

function finishMapPointer(event: PointerEvent) {
  const action = pointerAction.value
  if (!action || action.id !== event.pointerId) return
  if (action.kind === 'connect' && event.type === 'pointerup') {
    const point = mapPoint(event)
    const target = point && mapNodes.value.find(node => point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height)
    if (target) addTransitionPair(action.value, target.value, 'all')
  }
  pointerAction.value = null
  guidePoint.value = null
  if (mapSvg.value?.hasPointerCapture(event.pointerId)) mapSvg.value.releasePointerCapture(event.pointerId)
}

function moveMapNode(value: string, event: KeyboardEvent) {
  const delta = event.shiftKey ? 24 : 8
  const directions: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
  const direction = directions[event.key]
  if (!direction) return
  const node = mapNodeByValue.value.get(value)
  if (!node) return
  event.preventDefault()
  mapPositions.value = { ...mapPositions.value, [value]: clampWorkflowMapPosition(node.x + direction[0], node.y + direction[1]) }
}

function selectMapEdge(key: string) {
  selectedEdgeKey.value = key
  selectedMapValue.value = ''
  mapSvg.value?.focus()
}

function removeTransition(index: number) {
  const edge = mapEdges.value.find(item => item.key === selectedEdgeKey.value)
  transitions.value = transitions.value.filter((_, itemIndex) => itemIndex !== index)
  if (edge) selectedEdgeKey.value = ''
}

function removeSelectedEdge() {
  const index = mapEdges.value.findIndex(edge => edge.key === activeEdgeKey.value)
  if (index >= 0) removeTransition(index)
}

function onMapKeydown(event: KeyboardEvent) {
  if ((event.key === 'Delete' || event.key === 'Backspace') && activeEdgeKey.value) {
    event.preventDefault()
    removeSelectedEdge()
  }
}

function mapLabelLines(label: string): string[] {
  if (label.length <= 15) return [label]
  const words = label.split(/\s+/)
  const first: string[] = []
  while (words.length && (first.join(' ') + ' ' + words[0]).trim().length <= 15) first.push(words.shift()!)
  if (!first.length) return [label.slice(0, 14) + '…']
  const rest = words.join(' ')
  return rest ? [first.join(' '), rest.length > 15 ? rest.slice(0, 14) + '…' : rest] : [first.join(' ')]
}

watch(() => props.config, value => {
  enabled.value = Boolean(value?.enabled)
  fieldName.value = value?.field ?? props.selectedField ?? ''
  initial.value = value?.initial ?? ''
  states.value = clonePlain(value?.states ?? {})
  transitions.value = clonePlain(value?.transitions ?? [])
  mapPositions.value = clonePlain(value?.layout ?? {})
  selectedMapValue.value = ''
  selectedEdgeKey.value = ''
}, { immediate: true })
watch([fieldName, options], () => {
  const values = options.value.map(option => option.value)
  const previous = states.value
  states.value = Object.fromEntries(values.map(value => [value, previous[value] ?? { locked: false, editableFields: [] }]))
  if (!values.includes(initial.value)) initial.value = values[0] ?? ''
  if (!values.includes(from.value)) from.value = values[0] ?? ''
  if (!values.includes(to.value)) to.value = values[1] ?? values[0] ?? ''
  transitions.value = transitions.value.filter(item => values.includes(item.from) && values.includes(item.to))
  mapPositions.value = Object.fromEntries(Object.entries(mapPositions.value).filter(([value]) => values.includes(value)))
  if (!values.includes(selectedMapValue.value)) selectedMapValue.value = ''
}, { immediate: true })

onMounted(async () => {
  try {
    const result = await $fetch<{ roles: Array<{ id: string; name: string }> }>('/api/roles')
    roles.value = result.roles
  } catch { roles.value = [] }
})

function updateState(value: string, patch: Partial<StateWorkflowConfig['states'][string]>) {
  states.value = { ...states.value, [value]: { ...states.value[value], ...patch, editableFields: patch.locked === false ? [] : (patch.editableFields ?? states.value[value].editableFields) } }
}
function addTransition() {
  addTransitionPair(from.value, to.value, roleSelection.value === 'all' ? 'all' : [roleSelection.value])
}
function addTransitionPair(source: string, target: string, selectedRoles: string[] | 'all') {
  if (!canConnectWorkflowStates(source, target, transitions.value)) return
  transitions.value = [...transitions.value, { from: source, to: target, roles: selectedRoles }]
}
async function save() {
  saving.value = true
  try {
    const workflowConfig = enabled.value ? JSON.parse(JSON.stringify({ enabled: true, field: fieldName.value, initial: initial.value, states: states.value, transitions: transitions.value, layout: mapPositions.value, rules: toRaw(props.config?.rules ?? []) })) : null
    await $fetch(`/api/entities/${props.moduleId}`, { method: 'PUT', body: { workflowConfig } })
    toast.updated('Flujo de estados guardado', enabled.value ? 'Las reglas ya se aplican en el servidor.' : 'El flujo quedó desactivado.')
    emit('saved')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } } | null)?.data?.statusMessage
    toast.error('No se pudo guardar el flujo', statusMessage || 'Revisa los estados y las transiciones.')
  } finally { saving.value = false }
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2"><h2 class="text-lg font-bold text-brand-text">Flujo de estados</h2><ModuleTourHelpButton tab="flow" /></div>
        <p class="text-xs text-brand-text-secondary">Controla transiciones y bloqueos usando {{ selectedField?.label ? `el campo ${selectedField.label}` : 'un campo Select' }}.</p>
      </div>
      <button type="button" class="rounded bg-brand-orange px-3.5 py-[9px] text-[13px] font-bold text-brand-primary-fg hover:bg-brand-orange-hover disabled:opacity-50" :disabled="saving || (enabled && (!fieldName || !initial))" data-tour="edit-flow-save" @click="save">{{ saving ? 'Guardando…' : 'Guardar flujo' }}</button>
    </header>

    <div data-tour="edit-flow-setup" class="grid min-w-0 items-center gap-4 rounded-lg border border-brand-border-light bg-brand-surface p-5 lg:grid-cols-[minmax(180px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label class="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-brand-text">
          <span class="flex flex-col gap-1"><span>Activar flujo</span><span class="text-xs font-normal text-brand-text-secondary">Controla el recorrido de este módulo.</span></span>
          <input v-model="enabled" type="checkbox" role="switch" class="peer sr-only">
          <span aria-hidden="true" class="relative h-6 w-[42px] shrink-0 rounded-full bg-brand-border transition-colors peer-checked:bg-brand-blue peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-blue after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-brand-switch-thumb after:shadow after:transition-transform peer-checked:after:translate-x-[18px]" />
        </label>
        <template v-if="enabled">
            <label class="flex flex-col gap-1.5 text-xs font-bold text-brand-text">Campo Select
              <select v-model="fieldName" class="h-[38px] rounded border border-brand-border bg-brand-surface px-3 text-sm font-normal"><option value="" disabled>Selecciona un campo</option><option v-for="field in selectFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-bold text-brand-text">Estado inicial
              <select v-model="initial" class="h-[38px] rounded border border-brand-border bg-brand-surface px-3 text-sm font-normal"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </label>
        </template>
    </div>

    <div v-if="enabled" class="grid min-w-0 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_572px]">
      <div data-tour="edit-flow-transitions" class="flex min-h-[568px] min-w-0 flex-col gap-3 rounded-lg border border-brand-border-light bg-brand-surface p-[18px]">
        <div class="flex items-center justify-between gap-3"><h3 class="text-base font-bold text-brand-text">Transiciones y roles</h3><span class="rounded-full bg-brand-blue-bg px-2.5 py-1 text-[11px] font-bold text-brand-blue">{{ transitions.length }} reglas</span></div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
          <label class="flex flex-col gap-1.5 text-xs font-bold text-brand-text">Desde<select v-model="from" class="h-[38px] min-w-0 rounded border border-brand-border px-3 text-sm font-normal"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="flex flex-col gap-1.5 text-xs font-bold text-brand-text">Hacia<select v-model="to" class="h-[38px] min-w-0 rounded border border-brand-border px-3 text-sm font-normal"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="flex flex-col gap-1.5 text-xs font-bold text-brand-text">Rol<select v-model="roleSelection" class="h-[38px] min-w-0 rounded border border-brand-border px-3 text-sm font-normal"><option value="all">Todos los roles</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label>
          <button type="button" class="h-[38px] rounded bg-brand-blue px-3 text-xs font-bold text-brand-accent-fg hover:opacity-90" @click="addTransition">Agregar transición</button>
        </div>
        <div class="max-h-[440px] min-h-0 min-w-0 flex-1 overflow-auto rounded border border-brand-border-light">
          <table class="w-full min-w-[600px] text-left text-xs"><thead class="sticky top-0 bg-brand-bg text-[10px] font-bold text-brand-text-muted"><tr><th class="px-3.5 py-2.5">DESDE</th><th class="px-3.5 py-2.5">HACIA</th><th class="px-3.5 py-2.5">ROLES</th><th class="px-3.5 py-2.5 text-right">ACCIÓN</th></tr></thead><tbody class="divide-y divide-brand-border-light"><tr v-for="(transition, index) in transitions" :key="`${transition.from}-${transition.to}`" class="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" :class="activeEdgeKey === `${transition.from}-${transition.to}-${index}` ? 'bg-brand-orange/10' : 'hover:bg-brand-bg'" tabindex="0" :aria-label="`Seleccionar transición de ${transition.from} a ${transition.to}`" @click="selectMapEdge(`${transition.from}-${transition.to}-${index}`)" @keydown.enter.prevent="selectMapEdge(`${transition.from}-${transition.to}-${index}`)" @keydown.space.prevent="selectMapEdge(`${transition.from}-${transition.to}-${index}`)"><td class="px-3.5 py-2.5 font-semibold text-brand-text">{{ options.find(item => item.value === transition.from)?.label }}</td><td class="px-3.5 py-2.5 font-semibold text-brand-text">{{ options.find(item => item.value === transition.to)?.label }}</td><td class="px-3.5 py-2.5 text-brand-text-secondary">{{ transition.roles === 'all' ? 'Todos los roles' : roles.find(role => role.id === transition.roles[0])?.name || 'Rol' }}</td><td class="px-3.5 py-2.5 text-right"><button type="button" class="font-bold text-brand-error-text" @click.stop="removeTransition(index)">Quitar</button></td></tr><tr v-if="!transitions.length"><td colspan="4" class="px-3.5 py-3 text-brand-text-muted">Todavía no hay transiciones.</td></tr></tbody></table>
        </div>
      </div>

      <div data-tour="edit-flow-map" class="flex min-h-[568px] min-w-0 max-w-[572px] flex-col gap-3">
        <div class="flex items-start justify-between gap-3"><div><h3 class="text-base font-bold text-brand-text">Mapa del recorrido</h3><p class="mt-1 text-xs text-brand-text-secondary">{{ transitions.length }} cambio{{ transitions.length === 1 ? '' : 's' }} permitido{{ transitions.length === 1 ? '' : 's' }}.</p></div><div class="flex gap-2"><button v-if="activeEdgeKey" type="button" class="rounded border border-brand-border px-2 py-1 text-xs font-semibold text-brand-error-text" @click="removeSelectedEdge">Quitar</button><button type="button" class="rounded border border-brand-border px-2 py-1 text-xs font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="mapPositions = {}">Reacomodar</button></div></div>
        <div class="flex min-h-[460px] min-w-0 flex-1 flex-col rounded-lg border border-brand-border-light bg-brand-surface p-4">
          <h4 class="text-xs font-bold text-brand-text">Recorrido de estados</h4>
          <div class="flex min-h-[400px] min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
            <svg v-if="mapNodes.length" ref="mapSvg" class="block h-[400px] min-w-[538px] flex-1 touch-none" :viewBox="`0 0 ${WORKFLOW_MAP_WIDTH} ${WORKFLOW_MAP_HEIGHT}`" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa de estados y transiciones configuradas" tabindex="0" @pointermove="moveMapPointer" @pointerup="finishMapPointer" @pointercancel="finishMapPointer" @keydown="onMapKeydown">
              <defs><marker id="workflow-map-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--brand-text-muted))" /></marker><marker id="workflow-map-arrow-active" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--brand-orange))" /></marker></defs>
              <g v-for="edge in mapEdges" :key="edge.key" class="cursor-pointer" role="button" tabindex="0" :aria-label="`Transición de ${edge.from} a ${edge.to}`" @click.stop="selectMapEdge(edge.key)" @keydown.enter.prevent="selectMapEdge(edge.key)" @keydown.space.prevent="selectMapEdge(edge.key)">
                <path :d="edge.path" fill="none" :stroke="activeEdgeKey === edge.key || highlightedMapValue === edge.from || highlightedMapValue === edge.to ? 'rgb(var(--brand-orange))' : 'rgb(var(--brand-text-muted))'" :stroke-width="activeEdgeKey === edge.key ? 3.5 : 2" :marker-end="activeEdgeKey === edge.key || highlightedMapValue === edge.from || highlightedMapValue === edge.to ? 'url(#workflow-map-arrow-active)' : 'url(#workflow-map-arrow)'" />
                <path :d="edge.path" fill="none" stroke="transparent" stroke-width="16" />
              </g>
              <line v-if="guideFrom && guidePoint" :x1="guideFrom.x + guideFrom.width" :y1="guideFrom.y + guideFrom.height / 2" :x2="guidePoint.x" :y2="guidePoint.y" stroke="rgb(var(--brand-orange))" stroke-width="2" stroke-dasharray="5 4" pointer-events="none" />
              <g v-for="node in mapNodes" :key="node.value" tabindex="0" role="button" class="group cursor-grab focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" :class="pointerAction?.value === node.value && pointerAction.kind === 'move' ? 'cursor-grabbing' : ''" :aria-label="`${options.find(option => option.value === node.value)?.label || node.value}${node.value === initial ? ', estado inicial' : ''}${node.value === highlightedMapValue ? ', seleccionado' : ''}. Arrastra para mover, o usa las flechas del teclado.`" @pointerdown.stop="startMapPointer($event, node.value, 'move')" @click="selectedMapValue = node.value; selectedEdgeKey = ''" @keydown.enter.prevent="selectedMapValue = node.value; selectedEdgeKey = ''" @keydown.space.prevent="selectedMapValue = node.value; selectedEdgeKey = ''" @keydown="moveMapNode(node.value, $event)">
                <rect :x="node.x" :y="node.y" :width="node.width" :height="node.height" rx="7" :fill="node.value === initial ? 'rgb(var(--brand-blue-bg))' : 'rgb(var(--brand-bg))'" :stroke="node.value === highlightedMapValue ? 'rgb(var(--brand-orange))' : node.value === initial ? 'rgb(var(--brand-blue))' : 'rgb(var(--brand-border))'" :stroke-width="node.value === highlightedMapValue ? 2.5 : 1" />
                <text :x="node.x + node.width / 2" :y="node.y + (mapLabelLines(options.find(option => option.value === node.value)?.label || node.value).length === 1 ? 35 : 28)" text-anchor="middle" fill="rgb(var(--brand-text))" font-size="12" font-weight="700">
                  <tspan v-for="(line, index) in mapLabelLines(options.find(option => option.value === node.value)?.label || node.value)" :key="index" :x="node.x + node.width / 2" :dy="index ? 14 : 0">{{ line }}</tspan>
                </text>
                <text :x="node.x + node.width / 2" :y="node.y + 59" text-anchor="middle" :fill="node.value === initial ? 'rgb(var(--brand-blue))' : 'rgb(var(--brand-text-secondary))'" font-size="10">{{ node.value === initial ? 'Inicial' : node.value === highlightedMapValue ? 'Seleccionado' : 'Estado' }}</text>
                <g :class="node.value === highlightedMapValue ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100'" class="transition-opacity">
                  <circle :cx="node.x + node.width - 12" :cy="node.y + node.height / 2" r="12" fill="rgb(var(--brand-surface))" stroke="rgb(var(--brand-blue))" stroke-width="2" class="cursor-crosshair" @pointerdown.stop="startMapPointer($event, node.value, 'connect')" />
                  <text :x="node.x + node.width - 12" :y="node.y + node.height / 2 + 4" text-anchor="middle" fill="rgb(var(--brand-blue))" font-size="16" pointer-events="none">+</text>
                </g>
              </g>
            </svg>
            <p v-else class="text-xs text-brand-text-muted">Selecciona un campo con estados para ver el mapa.</p>
          </div>
        </div>
        <p class="rounded bg-brand-blue-bg p-3 text-[11px] text-brand-text-secondary">Arrastra los estados o el asa + para conectarlos. Las flechas muestran solo las transiciones configuradas. Guarda el flujo para aplicarlas.</p>
      </div>
    </div>

    <div v-if="enabled && options.length" data-tour="edit-flow-lock" class="flex min-w-0 flex-col rounded-lg border border-brand-border-light bg-brand-surface p-5">
      <h3 class="text-sm font-bold text-brand-text">Bloqueo por estado</h3>
      <p class="mt-1 text-[11px] text-brand-text-secondary">Define si un registro se puede modificar después de cambiar de estado.</p>
      <div v-for="option in options" :key="option.value" class="grid gap-3 border-b border-brand-border-light py-3 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)]">
        <label class="flex cursor-pointer items-center justify-between gap-3 text-[13px] font-semibold text-brand-text">
          <span>{{ option.label }}</span>
          <span class="flex items-center gap-2 text-[11px] font-medium text-brand-text-secondary"><input :checked="states[option.value]?.locked" type="checkbox" class="accent-brand-blue" @change="updateState(option.value, { locked: ($event.target as HTMLInputElement).checked })">Bloquea edición</span>
        </label>
        <div v-if="states[option.value]?.locked" class="rounded bg-brand-blue-bg p-3">
          <p class="mb-2 text-[11px] font-bold text-brand-text">Campos que conservan edición</p>
          <div class="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
            <label v-for="field in editableFields" :key="field.id" class="flex items-center gap-2 text-xs text-brand-text-secondary"><input :checked="states[option.value]?.editableFields.includes(field.name)" type="checkbox" class="accent-brand-blue" @change="updateState(option.value, { editableFields: ($event.target as HTMLInputElement).checked ? [...states[option.value].editableFields, field.name] : states[option.value].editableFields.filter(name => name !== field.name) })">{{ field.label }}</label>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* HU-164: controles nativos con el esquema del ámbito y el blanco claro original. */
:where(input, select, textarea) { color-scheme: inherit; }
:where(select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])):not([class*="bg-"]) { background-color: rgb(var(--brand-surface)); }
</style>

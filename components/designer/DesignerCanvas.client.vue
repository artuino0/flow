<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { VueFlow, BaseEdge, Handle, Position, MarkerType, getSmoothStepPath, useVueFlow, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Blocks, FolderTree, Search, Maximize2, Crosshair, LockKeyhole, X } from '@lucide/vue'
import { designerFieldTypeLabel, designerNodeClickAction, filterDesignerRelations, focusDesignerEdge, focusDesignerGraph, layoutDesignerGraph, SYSTEM_SECTION_ID, visibleDesignerGraph, type DesignerRelationFilter, type DiagramEdge, type DiagramGraph, type DesignerPositions } from '~/utils/designerGraph'
import { designerAppearanceOrder, designerEdgeFlowDirection, designerMotionTone, designerPulseEdges } from '~/utils/designerMotion'
import { moduleIconComponent } from '~/utils/moduleIcons'
import { lightTokens, darkTokens } from '~/utils/themeTokens'

const props = defineProps<{ graph: DiagramGraph; positions: DesignerPositions; selectedId: string | null; focusId: string | null; selectedEdgeId: string | null; relationFilter: DesignerRelationFilter; changedIds: string[]; revealEdgeIds: string[]; revealFieldKeys: string[]; disabled?: boolean }>()
const emit = defineEmits<{ select: [id: string | null]; edgeSelect: [id: string]; clear: []; focus: [id: string | null]; positions: [value: DesignerPositions] }>()
const query = ref('')
const section = ref('')
const systemInfoOpen = ref(false)
const nodes = shallowRef<Node[]>([])
const edges = shallowRef<Edge[]>([])
const { fitView, zoomIn, zoomOut } = useVueFlow()
const { resolved } = useTheme()
const palette = computed(() => resolved.value === 'dark' ? darkTokens : lightTokens)
const minimapNodeColor = computed(() => (node: Node) => node.type === 'section' ? palette.value['designer-minimap-section'] : node.data?.module?.system ? palette.value['designer-minimap-system'] : node.data?.module?.state === 'new' ? palette.value['designer-minimap-new'] : palette.value['designer-minimap-existing'])
const relationGraph = computed(() => filterDesignerRelations(props.graph, props.selectedId, props.relationFilter))
const visible = computed(() => visibleDesignerGraph(relationGraph.value, query.value, section.value))
const highlighted = computed(() => props.selectedEdgeId ? focusDesignerEdge(visible.value, props.selectedEdgeId) : focusDesignerGraph(visible.value, props.focusId))

function edgeColors(edge: DiagramEdge) {
  const selected = props.selectedEdgeId && highlighted.value.edges.has(edge.id)
  return {
    marker: palette.value[selected ? 'designer-selected-edge' : edge.kind === 'user' ? 'designer-system-muted' : edge.state === 'new' ? 'designer-new-arrow' : 'designer-existing-edge'],
    stroke: palette.value[selected ? 'designer-selected-edge' : edge.kind === 'user' ? 'designer-system-muted' : edge.state === 'new' ? 'designer-new' : 'designer-edge']
  }
}
// Actualiza únicamente la presentación de aristas. No vuelve a distribuir nodos,
// ni llama fitView, ni reemplaza el viewport o la selección al alternar tema.
watch(resolved, () => {
  const byId = new Map(props.graph.edges.map(edge => [edge.id, edge]))
  edges.value = edges.value.map(edge => {
    const source = byId.get(edge.id)
    if (!source) return edge
    const colors = edgeColors(source)
    return { ...edge, markerEnd: { type: MarkerType.ArrowClosed, color: colors.marker }, style: { ...edge.style, stroke: colors.stroke } }
  })
})

function refreshGraph() {
  const layout = layoutDesignerGraph(props.graph, props.positions)
  const selected = new Set(visible.value.modules.map(module => module.id))
  const revealDelay = new Map(designerAppearanceOrder(props.graph, props.changedIds).map((id, index) => [id, index * 150]))
  const revealEdges = new Set(props.revealEdgeIds)
  const freshFields = new Set(props.revealFieldKeys)
  const activeModule = props.focusId ?? props.selectedId
  const pulsing = designerPulseEdges(visible.value, activeModule, props.selectedEdgeId)
  const hasFocus = Boolean(activeModule || props.selectedEdgeId)
  const frames = layout.groups.flatMap(group => {
    const members = group.title === section.value || !section.value
      ? visible.value.modules.filter(module => group.id === SYSTEM_SECTION_ID ? module.system : !module.system && module.section === group.title) : []
    if (!members.length) return []
    const xs = members.map(module => layout.positions[module.id]?.x ?? 0)
    const ys = members.map(module => layout.positions[module.id]?.y ?? 0)
    const x = Math.min(...xs) - 24
    const y = Math.min(...ys) - 48
    const width = Math.max(...members.map(module => (layout.positions[module.id]?.x ?? 0) + module.width)) - x + 24
    const height = Math.max(...members.map(module => (layout.positions[module.id]?.y ?? 0) + module.height)) - y + 24
    return [{ id: `section:${group.id}`, type: 'section', position: { x, y }, data: { title: group.title, count: members.length }, draggable: false, selectable: false, connectable: false, style: { width: `${width}px`, height: `${height}px`, zIndex: -1 } } as Node]
  })
  nodes.value = [...frames, ...visible.value.modules.map(module => ({
    id: module.id, type: module.system ? 'system-user' : 'module', position: layout.positions[module.id] ?? { x: 0, y: 0 }, data: { module, tone: designerMotionTone(module), revealMs: revealDelay.get(module.id) ?? null, freshFields, related: Boolean(props.focusId || props.selectedEdgeId) && highlighted.value.active.has(module.id), selected: props.selectedId === module.id, totalLabel: module.module.lines?.flatMap(line => line.totals ?? []).join(', ') ?? '' },
    draggable: !props.disabled, connectable: false, style: { width: `${module.width}px`, zIndex: 2 }
  } as Node))]
  edges.value = visible.value.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)).map((edge, index) => ({
    id: edge.id, source: edge.source, target: edge.target, type: 'flow', label: edge.label,
    animated: false,
    class: [revealEdges.has(edge.id) ? 'designer-enter-edge' : '', hasFocus && !pulsing.has(edge.id) ? 'designer-edge-muted' : ''].filter(Boolean).join(' '),
    data: { pulse: pulsing.has(edge.id), direction: designerEdgeFlowDirection(edge), phaseMs: (index % 9) * 340, revealMs: Math.max(revealDelay.get(edge.source) ?? -450, revealDelay.get(edge.target) ?? -450) + 450 },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors(edge).marker },
    style: { stroke: edgeColors(edge).stroke, strokeWidth: props.selectedEdgeId && highlighted.value.edges.has(edge.id) ? 3.5 : edge.kind === 'lines' ? 3 : 1.5, ...(edge.kind === 'user' ? { strokeDasharray: '5 3' } : {}) },
    labelStyle: { fill: 'rgb(var(--brand-designer-label))', fontSize: '10px', fontWeight: 600 }, labelBgStyle: { fill: 'rgb(var(--brand-designer-label-bg))', fillOpacity: 0.92 }, labelBgPadding: [5, 3]
  } as Edge))
}
watch([() => props.graph, () => props.positions, () => props.selectedId, () => props.focusId, () => props.selectedEdgeId, () => props.relationFilter, () => props.changedIds.join('|'), () => props.revealEdgeIds.join('|'), () => props.revealFieldKeys.join('|'), query, section], refreshGraph, { immediate: true })
watch([() => props.relationFilter, () => props.selectedId], async ([filter], [previousFilter]) => {
  if (filter !== 'none') { query.value = ''; section.value = '' }
  if (filter === 'none' && previousFilter === 'none') return
  await nextTick()
  setTimeout(() => {
    const ids = visible.value.modules.map(module => module.id)
    if (ids.length) void fitView({ nodes: ids, padding: 0.25, duration: 250 })
  }, 50)
})
watch(() => props.changedIds.join('|'), async () => {
  if (!props.changedIds.length) return
  await nextTick()
  setTimeout(() => { void fitView({ nodes: props.changedIds, padding: 0.32, duration: 350 }) }, 50)
})
function onDragStop(event: { node: Node }) {
  if (event.node.id.startsWith('section:')) return
  emit('positions', { ...props.positions, [event.node.id]: { x: event.node.position.x, y: event.node.position.y } })
}
function onNodeClick(event: { node: Node }) {
  const action = designerNodeClickAction(props.graph, event.node.id)
  if (action === 'info') systemInfoOpen.value = true
  if (action === 'select') { systemInfoOpen.value = false; emit('select', event.node.id) }
}
function focusSelected() {
  if (props.selectedId) emit('focus', props.focusId === props.selectedId ? null : props.selectedId)
}
function fitCanvas() { void fitView({ padding: 0.12, duration: 250 }) }
function focusElement(id: string) {
  const edge = props.graph.edges.find(item => item.id === id)
  const ids = edge ? [...new Set([edge.source, edge.target])] : props.graph.modules.some(module => module.id === id) ? [id] : []
  if (ids.length) void fitView({ nodes: ids, padding: 0.55, duration: 300 })
}
defineExpose({ fitCanvas, focusElement })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-brand-bg">
    <VueFlow v-model:nodes="nodes" v-model:edges="edges" class="designer-flow" :min-zoom="0.2" :max-zoom="2" :nodes-connectable="false" :elements-selectable="false" fit-view-on-init @node-click="onNodeClick" @edge-click="({ edge, event }) => { event?.stopPropagation(); emit('edgeSelect', edge.id) }" @node-drag-stop="onDragStop" @pane-click="systemInfoOpen = false; emit('clear')">
      <Background id="minor-grid" variant="lines" :color="palette['designer-grid-minor']" :gap="20" :line-width="0.4" />
      <Background id="major-grid" variant="lines" :color="palette['designer-grid-major']" :gap="100" :line-width="0.65" />
      <MiniMap pannable zoomable :node-color="minimapNodeColor" mask-color="rgb(var(--brand-designer-minimap-mask) / 0.6)" class="!border !border-brand-border-light !bg-brand-designer-minimap-bg" />
      <Controls position="bottom-right" />
      <template #edge-flow="{ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding, data }">
        <g :style="{ '--edge-delay': `${data.revealMs}ms`, '--pulse-phase': `${data.phaseMs}ms` }">
          <BaseEdge
            :path="getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0]"
            :label-x="getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[1]"
            :label-y="getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[2]"
            :label="label" :label-style="labelStyle" :label-bg-style="labelBgStyle" :label-bg-padding="labelBgPadding" :marker-end="markerEnd" />
          <path v-if="data.pulse" :d="getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0]" pathLength="100" class="designer-edge-pulse" :class="data.direction === 'reverse' ? 'is-reverse' : ''" />
        </g>
      </template>
      <template #node-section="{ data }"><div class="designer-section"><span class="inline-flex items-center gap-1.5"><FolderTree class="h-3.5 w-3.5" />{{ data.title }}</span><span>{{ data.count }}</span></div></template>
      <template #node-module="{ data }">
        <Handle type="target" :position="Position.Top" class="!h-1 !w-1 !border-0 !bg-transparent" />
        <button type="button" class="designer-module w-full text-left" :class="[data.module.state === 'new' ? 'is-new' : data.module.state === 'extended' ? 'is-extended' : '', data.tone === 'catalog' ? 'is-catalog' : '', data.selected ? 'is-selected' : '', data.related ? 'is-related' : '', data.revealMs !== null ? 'designer-node-enter' : '']" :style="data.revealMs !== null ? { '--reveal-delay': `${data.revealMs}ms` } : undefined" :aria-label="`Seleccionar ${data.module.module.name}`">
          <div class="designer-module-head"><span class="flex min-w-0 items-center gap-2"><component :is="moduleIconComponent(data.module.icon)" class="h-4 w-4 shrink-0 text-brand-blue" :stroke-width="1.75" /><span class="truncate font-semibold">{{ data.module.module.name }}</span></span><span v-if="data.module.state === 'new'" class="designer-badge">Nuevo</span></div>
          <div class="designer-module-meta"><Blocks class="h-3 w-3" />{{ data.module.module.kind === 'dimension' ? 'Catálogo' : 'Módulo' }}<span v-if="data.module.module.workflow" class="ml-auto">Estados · {{ Object.keys(data.module.module.workflow.states).length }}</span></div>
          <div class="designer-module-fields"><div v-for="field in data.module.fields" :key="field.name" class="designer-field" :class="[field.state === 'added' ? 'is-added' : '', data.freshFields.has(`${data.module.id}:${field.name}`) ? 'is-fresh' : '']"><span class="truncate">{{ field.label }}<b v-if="field.required" class="ml-0.5 text-brand-orange">*</b></span><span class="shrink-0 text-[10px] text-brand-designer-type">{{ designerFieldTypeLabel(field) }}</span><span v-if="field.state === 'added'" class="designer-added">Se agrega</span></div><div v-if="!data.module.fields.length" class="px-3 py-2 text-[11px] text-brand-text-muted">Sin campos</div></div>
          <div v-if="data.totalLabel" class="designer-module-total">Total al pie: {{ data.totalLabel }}</div>
        </button>
        <Handle type="source" :position="Position.Bottom" class="!h-1 !w-1 !border-0 !bg-transparent" />
      </template>
      <template #node-system-user="{ data }">
        <Handle type="target" :position="Position.Top" class="!h-1 !w-1 !border-0 !bg-transparent" />
        <button type="button" class="designer-system-user w-full text-left" :class="[data.related ? 'is-related' : '', data.revealMs !== null ? 'designer-node-enter' : '']" :style="data.revealMs !== null ? { '--reveal-delay': `${data.revealMs}ms` } : undefined" aria-label="Información de la tabla del sistema Usuarios" @click.stop="systemInfoOpen = true">
          <span class="designer-system-user-head"><LockKeyhole class="h-4 w-4" />Usuarios<span class="designer-system-tag">Sistema</span></span>
          <span class="designer-system-user-detail">nombre · correo</span>
        </button>
        <Handle type="source" :position="Position.Bottom" class="!h-1 !w-1 !border-0 !bg-transparent" />
      </template>
    </VueFlow>
    <div v-if="systemInfoOpen" role="note" class="absolute right-4 top-4 z-20 flex max-w-64 items-start gap-3 rounded-md border border-brand-designer-existing bg-brand-surface px-3 py-2.5 text-xs text-brand-text shadow-lg"><LockKeyhole class="mt-0.5 h-4 w-4 shrink-0 text-brand-designer-system-icon" /><div><strong class="block">Usuarios · Sistema</strong><p class="mt-1 text-brand-text-secondary">Tabla del sistema: usuarios de la organización. Sus campos se administran fuera del diseñador.</p></div><button type="button" class="rounded p-0.5 hover:bg-brand-bg" aria-label="Cerrar información de Usuarios" @click="systemInfoOpen = false"><X class="h-3.5 w-3.5" /></button></div>
    <div class="pointer-events-auto absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-md border border-brand-border-light bg-brand-surface p-2 shadow-sm">
      <label class="flex items-center gap-1.5 rounded border border-brand-border-light px-2 py-1.5 text-brand-text-muted"><Search class="h-4 w-4" /><input v-model="query" class="w-28 bg-transparent text-xs text-brand-text outline-none sm:w-40" placeholder="Buscar módulo" aria-label="Buscar módulo" /></label>
      <select v-model="section" class="max-w-40 rounded border border-brand-border-light bg-brand-surface px-2 py-1.5 text-xs text-brand-text" aria-label="Filtrar por sección"><option value="">Todas las secciones</option><option v-for="group in graph.sections" :key="group.id" :value="group.title">{{ group.title }}</option></select>
      <button type="button" class="designer-tool" :disabled="!selectedId" title="Enfocar módulo" aria-label="Enfocar módulo" @click="focusSelected"><Crosshair class="h-4 w-4" /></button>
      <button type="button" class="designer-tool" title="Ajustar lienzo" aria-label="Ajustar lienzo" @click="fitView({ padding: 0.12, duration: 250 })"><Maximize2 class="h-4 w-4" /></button>
    </div>
    <div class="absolute bottom-4 left-4 z-10 rounded-md border border-brand-border-light bg-brand-surface px-3 py-2 text-[11px] text-brand-text-secondary shadow-sm"><div class="mb-1 font-bold tracking-wide text-brand-text-muted">LEYENDA</div><div class="flex flex-wrap gap-x-3 gap-y-1"><span><i class="designer-dot bg-brand-designer-existing" />Existente</span><span><i class="designer-dot bg-brand-orange" />Nuevo</span><span><i class="designer-dot bg-brand-blue" />Se agrega</span></div></div>
    <div class="absolute bottom-4 right-40 z-10 flex rounded-md border border-brand-border-light bg-brand-surface text-xs shadow-sm"><button type="button" class="designer-tool" aria-label="Alejar" @click="zoomOut()">−</button><button type="button" class="designer-tool" aria-label="Acercar" @click="zoomIn()">+</button></div>
  </div>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';
.designer-flow { --vf-node-bg: rgb(var(--brand-surface)); --vf-node-text: rgb(var(--brand-text)); --vf-connection-path: rgb(var(--brand-designer-connection)); --vf-handle: rgb(var(--brand-designer-handle)); color-scheme: inherit; }
.designer-flow .vue-flow__controls { box-shadow: 0 0 2px 1px rgb(var(--brand-modal-overlay) / 0.08); }
.designer-flow .vue-flow__controls-button { background: rgb(var(--brand-designer-controls-bg)); border-bottom-color: rgb(var(--brand-designer-controls-border)); color: rgb(var(--brand-designer-controls-icon)); }
.designer-flow .vue-flow__controls-button svg { fill: currentColor; }
.designer-flow .vue-flow__controls-button:hover { background: rgb(var(--brand-designer-controls-hover)); }
.designer-flow .vue-flow__controls-button:focus-visible, .designer-module:focus-visible, .designer-system-user:focus-visible { outline: 2px solid rgb(var(--brand-blue)); outline-offset: 2px; }
.designer-flow .vue-flow__edge-textbg { fill: rgb(var(--brand-designer-label-bg)); }
.designer-flow .vue-flow__edge.updating .vue-flow__edge-path { stroke: rgb(var(--brand-designer-edge-updating)); }
.designer-flow .vue-flow__connection-path { stroke: rgb(var(--brand-designer-connection)); }
.designer-flow .vue-flow__edge.selected .vue-flow__edge-path, .designer-flow .vue-flow__edge:focus .vue-flow__edge-path { stroke: rgb(var(--brand-designer-handle)); }
:root[data-theme="dark"] .designer-flow .vue-flow__edge:hover .vue-flow__edge-path { stroke: rgb(var(--brand-designer-handle)); }
.designer-flow .vue-flow__handle { background: rgb(var(--brand-designer-handle)); border-color: rgb(var(--brand-surface)); }
.designer-flow .vue-flow__nodesselection-rect, .designer-flow .vue-flow__selection { background: rgb(var(--brand-designer-selection) / 0.08); border-color: rgb(var(--brand-designer-selection) / 0.8); }
.designer-flow .vue-flow__node { border: 0; border-radius: 6px; background: transparent; padding: 0; }
.designer-flow .vue-flow__node-section { pointer-events: none; }
.designer-section { width: 100%; height: 100%; border: 1px solid rgb(var(--brand-designer-grid-major)); border-radius: 10px; background: rgb(var(--brand-designer-section-bg) / 0.8); padding: 12px 15px; color: rgb(var(--brand-designer-section-text)); font-size: 11px; font-weight: 700; display: flex; justify-content: space-between; align-items: flex-start; }
.designer-system-user { display: block; overflow: hidden; border: 1px solid rgb(var(--brand-designer-existing-edge)); border-radius: 7px; background: rgb(var(--brand-dashboard-soft)); box-shadow: 0 3px 12px rgb(var(--brand-designer-system-muted) / 0.1607843137254902); color: rgb(var(--brand-designer-system-text)); --designer-accent: rgb(var(--brand-designer-system-muted)); }
.designer-system-user.is-related { box-shadow: 0 0 0 2px rgb(var(--brand-designer-related)), 0 4px 12px rgb(var(--brand-shadow) / 0.13333333333333333); }
.designer-system-user-head { display: flex; align-items: center; gap: 7px; padding: 10px 11px 7px; font-size: 12px; font-weight: 700; }
.designer-system-tag { margin-left: auto; border-radius: 20px; background: rgb(var(--brand-designer-system-tag)); padding: 2px 7px; font-size: 9px; }
.designer-system-user-detail { display: block; border-top: 1px solid rgb(var(--brand-scrollbar)); padding: 8px 11px; font-size: 11px; color: rgb(var(--brand-designer-system-muted)); }
.designer-module { display: block; overflow: hidden; border: 1px solid rgb(var(--brand-designer-node-border)); border-radius: 7px; background: rgb(var(--brand-surface)); --designer-accent: theme('colors.brand.blue'); box-shadow: 0 3px 12px color-mix(in srgb, var(--designer-accent) 16%, transparent); color: rgb(var(--brand-designer-node-text)); transition: opacity .18s, box-shadow .18s, border-color .18s; }
.designer-module.is-new { border: 2px solid rgb(var(--brand-designer-new)); }
.designer-module.is-extended { border-color: rgb(var(--brand-blue)); }
.designer-module.is-catalog { border-style: dashed; --designer-accent: theme('colors.brand.orange'); }
.designer-module.is-selected { box-shadow: 0 0 0 3px rgb(var(--brand-blue) / 0.20784313725490197), 0 4px 12px rgb(var(--brand-shadow) / 0.13333333333333333); }
.designer-module.is-related { box-shadow: 0 0 0 2px rgb(var(--brand-designer-related)), 0 4px 12px rgb(var(--brand-shadow) / 0.13333333333333333); }
.designer-module-head { display: flex; justify-content: space-between; gap: 6px; align-items: center; padding: 9px 11px 5px; font-size: 12px; background: rgb(var(--brand-designer-node-head)); }
.designer-module.is-new .designer-module-head { background: rgb(var(--brand-designer-new-head)); }
.designer-module-meta { display: flex; gap: 5px; align-items: center; padding: 0 11px 7px; font-size: 10px; color: rgb(var(--brand-designer-node-meta)); background: rgb(var(--brand-designer-node-head)); }
.designer-module.is-new .designer-module-meta { background: rgb(var(--brand-designer-new-head)); }
.designer-badge { border-radius: 20px; background: rgb(var(--brand-designer-new)); color: rgb(var(--brand-primary-fg)); padding: 2px 7px; font-size: 9px; font-weight: 700; }
.designer-module-fields { padding: 3px 0; }
.designer-field { display: flex; gap: 6px; justify-content: space-between; align-items: center; min-height: 27px; padding: 3px 10px; font-size: 10.5px; }
.designer-field.is-added { background: rgb(var(--brand-designer-added-row)); }
.designer-field.is-fresh { animation: designer-field-glow 1.35s ease-out var(--reveal-delay, 0ms) 1; }
.designer-added { border-radius: 3px; background: rgb(var(--brand-designer-added-bg)); color: rgb(var(--brand-designer-added-text)); padding: 1px 3px; font-size: 8px; white-space: nowrap; }
.designer-module-total { border-top: 1px solid rgb(var(--brand-designer-node-divider)); padding: 6px 10px; font-size: 10px; color: rgb(var(--brand-designer-label)); }
.designer-tool { display: inline-flex; min-width: 28px; min-height: 28px; align-items: center; justify-content: center; border-radius: 4px; color: rgb(var(--brand-designer-label)); }
.designer-tool:hover:not(:disabled) { background: rgb(var(--brand-panel-hover)); }
.designer-tool:focus-visible { outline: 2px solid rgb(var(--brand-blue)); }
.designer-tool:disabled { opacity: .35; }
.designer-dot { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 2px; }
.designer-node-enter { animation: designer-arrive .42s cubic-bezier(.2,.75,.2,1) var(--reveal-delay) both, designer-breath 1.2s ease-in-out var(--reveal-delay) 1; }
.designer-flow .designer-enter-edge .vue-flow__edge-path { stroke-dasharray: 1200; stroke-dashoffset: 1200; animation: designer-line-draw .48s ease-out var(--edge-delay) forwards; }
.designer-flow .designer-edge-muted { opacity: .22; }
.designer-edge-pulse { fill: none; stroke: theme('colors.brand.blue'); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 7 93; pointer-events: none; opacity: 0; animation: designer-pulse 3.2s linear var(--pulse-phase) infinite; }
.designer-edge-pulse.is-reverse { animation-name: designer-pulse-reverse; }
.designer-enter-edge .designer-edge-pulse { animation-delay: calc(var(--edge-delay) + 480ms + var(--pulse-phase)); }
@keyframes designer-arrive { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
@keyframes designer-breath { 0%, 100% { box-shadow: 0 3px 12px color-mix(in srgb, var(--designer-accent) 16%, transparent); } 45% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--designer-accent) 9%, transparent), 0 6px 23px color-mix(in srgb, var(--designer-accent) 25%, transparent); } }
@keyframes designer-field-glow { from { background: color-mix(in srgb, var(--designer-accent) 22%, rgb(var(--brand-surface))); } to { background: transparent; } }
@keyframes designer-line-draw { to { stroke-dashoffset: 0; } }
@keyframes designer-pulse { 0% { stroke-dashoffset: 100; opacity: 0; } 15% { opacity: .48; } 85% { opacity: .48; } 100% { stroke-dashoffset: 0; opacity: 0; } }
@keyframes designer-pulse-reverse { 0% { stroke-dashoffset: 0; opacity: 0; } 15% { opacity: .48; } 85% { opacity: .48; } 100% { stroke-dashoffset: 100; opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .designer-node-enter, .designer-field.is-fresh, .designer-flow .designer-enter-edge .vue-flow__edge-path, .designer-edge-pulse { animation: none; }
  .designer-flow .designer-enter-edge .vue-flow__edge-path { stroke-dasharray: none; stroke-dashoffset: 0; }
  .designer-edge-pulse { display: none; }
}
</style>

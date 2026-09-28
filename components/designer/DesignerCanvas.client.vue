<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { VueFlow, Handle, Position, MarkerType, useVueFlow, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Blocks, FolderTree, Search, Maximize2, Crosshair } from '@lucide/vue'
import { designerFieldTypeLabel, focusDesignerGraph, layoutDesignerGraph, visibleDesignerGraph, type DiagramGraph, type DesignerPositions } from '~/utils/designerGraph'

const props = defineProps<{ graph: DiagramGraph; positions: DesignerPositions; selectedId: string | null; focusId: string | null; changedIds: string[]; disabled?: boolean }>()
const emit = defineEmits<{ select: [id: string | null]; focus: [id: string | null]; positions: [value: DesignerPositions] }>()
const query = ref('')
const section = ref('')
const nodes = shallowRef<Node[]>([])
const edges = shallowRef<Edge[]>([])
const { fitView, zoomIn, zoomOut } = useVueFlow()
const visible = computed(() => visibleDesignerGraph(props.graph, query.value, section.value))
const highlighted = computed(() => focusDesignerGraph(visible.value, props.focusId))

function refreshGraph() {
  const layout = layoutDesignerGraph(props.graph, props.positions)
  const selected = new Set(visible.value.modules.map(module => module.id))
  const frames = layout.groups.flatMap(group => {
    const members = group.id === section.value || !section.value ? visible.value.modules.filter(module => module.section === group.title) : []
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
    id: module.id, type: 'module', position: layout.positions[module.id] ?? { x: 0, y: 0 }, data: { module, dimmed: Boolean(props.focusId) && !highlighted.value.active.has(module.id), selected: props.selectedId === module.id, totalLabel: module.module.lines?.flatMap(line => line.totals ?? []).join(', ') ?? '' },
    draggable: !props.disabled, connectable: false, style: { width: `${module.width}px`, zIndex: 2 }
  } as Node))]
  edges.value = visible.value.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)).map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep', label: edge.label,
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.state === 'new' ? '#f97316' : '#94a3b8' },
    style: { stroke: edge.state === 'new' ? '#e8682d' : '#8b9bac', strokeWidth: edge.kind === 'lines' ? 3 : 1.5, opacity: props.focusId && !highlighted.value.edges.has(edge.id) ? 0.16 : 1 },
    labelStyle: { fill: '#526579', fontSize: '10px', fontWeight: 600 }, labelBgStyle: { fill: '#fff', fillOpacity: 0.92 }, labelBgPadding: [5, 3]
  } as Edge))
}
watch([() => props.graph, () => props.positions, () => props.selectedId, () => props.focusId, query, section], refreshGraph, { immediate: true })
watch(() => props.changedIds.join('|'), async () => {
  if (!props.changedIds.length) return
  await nextTick()
  setTimeout(() => { void fitView({ nodes: props.changedIds, padding: 0.32, duration: 350 }) }, 50)
})
function onDragStop(event: { node: Node }) {
  if (event.node.id.startsWith('section:')) return
  emit('positions', { ...props.positions, [event.node.id]: { x: event.node.position.x, y: event.node.position.y } })
}
function focusSelected() {
  if (props.selectedId) emit('focus', props.focusId === props.selectedId ? null : props.selectedId)
}
function fitCanvas() { void fitView({ padding: 0.12, duration: 250 }) }
defineExpose({ fitCanvas })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-brand-bg">
    <VueFlow v-model:nodes="nodes" v-model:edges="edges" class="designer-flow" :min-zoom="0.2" :max-zoom="2" :nodes-connectable="false" :elements-selectable="false" fit-view-on-init @node-click="({ node }) => { if (!node.id.startsWith('section:')) emit('select', node.id) }" @node-drag-stop="onDragStop" @pane-click="emit('select', null)">
      <Background pattern-color="#dce5eb" :gap="22" :size="1" />
      <MiniMap pannable zoomable :node-color="(node) => node.data?.module?.state === 'new' ? '#e8682d' : '#9daab7'" class="!border !border-brand-border-light !bg-brand-surface" />
      <Controls position="bottom-right" />
      <template #node-section="{ data }"><div class="designer-section"><span class="inline-flex items-center gap-1.5"><FolderTree class="h-3.5 w-3.5" />{{ data.title }}</span><span>{{ data.count }}</span></div></template>
      <template #node-module="{ data }">
        <Handle type="target" :position="Position.Top" class="!h-1 !w-1 !border-0 !bg-transparent" />
        <button type="button" class="designer-module w-full text-left" :class="[data.module.state === 'new' ? 'is-new' : data.module.state === 'extended' ? 'is-extended' : '', data.module.module.kind === 'dimension' ? 'is-catalog' : '', data.selected ? 'is-selected' : '', data.dimmed ? 'is-dimmed' : '']" :aria-label="`Seleccionar ${data.module.module.name}`">
          <div class="designer-module-head"><span class="truncate font-semibold">{{ data.module.module.name }}</span><span v-if="data.module.state === 'new'" class="designer-badge">Nuevo</span></div>
          <div class="designer-module-meta"><Blocks class="h-3 w-3" />{{ data.module.module.kind === 'dimension' ? 'Catálogo' : 'Módulo' }}<span v-if="data.module.module.workflow" class="ml-auto">Estados · {{ Object.keys(data.module.module.workflow.states).length }}</span></div>
          <div class="designer-module-fields"><div v-for="field in data.module.fields" :key="field.name" class="designer-field" :class="field.state === 'added' ? 'is-added' : ''"><span class="truncate">{{ field.label }}<b v-if="field.required" class="ml-0.5 text-brand-orange">*</b></span><span class="shrink-0 text-[10px] text-brand-text-muted">{{ designerFieldTypeLabel(field) }}</span><span v-if="field.state === 'added'" class="designer-added">Se agrega</span></div><div v-if="!data.module.fields.length" class="px-3 py-2 text-[11px] text-brand-text-muted">Sin campos</div></div>
          <div v-if="data.totalLabel" class="designer-module-total">Total al pie: {{ data.totalLabel }}</div>
        </button>
        <Handle type="source" :position="Position.Bottom" class="!h-1 !w-1 !border-0 !bg-transparent" />
      </template>
    </VueFlow>
    <div class="pointer-events-auto absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-md border border-brand-border-light bg-brand-surface p-2 shadow-sm">
      <label class="flex items-center gap-1.5 rounded border border-brand-border-light px-2 py-1.5 text-brand-text-muted"><Search class="h-4 w-4" /><input v-model="query" class="w-28 bg-transparent text-xs text-brand-text outline-none sm:w-40" placeholder="Buscar módulo" aria-label="Buscar módulo" /></label>
      <select v-model="section" class="max-w-40 rounded border border-brand-border-light bg-brand-surface px-2 py-1.5 text-xs text-brand-text" aria-label="Filtrar por sección"><option value="">Todas las secciones</option><option v-for="group in graph.sections" :key="group.id" :value="group.title">{{ group.title }}</option></select>
      <button type="button" class="designer-tool" :disabled="!selectedId" title="Enfocar módulo" aria-label="Enfocar módulo" @click="focusSelected"><Crosshair class="h-4 w-4" /></button>
      <button type="button" class="designer-tool" title="Ajustar lienzo" aria-label="Ajustar lienzo" @click="fitView({ padding: 0.12, duration: 250 })"><Maximize2 class="h-4 w-4" /></button>
    </div>
    <div class="absolute bottom-4 left-4 z-10 rounded-md border border-brand-border-light bg-brand-surface px-3 py-2 text-[11px] text-brand-text-secondary shadow-sm"><div class="mb-1 font-bold tracking-wide text-brand-text-muted">LEYENDA</div><div class="flex flex-wrap gap-x-3 gap-y-1"><span><i class="designer-dot bg-slate-300" />Existente</span><span><i class="designer-dot bg-brand-orange" />Nuevo</span><span><i class="designer-dot bg-brand-blue" />Se agrega</span></div></div>
    <div class="absolute bottom-4 right-40 z-10 flex rounded-md border border-brand-border-light bg-brand-surface text-xs shadow-sm"><button type="button" class="designer-tool" aria-label="Alejar" @click="zoomOut()">−</button><button type="button" class="designer-tool" aria-label="Acercar" @click="zoomIn()">+</button></div>
  </div>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';
.designer-flow .vue-flow__node { border: 0; border-radius: 6px; background: transparent; padding: 0; }
.designer-flow .vue-flow__node-section { pointer-events: none; }
.designer-section { width: 100%; height: 100%; border: 1px solid #d8e1e8; border-radius: 10px; background: #f8fafb; padding: 12px 15px; color: #657789; font-size: 11px; font-weight: 700; display: flex; justify-content: space-between; align-items: flex-start; }
.designer-module { display: block; overflow: hidden; border: 1px solid #aebdc9; border-radius: 7px; background: #fff; box-shadow: 0 2px 7px #33475b12; color: #243849; transition: opacity .18s, box-shadow .18s, border-color .18s; }
.designer-module.is-new { border: 2px solid #e8682d; }
.designer-module.is-extended { border-color: #0091ae; }
.designer-module.is-catalog { border-style: dashed; }
.designer-module.is-selected { box-shadow: 0 0 0 3px #0091ae35, 0 4px 12px #33475b22; }
.designer-module.is-dimmed { opacity: .22; }
.designer-module-head { display: flex; justify-content: space-between; gap: 6px; align-items: center; padding: 9px 11px 5px; font-size: 12px; background: #f4f7f9; }
.designer-module.is-new .designer-module-head { background: #fff3ef; }
.designer-module-meta { display: flex; gap: 5px; align-items: center; padding: 0 11px 7px; font-size: 10px; color: #708191; background: #f4f7f9; }
.designer-module.is-new .designer-module-meta { background: #fff3ef; }
.designer-badge { border-radius: 20px; background: #e8682d; color: white; padding: 2px 7px; font-size: 9px; font-weight: 700; }
.designer-module-fields { padding: 3px 0; }
.designer-field { display: flex; gap: 6px; justify-content: space-between; align-items: center; min-height: 27px; padding: 3px 10px; font-size: 10.5px; }
.designer-field.is-added { background: #e7f6fa; }
.designer-added { border-radius: 3px; background: #d2eef5; color: #087a96; padding: 1px 3px; font-size: 8px; white-space: nowrap; }
.designer-module-total { border-top: 1px solid #e1e7eb; padding: 6px 10px; font-size: 10px; color: #526579; }
.designer-tool { display: inline-flex; min-width: 28px; min-height: 28px; align-items: center; justify-content: center; border-radius: 4px; color: #526579; }
.designer-tool:hover:not(:disabled) { background: #edf3f6; }
.designer-tool:focus-visible { outline: 2px solid #0091ae; }
.designer-tool:disabled { opacity: .35; }
.designer-dot { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 2px; }
</style>

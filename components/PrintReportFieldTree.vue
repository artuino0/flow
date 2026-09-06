<script setup lang="ts">
// ERD-88 (Diseñador de reportes imprimibles): panel "Campos disponibles"
// (izquierda de Screen/Diseñador de reporte imprimible - 3 columnas). Fiel al
// mock en la forma del árbol (branches expandibles con ícono `c`/`lk` según
// sea forward o el cardinality badge "1 : N" para inverse, leaves con badge
// de tipo) - NO fiel en la interacción: el mock arrastra campos al lienzo,
// acá (sin librería de drag-and-drop) un clic en una hoja la agrega
// directamente como columna nueva del reporte (ver PrintReportDesigner.vue).
//
// Recursivo: se referencia a sí mismo para las branches. `chosenDetailField`
// es el fieldName (nivel 0) de la ÚNICA tabla relacionada ya elegida, si hay
// una - cualquier OTRA branch inverse de nivel 0 se muestra deshabilitada
// (ReportPathPlanner solo soporta una). Un salto inverso anidado dentro de
// otro (a cualquier profundidad > 0) no es resoluble por ReportPathPlanner
// (ver composables/usePrintReports.ts) y directamente no se renderiza.
import { ChevronRight, Link2, Table2 } from '@lucide/vue'
import type { FieldTreeBranch, FieldTreeLeaf, FieldTreeNode } from '~/composables/usePrintReports'

const props = withDefaults(
  defineProps<{
    nodes: FieldTreeNode[]
    depth?: number
    forwardHops?: string[]
    side?: 'base' | 'detail'
    chosenDetailField?: string | null
  }>(),
  { depth: 0, forwardHops: () => [], side: 'base' }
)

const emit = defineEmits<{
  'select-leaf': [{ side: 'base' | 'detail'; forwardHops: string[]; field: string; label: string; dataType: string }]
  'select-detail-branch': [FieldTreeBranch]
}>()

const TYPE_BADGE: Record<string, string> = {
  text: 'Texto',
  date: 'Fecha',
  number: 'N.º',
  incremental: 'N.º',
  boolean: 'Sí/No',
  select: 'Selección',
  multiselect: 'Selección',
  json: 'JSON'
}
function typeBadge(dataType: string): string {
  return TYPE_BADGE[dataType] ?? dataType
}

const expanded = ref<Record<string, boolean>>({})
function toggle(key: string) {
  expanded.value[key] = !expanded.value[key]
}

function onLeafClick(node: FieldTreeLeaf) {
  emit('select-leaf', { side: props.side, forwardHops: props.forwardHops, field: node.fieldName, label: node.label, dataType: node.dataType })
}

function isDisabledInverseBranch(node: FieldTreeBranch): boolean {
  return props.depth === 0 && node.kind === 'inverse' && !!props.chosenDetailField && props.chosenDetailField !== node.fieldName
}

function onBranchClick(node: FieldTreeBranch) {
  const key = `${props.depth}-${node.fieldName}`
  if (node.kind === 'inverse' && props.depth === 0) {
    if (isDisabledInverseBranch(node)) return
    emit('select-detail-branch', node)
  }
  toggle(key)
}

// Un salto inverso solo es una ruta válida de tabla relacionada a
// profundidad 0 - más adentro (ya sea dentro de otro forward o de la propia
// tabla relacionada elegida) no tiene lectura para ReportPathPlanner y se
// descarta directamente de lo que se renderiza.
const visibleNodes = computed(() => props.nodes.filter((n) => n.type === 'leaf' || props.depth === 0 || n.kind === 'forward'))
</script>

<template>
  <ul class="flex flex-col gap-0.5" :style="{ paddingLeft: depth > 0 ? '14px' : '0px' }">
    <li v-for="node in visibleNodes" :key="node.type === 'leaf' ? `leaf-${node.fieldName}` : `branch-${node.fieldName}`">
      <button
        v-if="node.type === 'leaf'"
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg"
        @click="onLeafClick(node)"
      >
        <span class="truncate">{{ node.label }}</span>
        <span class="shrink-0 rounded bg-brand-neutral-bg px-1.5 py-0.5 text-[10px] font-semibold text-brand-neutral-text">{{ typeBadge(node.dataType) }}</span>
      </button>

      <template v-else>
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-semibold hover:bg-brand-bg"
          :class="isDisabledInverseBranch(node) ? 'cursor-not-allowed text-brand-text-muted' : 'text-brand-text'"
          :disabled="isDisabledInverseBranch(node)"
          @click="onBranchClick(node)"
        >
          <ChevronRight class="h-3.5 w-3.5 shrink-0 transition-transform" :class="{ 'rotate-90': expanded[`${depth}-${node.fieldName}`] }" :stroke-width="2" />
          <Link2 v-if="node.kind === 'forward'" class="h-3.5 w-3.5 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
          <Table2 v-else class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="1.75" />
          <span class="truncate">{{ node.entityName }}</span>
          <span v-if="node.kind === 'inverse'" class="ml-auto shrink-0 rounded-full bg-brand-blue/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-blue">1 : N</span>
        </button>

        <PrintReportFieldTree
          v-if="expanded[`${depth}-${node.fieldName}`] && !isDisabledInverseBranch(node)"
          :nodes="node.children"
          :depth="depth + 1"
          :forward-hops="node.kind === 'forward' ? [...forwardHops, node.fieldName] : []"
          :side="node.kind === 'inverse' ? 'detail' : side"
          :chosen-detail-field="chosenDetailField"
          @select-leaf="emit('select-leaf', $event)"
          @select-detail-branch="emit('select-detail-branch', $event)"
        />
      </template>
    </li>
  </ul>
</template>

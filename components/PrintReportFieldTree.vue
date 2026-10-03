<script setup lang="ts">
// ERD-88 (Diseñador de reportes imprimibles): panel "Campos disponibles"
// (izquierda de Screen/Diseñador de reporte imprimible - 3 columnas). Fiel al
// mock (árbol con branches expandibles - ícono `c`/`lk` según sea forward, o
// el cardinality badge rosa "1 : N" para inverse - y hojas con ícono
// `grip-vertical` + badge de tipo con el color exacto del dataType,
// confirmado nodo por nodo con las herramientas de Pencil: Texto=neutral,
// Fecha=morado, N.º=azul, Sí/No=verde, 1:N=rosa - los mismos tokens de
// tailwind.config.ts ya usados en otras pantallas, solo que acá el mock los
// asigna distinto por dataType).
//
// Corrección (2026-09-07, reporte directo del usuario: "no veo el drag and
// drop"): la primera entrega de esta pantalla reemplazaba el drag-and-drop
// real del mock por un clic-para-agregar, con el argumento de que el
// proyecto no tenía ninguna librería de DnD. Eso seguía siendo cierto, pero
// no hacía falta una librería: la API nativa de HTML5 (`draggable`,
// `dragstart`/`dragover`/`drop`) alcanza para un caso simple de "una lista
// arrastra a otra lista", así que ahora las hojas SÍ son arrastrables de
// verdad - el payload va en `dataTransfer` como JSON (mismo shape que emite
// `select-leaf`) y quien escucha el `drop` (PrintReportDesigner.vue) lo
// procesa igual que un clic. El clic se mantiene además del drag (no se
// quita ninguna interacción, se agrega la que faltaba - también mejora
// accesibilidad para quien no puede arrastrar).
//
// Recursivo: se referencia a sí mismo para las branches. `chosenDetailField`
// es el fieldName (nivel 0) de la ÚNICA tabla relacionada ya elegida, si hay
// una - cualquier OTRA branch inverse de nivel 0 se muestra deshabilitada
// (ReportPathPlanner solo soporta una). Un salto inverso anidado dentro de
// otro (a cualquier profundidad > 0) no es resoluble por ReportPathPlanner
// (ver composables/usePrintReports.ts) y directamente no se renderiza.
import { ChevronRight, GripVertical, Link2, Table2 } from '@lucide/vue'
import type { FieldTreeBranch, FieldTreeLeaf, FieldTreeNode } from '~/composables/usePrintReports'

const props = withDefaults(
  defineProps<{
    nodes: FieldTreeNode[]
    depth?: number
    forwardHops?: string[]
    side?: 'base' | 'detail'
    chosenDetailField?: string | null
    search?: string
  }>(),
  { depth: 0, forwardHops: () => [], side: 'base', search: '' }
)

const emit = defineEmits<{
  'select-leaf': [{ side: 'base' | 'detail'; forwardHops: string[]; field: string; label: string; dataType: string }]
  'select-detail-branch': [FieldTreeBranch]
}>()

// Colores exactos del mock (Get() nodo por nodo en HgECQ: leafNumero/
// leafFecha/leafEstado/leafPeso/leafEmbarcado) - mapeados a los tokens de
// tailwind.config.ts que ya tienen ese mismo par bg/text (no se inventó
// ningún color nuevo). select/multiselect no tienen ejemplo en este mock
// puntual (el dataset de la HU no usa ese tipo) - se reusa "info", el mismo
// color que ya identifica select/multiselect en ModuleFieldsCard.vue.
const TYPE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  text: { label: 'Texto', bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text' },
  date: { label: 'Fecha', bg: 'bg-brand-purple-bg', text: 'text-brand-purple-text' },
  number: { label: 'N.º', bg: 'bg-brand-blue-bg', text: 'text-brand-blue' },
  currency: { label: 'Monto', bg: 'bg-brand-success-bg', text: 'text-brand-success-text' },
  incremental: { label: 'N.º', bg: 'bg-brand-blue-bg', text: 'text-brand-blue' },
  boolean: { label: 'Sí/No', bg: 'bg-brand-success-bg', text: 'text-brand-success-text' },
  select: { label: 'Selección', bg: 'bg-brand-info-bg', text: 'text-brand-info-text' },
  multiselect: { label: 'Selección', bg: 'bg-brand-info-bg', text: 'text-brand-info-text' },
  json: { label: 'JSON', bg: 'bg-brand-purple-bg', text: 'text-brand-purple-text' }
}
function typeBadge(dataType: string) {
  return TYPE_BADGE[dataType] ?? { label: dataType, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text' }
}

const expanded = ref<Record<string, boolean>>({})
function toggle(key: string) {
  expanded.value[key] = !expanded.value[key]
}

function leafPayload(node: FieldTreeLeaf) {
  return { side: props.side, forwardHops: props.forwardHops, field: node.fieldName, label: node.label, dataType: node.dataType }
}
function matchesSearch(node: FieldTreeNode): boolean {
  const query = props.search.trim().toLocaleLowerCase()
  if (!query) return true
  return node.type === 'leaf' ? node.label.toLocaleLowerCase().includes(query) : node.entityName.toLocaleLowerCase().includes(query) || node.children.some(matchesSearch)
}
function onLeafClick(node: FieldTreeLeaf) {
  emit('select-leaf', leafPayload(node))
}
function onLeafDragStart(event: DragEvent, node: FieldTreeLeaf) {
  event.dataTransfer?.setData('application/json', JSON.stringify(leafPayload(node)))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function isDisabledInverseBranch(node: FieldTreeBranch): boolean {
  return props.depth === 0 && node.kind === 'inverse' && !!props.chosenDetailField && props.chosenDetailField !== `${node.entitySlug}|${node.fieldName}`
}

function onBranchClick(node: FieldTreeBranch) {
  const key = `${props.depth}-${node.fieldName}`
  if (node.kind === 'inverse' && props.depth === 0) {
    if (isDisabledInverseBranch(node)) return
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
    <li v-for="node in visibleNodes.filter(matchesSearch)" :key="node.type === 'leaf' ? `leaf-${node.fieldName}` : `branch-${node.entitySlug}-${node.fieldName}`">
      <button
        v-if="node.type === 'leaf'"
        type="button"
        draggable="true"
        class="flex w-full cursor-grab items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg active:cursor-grabbing"
        @click="onLeafClick(node)"
        @dragstart="onLeafDragStart($event, node)"
      >
        <GripVertical class="h-3 w-3 shrink-0 text-brand-sites-muted" :stroke-width="1.75" />
        <span class="flex-1 truncate">{{ node.label }}</span>
        <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" :class="[typeBadge(node.dataType).bg, typeBadge(node.dataType).text]">{{ typeBadge(node.dataType).label }}</span>
      </button>

      <template v-else>
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-semibold hover:bg-brand-bg"
          :class="isDisabledInverseBranch(node) ? 'cursor-not-allowed text-brand-sites-muted' : 'text-brand-text'"
          :disabled="isDisabledInverseBranch(node)"
          @click="onBranchClick(node)"
        >
          <ChevronRight class="h-3.5 w-3.5 shrink-0 transition-transform" :class="{ 'rotate-90': expanded[`${depth}-${node.fieldName}`] }" :stroke-width="2" />
          <Link2 v-if="node.kind === 'forward'" class="h-3.5 w-3.5 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
          <Table2 v-else class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="1.75" />
          <span class="truncate">{{ node.entityName }}</span>
          <span v-if="node.kind === 'forward'" class="ml-auto text-[10px] font-normal text-brand-sites-muted">Un valor</span>
          <span v-if="node.kind === 'inverse'" class="ml-auto shrink-0 rounded-full bg-brand-pink-bg px-1.5 py-0.5 text-[10px] font-bold text-brand-pink-text">1 : N</span>
        </button>

        <button v-if="node.kind === 'inverse' && expanded[`${depth}-${node.fieldName}`] && !chosenDetailField" type="button" class="my-2 ml-4 rounded border border-brand-control-border px-3 py-2 text-xs text-brand-blue" @click="emit('select-detail-branch', node)">Usar {{ node.entityName }} como filas del reporte</button>
        <PrintReportFieldTree
          v-if="(expanded[`${depth}-${node.fieldName}`] || (search && node.kind === 'forward')) && !isDisabledInverseBranch(node) && (node.kind === 'forward' || !!chosenDetailField)"
          :nodes="node.children"
          :depth="depth + 1"
          :forward-hops="node.kind === 'forward' ? [...forwardHops, node.fieldName] : []"
          :side="node.kind === 'inverse' ? 'detail' : side"
          :chosen-detail-field="chosenDetailField"
          :search="node.entityName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? '' : search"
          @select-leaf="emit('select-leaf', $event)"
          @select-detail-branch="emit('select-detail-branch', $event)"
        />
      </template>
    </li>
  </ul>
</template>

<style scoped>
button:focus-visible { outline: 2px solid rgb(var(--brand-blue)); outline-offset: 2px; }
</style>

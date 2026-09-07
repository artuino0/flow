<script setup lang="ts">
// ERD-88 (Diseñador de reportes imprimibles): la hoja impresa real, fiel a
// Screen/Vista previa impresión (grupos anidados) del .pen (`A0UnX`),
// revisada con las herramientas de Pencil antes de construir esta pantalla
// (regla pencil-antes-de-frontend). Reusado por
// pages/registros/[entity]/reportes/vista-previa.vue (dsl sin guardar, recién
// armado en el Diseñador) y .../[id]/imprimir.vue (plantilla guardada,
// siempre reejecutada en vivo - ver el comentario grande sobre por qué
// print_reports nunca congela un resultado, en server/db/schema.ts).
//
// Decisiones de alcance (documentadas, mismo criterio que
// PrintReportDesigner.vue): el mock también pagina la hoja en páginas fijas
// ("Página 1 de 2") con el encabezado de columnas repetido a mano en cada
// una - en vez de reimplementar esa paginación a mano, se usa una única
// <table> continua con <thead> real: la mayoría de los navegadores ya
// repiten el <thead> al cortar la impresión en varias hojas físicas, sin
// necesitar lógica de paginación propia (lo único que NO se logra así es la
// numeración real "Página X de Y", que sí queda fuera de esta entrega). La
// fila "PARÁMETROS DEL REPORTE" (filtros elegidos AL imprimir) también sigue
// fuera - no hay un tipo de columna "parámetro de filtro" en el DSL.
//
// Corrección (2026-09-07, pedido directo del usuario: "trabajar en los
// ajustes para cargar el logo y los datos de la empresa emisora del
// reporte"): el encabezado SÍ dibuja ahora logo + razón social + RFC, fiel a
// la zona "mh" del mock (`cCoWH` en A0UnX) - antes se documentaba como fuera
// de alcance por falta de un endpoint que expusiera estos datos; ese
// endpoint ya existe (GET /api/tenant/branding + GET /api/tenant/logo, ver
// pages/ajustes/index.vue). La columna derecha del mock ("N.º RPT-0087") no
// se agrega - no existe un folio por reporte impreso, y no hay evidencia en
// el resto del .pen de cómo se numeraría uno.
import type { PrintReportGroup, PrintReportResult, PrintReportResultColumn, PrintReportRow } from '~/composables/usePrintReports'

const props = defineProps<{
  result: PrintReportResult
  groupFieldLabels: string[]
  generatedAt: Date
}>()

interface TenantBranding {
  name: string
  fiscalData: Record<string, unknown>
  hasLogo: boolean
}
const { data: branding } = useFetch<TenantBranding>('/api/tenant/branding', {
  key: 'print-report-branding',
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const logoSrc = computed(() => (branding.value?.hasLogo ? '/api/tenant/logo' : null))
const companyLine = computed(() => {
  if (!branding.value) return ''
  const rfc = branding.value.fiscalData?.rfc as string | undefined
  return rfc ? `${branding.value.name}  ·  RFC ${rfc}` : branding.value.name
})

type Line =
  | { kind: 'group-header'; level: number; text: string }
  | { kind: 'detail'; row: PrintReportRow }
  | { kind: 'summary'; totalLabel: string; totals: Record<string, number> }

const firstDetalleIndex = computed(() => props.result.columns.findIndex((c) => c.kind === 'detalle'))
const lastDetalleIndex = computed(() => {
  let idx = -1
  props.result.columns.forEach((c, i) => {
    if (c.kind === 'detalle') idx = i
  })
  return idx
})
const hasTotals = computed(() => props.result.columns.some((c) => c.kind !== 'detalle'))
// Si no hay ninguna columna 'detalle' (caso raro: reporte de solo columnas
// numéricas agregadas), la etiqueta de la fila de subtotal/total no tiene
// dónde ir - se cae a la primera columna para no perderla.
const summaryLabelIndex = computed(() => (firstDetalleIndex.value >= 0 ? firstDetalleIndex.value : 0))

// Etiquetas de "Subtotal"/"Total" por nivel: el nivel 0 (el más externo, ej.
// "Fecha") siempre dice "Total {valor}"; cualquier nivel más adentro (ej.
// "Cultivo") siempre dice "Subtotal {valor}" - confirmado en el mock (que
// llega hasta 2 niveles) y documentado igual en printReport.ts.
function totalLabelFor(level: number, groupLabel: string): string {
  return `${level === 0 ? 'Total' : 'Subtotal'} ${groupLabel}`
}

function pushGroup(group: PrintReportGroup, level: number, lines: Line[]) {
  const fieldLabel = props.groupFieldLabels[level] ?? `Nivel ${level + 1}`
  lines.push({ kind: 'group-header', level, text: `${fieldLabel}:  ${group.label}` })
  if (group.children.length > 0) {
    for (const child of group.children) pushGroup(child, level + 1, lines)
  } else {
    for (const row of group.rows) lines.push({ kind: 'detail', row })
  }
  lines.push({ kind: 'summary', totalLabel: totalLabelFor(level, group.label), totals: group.subtotals })
}

const lines = computed<Line[]>(() => {
  const out: Line[] = []
  if (props.result.groups.length > 0) {
    for (const group of props.result.groups) pushGroup(group, 0, out)
  } else {
    for (const row of props.result.ungroupedRows) out.push({ kind: 'detail', row })
  }
  if (hasTotals.value && (props.result.groups.length > 0 || props.result.ungroupedRows.length > 0)) {
    out.push({ kind: 'summary', totalLabel: 'TOTAL GENERAL', totals: props.result.grandTotals })
  }
  return out
})

const numberFormatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
function formatNumber(n: number | undefined): string {
  return numberFormatter.format(n ?? 0)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
const generatedLabel = computed(() => {
  const d = props.generatedAt
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
})
// Solo fecha (sin hora), fiel al "Emitido 14/08/2026" de mrr/b en el mock -
// la hora sí se muestra abajo, en el pie ("Generado por FlowERP · ...").
const emittedDateLabel = computed(() => {
  const d = props.generatedAt
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
})

function detailCellText(col: PrintReportResultColumn, row: PrintReportRow, index: number): string {
  const value = row.values[col.key]
  const text = value === null || value === undefined ? '' : col.kind === 'detalle' ? String(value) : formatNumber(Number(value))
  // "· Eliminado" se agrega al ÚLTIMO campo de detalle de la fila (el más
  // cercano, en el mock, a la columna "Código") - una entrega genérica no
  // sabe cuál columna es "la identificadora" del registro, así que se elige
  // consistentemente la última columna de tipo 'detalle' en vez de una
  // heurística más frágil.
  if (row.isDeleted && index === lastDetalleIndex.value) return text ? `${text}  ·  Eliminado` : 'Eliminado'
  return text
}
</script>

<template>
  <div class="mx-auto w-full max-w-[840px] border border-brand-border-light bg-white p-8 text-[#2B2B2B] shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
    <div class="mb-3.5 flex items-center gap-3.5">
      <div class="flex h-11 w-[66px] shrink-0 items-center justify-center rounded-sm border border-[#BFBFBF]">
        <img v-if="logoSrc" :src="logoSrc" alt="Logo de la organización" class="h-full w-full object-contain" />
        <span v-else class="text-[9px] text-[#9A9A9A]">LOGO</span>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 class="truncate text-lg font-bold tracking-wide text-[#1A1A1A]">{{ result.title }}</h1>
        <p v-if="companyLine" class="truncate text-[10px] text-[#555555]">{{ companyLine }}</p>
      </div>
      <div class="shrink-0 text-[10px] text-[#555555]">Emitido {{ emittedDateLabel }}</div>
    </div>
    <div class="mb-4 h-[2px] w-full bg-[#1A1A1A]" />

    <table class="w-full border-collapse border border-[#B8B8B8] text-[10.5px]">
      <thead>
        <tr class="bg-[#EAEAEA]">
          <th
            v-for="col in result.columns"
            :key="col.key"
            class="border-b border-[#B8B8B8] px-2.5 py-1.5 text-[10px] font-bold text-[#2B2B2B]"
            :class="col.kind === 'detalle' ? 'text-left' : 'text-right'"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(line, i) in lines" :key="i">
          <tr v-if="line.kind === 'group-header'" :style="{ backgroundColor: line.level === 0 ? '#E4E4E4' : '#F0F0F0' }">
            <td
              :colspan="result.columns.length"
              class="border-b border-[#CFCFCF] py-1.5 font-bold text-[#1F1F1F]"
              :style="{ paddingLeft: `${10 + line.level * 12}px`, fontSize: line.level === 0 ? '11px' : '10.5px' }"
            >
              {{ line.text }}
            </td>
          </tr>

          <tr v-else-if="line.kind === 'detail'" :class="line.row.isDeleted ? 'bg-[#F3F3F3]' : 'bg-white'">
            <td
              v-for="(col, ci) in result.columns"
              :key="col.key"
              class="border-b border-[#DBDBDB] px-2.5 py-1.5"
              :class="[col.kind === 'detalle' ? 'text-left' : 'text-right', line.row.isDeleted ? 'text-[#9A9A9A]' : 'text-[#2B2B2B]']"
            >
              {{ detailCellText(col, line.row, ci) }}
            </td>
          </tr>

          <tr v-else :class="line.totalLabel === 'TOTAL GENERAL' ? 'bg-[#D6D6D6]' : 'bg-[#FAFAFA]'">
            <td
              v-for="(col, ci) in result.columns"
              :key="col.key"
              class="border-b border-[#CFCFCF] px-2.5 py-1.5 font-bold text-[#1F1F1F]"
              :class="col.kind === 'detalle' ? 'text-left' : 'text-right'"
              :style="line.totalLabel === 'TOTAL GENERAL' ? { borderTop: '1.6px solid #CFCFCF' } : undefined"
            >
              <template v-if="ci === summaryLabelIndex">{{ line.totalLabel }}</template>
              <template v-else-if="col.kind !== 'detalle'">{{ formatNumber(line.totals[col.key]) }}</template>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <div class="mt-3.5 flex items-center justify-between text-[9px] text-[#B0B0B0]">
      <span>Generado por FlowERP · {{ generatedLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Evita que el navegador corte una fila de detalle o de subtotal a la mitad
   entre dos hojas impresas - el <thead> de la tabla ya se repite solo en
   cada hoja nueva (ver comentario grande arriba sobre la paginación). */
tr {
  break-inside: avoid;
}
</style>

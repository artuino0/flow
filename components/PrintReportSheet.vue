<script setup lang="ts">
import type { PrintReportGroup, PrintReportResult } from '~/composables/usePrintReports'
import type { ReportLine } from '~/components/PrintReportPage.vue'
import { paginateReportRows, paperDimensions, resolvePrintLayout, type PrintLayout } from '~/utils/printLayout'
const props = defineProps<{ result: PrintReportResult; groupFieldLabels: string[]; generatedAt: Date; layout?: PrintLayout }>()
const emit = defineEmits<{ ready: [value: boolean]; pages: [count: number] }>()
const layout = computed(() => resolvePrintLayout(props.layout, props.result.columns.length))
const dimensions = computed(() => paperDimensions(layout.value))
const measure = ref<HTMLElement>()
const pageIndexes = ref<number[][]>([])
const overflow = ref(false)
const { data: branding, status } = useFetch<{ name: string; fiscalData: Record<string, unknown>; hasLogo: boolean; email: string | null; phone: string | null }>('/api/tenant/branding', {
  key: 'print-report-branding', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const company = computed(() => branding.value?.name || 'Organización')
const rfc = computed(() => String(branding.value?.fiscalData?.rfc || ''))
const address = computed(() => {
  const data = branding.value?.fiscalData ?? {}
  return ['calle', 'numeroExterior', 'colonia', 'municipio', 'estado', 'codigoPostal'].map(key => data[key]).filter(Boolean).join(' · ')
})
// Línea de contacto del encabezado impreso (mock tCiL7/SmVgI, 3ra línea de
// OrgCol: "contacto@... · +52 ..."), debajo de nombre y RFC+dirección.
const contact = computed(() => [branding.value?.email, branding.value?.phone].filter(Boolean).join(' · '))
const issued = computed(() => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(props.generatedAt))
const lines = computed(() => {
  const output: ReportLine[] = []
  let number = 0
  const hasTotals = props.result.columns.some(column => column.kind !== 'detalle')
  function visit(group: PrintReportGroup) {
    output.push({ kind: 'group', level: group.level, label: `${props.groupFieldLabels[group.level] || 'Grupo'}: ${group.label}` })
    if (group.children.length) group.children.forEach(visit)
    else group.rows.forEach(row => output.push({ kind: 'row', row, number: ++number }))
    if (hasTotals) output.push({ kind: 'total', label: `Subtotal · ${group.label}`, values: group.subtotals })
  }
  if (props.result.groups.length) props.result.groups.forEach(visit)
  else props.result.ungroupedRows.forEach(row => output.push({ kind: 'row', row, number: ++number }))
  if (hasTotals && (output.length || (props.result.mode === 'summary' && props.result.recordCount))) output.push({ kind: 'total', label: 'TOTAL GENERAL', values: props.result.grandTotals, grand: true })
  return output
})
const rowCount = computed(() => lines.value.filter(line => line.kind === 'row').length)
const pages = computed(() => {
  const seen = new Set<number>()
  return pageIndexes.value.map(indexes => indexes.filter(index => index < lines.value.length).map(index => {
    const line = lines.value[index]!
    const repeated = seen.has(index)
    seen.add(index)
    return line.kind === 'group' && repeated ? { ...line, label: `${line.label} (continuación)` } : line
  }))
})
const common = computed(() => ({ result: props.result, company: company.value, rfc: rfc.value, address: address.value, contact: contact.value,
  logo: branding.value?.hasLogo ? '/api/tenant/logo' : undefined, issued: issued.value, rowCount: rowCount.value }))
const paperStyle = computed(() => ({ '--paper-width': `${dimensions.value.width}mm`, '--paper-height': `${dimensions.value.height}mm` }))
// Screen and print share measured pages. Wrapped text determines row height.
let revision = 0
async function paginate() {
  const current = ++revision
  emit('ready', false)
  await nextTick()
  await document.fonts.ready
  if (current !== revision || !measure.value) return
  const paper = measure.value.querySelector<HTMLElement>('.report-paper')!
  const body = paper.querySelector<HTMLElement>('.report-body')!
  const footer = paper.querySelector<HTMLElement>('.report-footer')!
  const head = paper.querySelector<HTMLElement>('thead')!
  const scale = paper.getBoundingClientRect().width / parseFloat(getComputedStyle(paper).width)
  const capacity = (footer.getBoundingClientRect().top - body.getBoundingClientRect().top - head.getBoundingClientRect().height) / scale - 12
  const rows = [...paper.querySelectorAll<HTMLElement>('[data-report-line]')]
  const heights = rows.map(row => row.getBoundingClientRect().height / scale)
  overflow.value = heights.some(height => height > capacity)
  pageIndexes.value = paginateReportRows(heights, lines.value.map(line => line.kind === 'group'), Math.max(1, capacity), lines.value.map(line => line.kind === 'group' ? line.level : -1), lines.value.map(line => line.kind === 'total'))
  emit('pages', pageIndexes.value.length)
  await nextTick()
  const rendered = measure.value?.parentElement?.querySelectorAll<HTMLElement>(':scope > .report-paper') ?? []
  overflow.value ||= [...rendered].some(page => page.querySelector('table')!.getBoundingClientRect().bottom > page.querySelector('footer')!.getBoundingClientRect().top - 2)
  if (current === revision) emit('ready', !overflow.value && status.value !== 'pending')
}
onMounted(() => { watch([lines, layout, branding, status], paginate, { immediate: true, deep: true }) })
onBeforeUnmount(() => { revision++; emit('ready', false) })
</script>
<template>
  <div class="report-sheets" :class="{ 'report-compact': layout.density === 'compact' }" :style="paperStyle">
    <p v-if="overflow" class="report-overflow-warning" role="alert">Una fila supera el alto de la hoja. Usa orientación vertical, densidad compacta o reduce las columnas antes de imprimir.</p>
    <div ref="measure" class="report-measure" aria-hidden="true" inert><PrintReportPage v-bind="common" :lines="lines" :page="1" :pages="pageIndexes.length || 1" /></div>
    <PrintReportPage v-for="(pageLines, index) in pages" :key="index" v-bind="common" :lines="pageLines" :page="index + 1" :pages="pageIndexes.length" />
  </div>
</template>
<style>
/* 2026-09-11: recolorizado fiel al mock Screen/Reporte - Vista previa
   (tCiL7 en ERPDinamico.pen) - antes usaba Arial y la paleta gris-azulada
   de la app (#53616b/#aab5bc/#33475b). El papel impreso usa Lora (serif,
   look de documento fiscal) y una escala de grises neutros (#1A1A1A a
   #FAFAFA), deliberadamente distinta de la paleta "brand" azul de la app -
   ver el comentario nuevo en nuxt.config.ts. */
.report-sheets { color: #2B2B2B; font-family: 'Lora', Georgia, serif; }
.report-paper { box-sizing: border-box; position: relative; width: var(--paper-width); height: var(--paper-height); margin: 0 auto 24px; padding: 12mm; background: #fff; box-shadow: 0 2px 14px #23334220; font-size: 9pt; line-height: 1.35; }
.report-heading { padding-bottom: 4mm; }
.report-company { display: flex; align-items: center; gap: 5mm; padding-bottom: 3mm; }
.report-logobox { flex: none; width: 18mm; height: 18mm; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.report-logo { width: 100%; height: 100%; object-fit: contain; }
.report-logo-placeholder { font-size: 6.5pt; color: #9A9A9A; letter-spacing: .5px; }
.report-orgcol { min-width: 0; }
.report-company-name { font-size: 13pt; font-weight: 700; color: #1A1A1A; overflow-wrap: anywhere; }
.report-muted, .report-address { font-size: 8pt; color: #666666; margin-top: .8mm; overflow-wrap: anywhere; }
.report-rule { height: .6mm; background: #1A1A1A; margin-bottom: 3mm; }
.report-document { padding: 0 0 2mm; }
.report-eyebrow { text-transform: uppercase; font-size: 7.5pt; font-weight: 700; letter-spacing: 1.2px; color: #8A8A8A; margin-bottom: 1mm; }
.report-document h1 { font-size: 15pt; font-weight: 700; color: #1A1A1A; line-height: 1.2; overflow-wrap: anywhere; }
.report-metadata { font-size: 8pt; line-height: 1.5; color: #3A3A3A; overflow-wrap: anywhere; }
.report-body { padding: 0; }
.report-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 8.5pt; }
.report-table th, .report-table td { padding: 2mm; border-bottom: .2mm solid #DCDCDC; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.report-table thead th { background: #EAEAEA; border-bottom: .3mm solid #B8B8B8; color: #2B2B2B; font-size: 8pt; font-weight: 700; }
.report-index-column { width: 5%; }
.report-table .report-index { font-size: 7pt; color: #666666; text-align: center; }
.report-table .report-numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; overflow-wrap: normal; word-break: normal; }
.report-table .report-date { white-space: nowrap; overflow-wrap: normal; word-break: normal; }
.report-group th { background: #E4E4E4; color: #1F1F1F; font-weight: 700; border-bottom: .2mm solid #CFCFCF; }
.report-group-inner th { background: #EDEDED; font-size: 8pt; }
.report-alternate { background: #FFFFFF; }
.report-total td { background: #FAFAFA; color: #1F1F1F; font-weight: 700; border-bottom: .2mm solid #CFCFCF; }
.report-grand-total td { background: #F2F2F2; border-top: .5mm solid #1A1A1A; border-bottom: .2mm solid #CFCFCF; }
.report-numeric-label { display: block; font-size: 6.5pt; margin-bottom: 1mm; }
.report-deleted { color: #8A8A8A; }
.report-deleted-label { display: block; font-size: 5.5pt; }
.report-footer { position: absolute; bottom: 10mm; left: 12mm; right: 12mm; border-top: .2mm solid #DCDCDC; padding-top: 2mm; display: flex; justify-content: space-between; gap: 5mm; font-size: 7pt; }
.report-footer span:first-child { max-width: 75%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #B0B0B0; }
.report-footer span:last-child { color: #8A8A8A; }
.report-table .report-empty { text-align: center; padding: 12mm 3mm; color: #666666; }
.report-compact .report-table { font-size: 7.5pt; }
.report-compact .report-table th, .report-compact .report-table td { padding-top: 1.2mm; padding-bottom: 1.2mm; }
.report-measure { position: fixed; left: -20000px; top: 0; visibility: hidden; pointer-events: none; }
.report-measure .report-paper { height: var(--paper-height); }
.report-overflow-warning { max-width: 70ch; margin: 16px auto; color: #9b351d; background: #fff0e8; padding: 12px; }
@media print {
  html, body, #__nuxt { margin: 0 !important; padding: 0 !important; background: white !important; }
  .report-measure, .report-overflow-warning { display: none !important; }
  .report-paper { margin: 0; box-shadow: none; break-after: page; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .report-paper:last-child { break-after: auto; }
  .report-table tr { break-inside: avoid; }
}
</style>

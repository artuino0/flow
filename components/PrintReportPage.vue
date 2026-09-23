<script setup lang="ts">
import type { PrintReportResult, PrintReportRow } from '~/composables/usePrintReports'
import { formatReportCell } from '~/utils/reportCellFormat'
export type ReportLine =
  | { kind: 'group'; level: number; label: string }
  | { kind: 'row'; row: PrintReportRow; number: number }
  | { kind: 'total'; label: string; values: Record<string, number>; grand?: boolean }
const props = defineProps<{
  result: PrintReportResult; lines: ReportLine[]; company: string; rfc?: string; address?: string; contact?: string;
  logo?: string; issued: string; page: number; pages: number; rowCount: number
}>()
const labelIndex = computed(() => props.result.columns.findIndex(c => c.kind === 'detalle'))
const columnWidths = computed(() => {
  const weights = props.result.columns.map(column => {
    if (column.dataType === 'currency') return 1.35
    if (column.dataType === 'date') return 1.3
    if (column.dataType === 'number') return 1.05
    return column.kind === 'detalle' ? 1.45 : 1.15
  })
  const sum = weights.reduce((a, b) => a + b, 0)
  return weights.map(weight => `${weight / sum * 95}%`)
})
// Meta impresa (2026-09-11, mock tCiL7/WCbXm): una sola línea con los tres
// segmentos ("Fecha de emisión: ... · Criterios: ... · Registros: ...") en
// vez de dos bloques sueltos (criterios arriba, emisión/filas abajo) - el
// separador " · " del mock, no un salto de línea.
const meta = computed(() => {
  const parts = [`Fecha de emisión: ${props.issued}`]
  if (props.result.criteria?.length) parts.push(`Criterios: ${props.result.criteria.join(' · ')}`)
  parts.push(props.result.mode === 'summary' ? `Registros: ${props.result.recordCount ?? 0}` : `Registros: ${props.rowCount}`)
  return parts.join('   ·   ')
})
</script>
<template>
  <article class="report-paper">
    <header class="report-heading">
      <div class="report-company">
        <div class="report-logobox"><img v-if="logo" :src="logo" alt="" class="report-logo" /><span v-else class="report-logo-placeholder">LOGO</span></div>
        <div class="report-orgcol"><p class="report-company-name">{{ company }}</p><p v-if="rfc || address" class="report-muted">{{ [rfc && `RFC ${rfc}`, address].filter(Boolean).join(' · ') }}</p><p v-if="contact" class="report-muted">{{ contact }}</p></div>
      </div>
      <div class="report-rule" />
      <div class="report-document"><p class="report-eyebrow">Reporte operativo</p><h1>{{ result.title }}</h1></div>
      <p class="report-metadata">{{ meta }}</p>
    </header>
    <div class="report-body">
      <table class="report-table">
        <colgroup><col class="report-index-column" /><col v-for="(column, i) in result.columns" :key="column.key" :style="{ width: columnWidths[i] }" /></colgroup>
        <thead><tr><th scope="col" class="report-index">N.º</th><th v-for="column in result.columns" :key="column.key" scope="col" :class="{ 'report-numeric': column.kind !== 'detalle' }">{{ column.label }}</th></tr></thead>
        <tbody>
          <template v-for="(line, i) in lines" :key="i">
            <tr v-if="line.kind === 'group'" data-report-line class="report-group" :class="{ 'report-group-inner': line.level > 0 }"><th :colspan="result.columns.length + 1" scope="rowgroup" :style="{ paddingLeft: `${3 + line.level * 3}mm` }">{{ line.label }}</th></tr>
            <tr v-else-if="line.kind === 'row'" data-report-line :class="{ 'report-deleted': line.row.isDeleted, 'report-alternate': line.number % 2 === 0 }">
              <td class="report-index">{{ line.number }}<span v-if="line.row.isDeleted" class="report-deleted-label">Eliminado</span></td>
              <td v-for="column in result.columns" :key="column.key" :class="{ 'report-numeric': column.kind !== 'detalle' || column.dataType === 'number' || column.dataType === 'currency' || typeof line.row.values[column.key] === 'number', 'report-date': column.dataType === 'date' }">{{ formatReportCell(line.row.values[column.key], column.dataType, column.kind !== 'detalle', column.currency, column.decimals) }}</td>
            </tr>
            <tr v-else data-report-line class="report-total" :class="{ 'report-grand-total': line.grand }">
              <td class="report-index"><span v-if="labelIndex < 0">Σ</span></td>
              <td v-for="(column, ci) in result.columns" :key="column.key" :class="{ 'report-numeric': column.kind !== 'detalle' }">
                <span v-if="ci === labelIndex" class="report-total-label">{{ line.label }}</span>
                <template v-if="column.kind !== 'detalle'"><span v-if="ci === 0 && labelIndex < 0" class="report-total-label report-numeric-label">{{ line.label }}</span>{{ formatReportCell(line.values[column.key] ?? 0, column.dataType, true, column.currency, column.decimals) }}</template>
              </td>
            </tr>
          </template>
          <tr v-if="!lines.length"><td :colspan="result.columns.length + 1" class="report-empty">No hay registros para mostrar.</td></tr>
        </tbody>
      </table>
    </div>
    <!-- Pie con "Flow · {empresa}" - pedido explícito del usuario
         (2026-09-11) de mantenerlo así; el mock tCiL7 solo mostraba el
         nombre de la empresa, no revertir sin pedido explícito. -->
    <footer class="report-footer"><span>Flow · {{ company }}</span><span>Página {{ page }} de {{ pages }}</span></footer>
  </article>
</template>

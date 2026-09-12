<script setup lang="ts">
import { ArrowLeft, ListFilter, Pencil, Printer, SlidersHorizontal } from '@lucide/vue'
import type { PrintReportResult } from '~/composables/usePrintReports'
import { resolvePrintLayout, type PrintLayout } from '~/utils/printLayout'
// hasParameters/change-filters (2026-09-11, mock tCiL7): "Cambiar filtros"
// vive en el Top Bar junto a Editar diseño/Imprimir-PDF, no como botón
// flotante suelto (como estaba en pages/.../[id]/imprimir.vue) - y el mock
// suma una "Filters Strip" con los criterios aplicados, justo debajo de la
// View Bar. Reusa result.criteria (ya lo arma server/api/print-reports/
// preview.post.ts a partir de las respuestas del modal de parámetros), no
// hace falta un prop nuevo para el contenido de la franja.
const props = defineProps<{ title: string; result: PrintReportResult | null; loading: boolean; error: string; groupFieldLabels: string[]; generatedAt: Date; initialLayout?: PrintLayout; editable?: boolean; hasParameters?: boolean }>()
const emit = defineEmits<{ close: []; edit: []; layout: [value: PrintLayout]; 'change-filters': [] }>()
const layout = ref(resolvePrintLayout(props.initialLayout, props.result?.columns.length))
const customized = ref(false)
function updateLayout(value: PrintLayout) { customized.value = true; layout.value = value }
watch(() => props.initialLayout, value => {
  const next = resolvePrintLayout(value, props.result?.columns.length)
  if (JSON.stringify(next) !== JSON.stringify(layout.value)) layout.value = next
})
const ready = ref(false)
const pageCount = ref(0)
const zoom = ref('0.85')
watch(layout, value => { ready.value = false; emit('layout', value) }, { deep: true })
watch(() => props.result, value => { ready.value = false; if (!props.initialLayout && !customized.value) layout.value = resolvePrintLayout(undefined, value?.columns.length) })
useHead(() => ({ style: [{ key: 'report-page-size', textContent: `@page { size: ${layout.value.paper === 'letter' ? 'letter' : 'A4'} ${layout.value.orientation}; margin: 0; }` }] }))
async function print() {
  if (!ready.value || props.loading || props.error) return
  await document.fonts.ready
  const images = [...document.querySelectorAll<HTMLImageElement>('.report-sheets img')]
  await Promise.all(images.map(image => image.decode().catch(() => {})))
  window.print()
}
</script>
<template>
  <main class="report-preview">
    <header class="report-preview-toolbar">
      <div class="report-preview-actions"><button type="button" @click="emit('close')"><ArrowLeft :size="16" /> Volver</button><div><strong>{{ title || 'Vista previa del reporte' }}</strong><p>Vista previa · {{ pageCount }} {{ pageCount === 1 ? 'página' : 'páginas' }}</p></div></div>
      <div class="report-preview-actions"><button v-if="hasParameters" type="button" @click="emit('change-filters')"><SlidersHorizontal :size="16" /> Cambiar filtros</button><button v-if="editable" type="button" @click="emit('edit')"><Pencil :size="16" /> Editar diseño</button><button type="button" class="report-print-button" :disabled="!ready || loading || !!error" @click="print"><Printer :size="16" /> Imprimir / PDF</button></div>
    </header>
    <section class="report-preview-options" aria-label="Opciones de impresión">
      <div class="report-preview-options-selects">
        <PrintReportLayoutControls :model-value="layout" @update:model-value="updateLayout" />
        <ReportOptionSelect v-model="zoom" label="Zoom" :options="[{ value: '0.5', label: '50 %' }, { value: '0.7', label: '70 %' }, { value: '0.85', label: '85 %' }, { value: '1', label: '100 %' }, { value: '1.25', label: '125 %' }, { value: '1.5', label: '150 %' }]" />
      </div>
      <span class="report-paper-note">Márgenes de 12 mm · El zoom solo cambia la vista</span>
    </section>
    <div class="report-filters-strip" aria-label="Filtros aplicados" aria-live="polite">
      <ListFilter :size="14" />
      <strong>Filtros aplicados:</strong>
      <span v-if="loading">Consultando criterios…</span>
      <template v-else-if="result?.criteria?.length"><template v-for="(criterion, index) in result.criteria" :key="index"><span v-if="index" class="report-filters-strip-sep">·</span><span>{{ criterion }}</span></template></template>
      <span v-else>{{ result ? 'Todos los registros' : 'Pendiente de generar' }}</span>
    </div>
    <div v-if="loading" class="report-preview-message" role="status">Preparando el reporte…</div>
    <div v-else-if="error" class="report-preview-message" role="alert">{{ error }}</div>
    <div v-else-if="result" class="report-preview-workspace"><div class="report-preview-zoom" :style="{ zoom }"><PrintReportSheet :result="result" :group-field-labels="groupFieldLabels" :generated-at="generatedAt" :layout="layout" @ready="ready = $event" @pages="pageCount = $event" /></div></div>
  </main>
</template>
<style>
.report-preview { min-height: 100vh; background: #e7ebee; }
.report-preview-toolbar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 14px 24px; background: #fff; border-bottom: 1px solid #d5dde3; }
.report-preview-actions { display: flex; align-items: center; gap: 20px; }
.report-preview-actions strong { font-size: 14px; color: #213343; }
.report-preview-actions p { font-size: 11px; color: #516f90; margin-top: 2px; }
.report-preview-actions button { display: flex; gap: 7px; align-items: center; border: 1px solid #cbd6e2; border-radius: 5px; padding: 9px 12px; font-size: 12px; font-weight: 600; color: #33475b; }
.report-preview-actions button:hover { background: #f0f4f6; }
.report-preview-actions button:focus-visible { outline: 2px solid #0091ae; outline-offset: 3px; }
/* Naranja de marca (brand-orange, #FF7A59) pedido explícitamente por el
   usuario (2026-09-11) para el CTA "Imprimir / PDF" - el mock tCiL7 lo
   mostraba en $primary (azul), pero el resto de la app usa naranja para su
   único botón primario por pantalla (FieldFormModal, DynamicTable, etc.) -
   no revertir a azul/navy sin pedido explícito. */
.report-preview-actions .report-print-button { background: #FF7A59; border-color: #FF7A59; color: #fff; }
.report-preview-actions .report-print-button:hover { background: #E66E50; border-color: #E66E50; color: #fff; }
.report-preview-actions button:disabled { opacity: .45; cursor: not-allowed; }
.report-preview-options { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 20px; padding: 10px 24px; border-bottom: 1px solid #cbd6e2; background: #fff; }
.report-preview-options-selects { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.report-paper-note { font-size: 11px; color: #8DA1B5; }
/* Pencil tCiL7/fz9a1: franja persistente debajo de las propiedades. */
.report-filters-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 32px; background: #EAF3F6; color: #516f90; font-size: 13px; overflow-wrap: anywhere; }
.report-filters-strip svg { color: #0091ae; flex: none; }
.report-filters-strip strong { color: #213343; font-weight: 700; }
.report-filters-strip-sep { color: #8DA1B5; }
.report-preview-workspace { overflow-x: auto; padding: 28px 24px; }
.report-preview-zoom { width: fit-content; margin: auto; }
.report-preview-message { text-align: center; padding: 64px 24px; color: #516f90; }
@media print {
  .report-preview-toolbar, .report-preview-options, .report-preview-message, .report-filters-strip { display: none !important; }
  .report-preview, .report-preview-workspace { background: white; padding: 0 !important; margin: 0 !important; overflow: visible; min-height: 0; }
  .report-preview-zoom { zoom: 1 !important; margin: 0; }
}
</style>

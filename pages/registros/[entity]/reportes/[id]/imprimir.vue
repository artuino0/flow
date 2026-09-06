<script setup lang="ts">
// ERD-88 #293 (Diseñador de reportes imprimibles): "Vista previa impresión"
// de una PLANTILLA YA GUARDADA - reachable desde el Entry Menu del listado
// (pages/registros/[entity]/index.vue, ERD-88 #290: cada plantilla guardada
// linkea directo acá, no al Diseñador). Mismo componente de hoja
// (PrintReportSheet.vue) que vista-previa.vue, mismo criterio de "nunca se
// congela un resultado" (se reejecuta el dsl guardado en vivo contra
// POST /api/print-reports/preview) - ver el comentario grande en
// server/db/schema.ts junto a la tabla print_reports.
//
// A diferencia de vista-previa.vue, acá SÍ hay un reportId, así que el Print
// Bar suma un botón "Editar" (que faltaba en el mock A0UnX, pensado como la
// vista previa sin guardar del Diseñador) hacia
// pages/registros/[entity]/reportes/[id]/editar.vue - ese archivo ya lo
// documentaba como su punto de entrada real antes de que esta pantalla
// existiera.
import { ArrowLeft, LoaderCircle, Pencil, Printer } from '@lucide/vue'
import { resolveSourceLabel, usePrintReportFieldTree, type PrintReportDsl, type PrintReportResult } from '~/composables/usePrintReports'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const slug = route.params.entity as string
const reportId = route.params.id as string

interface PrintReportRecord {
  id: string
  title: string
  baseEntitySlug: string
  dsl: PrintReportDsl
}

const { data: report, pending: loadingReport, error: reportError } = await useFetch<PrintReportRecord>(`/api/print-reports/${reportId}`, {
  key: `print-report-${reportId}`,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const { data: fieldData } = await usePrintReportFieldTree(slug)
const groupFieldLabels = computed(() => {
  if (!report.value) return []
  const fields = fieldData.value?.fields ?? []
  return report.value.dsl.groupBy.map((source) => resolveSourceLabel(fields, report.value!.dsl.detail, source))
})

const loading = ref(false)
const errorMessage = ref('')
const result = ref<PrintReportResult | null>(null)
const generatedAt = ref(new Date())

async function loadPreview() {
  if (!report.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    result.value = await $fetch<PrintReportResult>('/api/print-reports/preview', { method: 'POST', body: { dsl: report.value.dsl } })
    generatedAt.value = new Date()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || 'No se pudo generar el reporte.'
  } finally {
    loading.value = false
  }
}

watch(report, (r) => { if (r) loadPreview() }, { immediate: true })

function onClose() {
  router.push(`/registros/${slug}`)
}
function onEdit() {
  router.push(`/registros/${slug}/reportes/${reportId}/editar`)
}
function onPrint() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-[#F0F0F0]">
    <div class="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-brand-border-light bg-white px-5 shadow-sm print:hidden">
      <div class="flex items-center gap-1.5">
        <button type="button" class="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="onClose">
          <ArrowLeft class="h-4 w-4" :stroke-width="1.75" />
          Cerrar
        </button>
        <button type="button" class="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="onEdit">
          <Pencil class="h-4 w-4" :stroke-width="1.75" />
          Editar
        </button>
      </div>
      <span class="text-sm font-semibold text-[#33475B]">{{ report?.title || 'Vista previa' }}</span>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-60"
        :disabled="!result"
        @click="onPrint"
      >
        <Printer class="h-4 w-4" :stroke-width="1.75" />
        Imprimir
      </button>
    </div>

    <div class="flex flex-col items-center gap-6 px-6 py-10">
      <div v-if="loadingReport" class="flex items-center gap-2 py-16 text-sm text-brand-text-muted">
        <LoaderCircle class="h-4 w-4 animate-spin" :stroke-width="1.75" />
        Cargando reporte...
      </div>
      <p v-else-if="reportError" class="text-sm text-brand-error-text">No se pudo cargar este reporte.</p>
      <div v-else-if="loading" class="flex items-center gap-2 py-16 text-sm text-brand-text-muted">
        <LoaderCircle class="h-4 w-4 animate-spin" :stroke-width="1.75" />
        Generando vista previa...
      </div>
      <p v-else-if="errorMessage" class="text-sm text-brand-error-text">{{ errorMessage }}</p>
      <PrintReportSheet v-else-if="result" :result="result" :group-field-labels="groupFieldLabels" :generated-at="generatedAt" />
    </div>
  </div>
</template>

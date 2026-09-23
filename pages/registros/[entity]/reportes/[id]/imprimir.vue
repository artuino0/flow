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
// Bar muestra "Editar" solo a administradores y lleva al diseñador.
// Los demás usuarios con permiso de lectura conservan la generación.
import { resolveSourceLabel, usePrintReportFieldTree, type PrintReportDsl, type PrintReportResult } from '~/composables/usePrintReports'
import type { ParameterAnswers } from '~/utils/reportParameters'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const slug = route.params.entity as string
const reportId = route.params.id as string
const { data: isAdmin } = await useIsAdmin()

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
const parameterModal = ref(false)

async function loadPreview(answers?: ParameterAnswers) {
  if (!report.value) return
  parameterModal.value = false
  loading.value = true
  result.value = null
  errorMessage.value = ''
  try {
    result.value = await $fetch<PrintReportResult>('/api/print-reports/preview', { method: 'POST', body: { dsl: report.value.dsl, answers } })
    generatedAt.value = new Date()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || 'No se pudo generar el reporte.'
  } finally {
    loading.value = false
  }
}

watch(report, (r) => { if (r) { if (r.dsl.parameters?.length) parameterModal.value = true; else loadPreview() } }, { immediate: true })

function onClose() {
  router.push(`/registros/${slug}`)
}
function onEdit() {
  router.push(`/registros/${slug}/reportes/${reportId}/editar`)
}
</script>

<template>
  <PrintReportParameterModal v-if="parameterModal && report" :dsl="report.dsl" @cancel="result ? parameterModal = false : onClose()" @generate="loadPreview" />
  <PrintReportPreview :title="report?.title || 'Vista previa'" :result="result" :loading="loadingReport || loading" :error="reportError ? 'No se pudo cargar este reporte.' : errorMessage" :group-field-labels="groupFieldLabels" :generated-at="generatedAt" :initial-layout="report?.dsl.layout" :has-parameters="!!report?.dsl.parameters?.length" :editable="!!isAdmin" @close="onClose" @edit="onEdit" @change-filters="parameterModal = true" />
</template>

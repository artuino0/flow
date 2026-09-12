<script setup lang="ts">
// ERD-88 #293 (Diseñador de reportes imprimibles): "Vista previa impresión"
// para un DSL recién armado en el Diseñador y todavía SIN guardar - llega acá
// por el botón "Vista previa" de PrintReportDesigner.vue, que deja el DSL en
// usePrintReportPreviewDraft() y navega a esta ruta. Fiel a Screen/Vista
// previa impresión (grupos anidados) del .pen (`A0UnX`), revisada con las
// herramientas de Pencil antes de construir esta pantalla (regla
// pencil-antes-de-frontend) - el layout Print Bar + hoja centrada reemplaza
// por completo el chrome normal de la app (sin sidebar/header), por eso
// layout:false en vez de 'default'.
//
// El resultado NUNCA se congela: se pide en vivo a POST /api/print-reports/preview
// con el DSL tal cual quedó en el Diseñador (ver el comentario grande sobre
// esto en server/db/schema.ts, junto a la tabla print_reports).
//
// "Cerrar" (onClose) usa router.back() - vuelve a la MISMA instancia de ruta
// del Diseñador (nuevo.vue o [id]/editar.vue), que se remonta de cero y
// restaura este mismo borrador vía usePrintReportPreviewDraft() (ver el
// comentario grande ahí sobre el bug que esto corrige: "se limpia el reporte
// no se guarda como esta en el momento"). Por eso esta pantalla NO limpia el
// draft al desmontarse - Designer es quien decide cuándo tirarlo (al guardar
// o al descartar explícitamente).
import { resolveSourceLabel, usePrintReportFieldTree, usePrintReportPreviewDraft, type PrintReportResult } from '~/composables/usePrintReports'
import type { PrintLayout } from '~/utils/printLayout'
import type { ParameterAnswers } from '~/utils/reportParameters'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const slug = route.params.entity as string

const draft = usePrintReportPreviewDraft()
const dsl = computed(() => draft.value?.dsl ?? null)

const loading = ref(false)
const errorMessage = ref('')
const result = ref<PrintReportResult | null>(null)
const generatedAt = ref(new Date())
const parameterModal = ref(false)

const { data: fieldData } = await usePrintReportFieldTree(slug)
const groupFieldLabels = computed(() => {
  if (!dsl.value) return []
  const fields = fieldData.value?.fields ?? []
  return dsl.value.groupBy.map((source) => resolveSourceLabel(fields, dsl.value!.detail, source))
})

async function loadPreview(answers?: ParameterAnswers) {
  if (!dsl.value) return
  parameterModal.value = false
  loading.value = true
  errorMessage.value = ''
  try {
    result.value = await $fetch<PrintReportResult>('/api/print-reports/preview', { method: 'POST', body: { dsl: dsl.value, answers } })
    generatedAt.value = new Date()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || 'No se pudo generar la vista previa. Vuelve al diseñador e intenta de nuevo.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { if (dsl.value?.parameters?.length) parameterModal.value = true; else loadPreview() })

function onClose() {
  router.back()
}
function updateLayout(value: PrintLayout) {
  if (draft.value) draft.value.dsl.layout = value
}
</script>

<template>
  <PrintReportParameterModal v-if="parameterModal && dsl" :dsl="dsl" @cancel="result ? parameterModal = false : onClose()" @generate="loadPreview" />
  <PrintReportPreview :title="dsl?.title || 'Vista previa'" :result="result" :loading="loading" :error="!dsl ? 'Vuelve al diseñador para generar una vista previa.' : errorMessage" :group-field-labels="groupFieldLabels" :generated-at="generatedAt" :initial-layout="dsl?.layout" :has-parameters="!!dsl?.parameters?.length" @close="onClose" @layout="updateLayout" @change-filters="parameterModal = true" />
</template>

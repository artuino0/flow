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
import { ArrowLeft, LoaderCircle, Printer } from '@lucide/vue'
import { resolveSourceLabel, usePrintReportFieldTree, usePrintReportPreviewDraft, type PrintReportResult } from '~/composables/usePrintReports'

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

const { data: fieldData } = await usePrintReportFieldTree(slug)
const groupFieldLabels = computed(() => {
  if (!dsl.value) return []
  const fields = fieldData.value?.fields ?? []
  return dsl.value.groupBy.map((source) => resolveSourceLabel(fields, dsl.value!.detail, source))
})

async function loadPreview() {
  if (!dsl.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    result.value = await $fetch<PrintReportResult>('/api/print-reports/preview', { method: 'POST', body: { dsl: dsl.value } })
    generatedAt.value = new Date()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || 'No se pudo generar la vista previa. Volvé al diseñador e intenta de nuevo.'
  } finally {
    loading.value = false
  }
}

onMounted(loadPreview)

function onClose() {
  router.back()
}
function onPrint() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-[#F0F0F0]">
    <div class="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-brand-border-light bg-white px-5 shadow-sm print:hidden">
      <button type="button" class="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="onClose">
        <ArrowLeft class="h-4 w-4" :stroke-width="1.75" />
        Cerrar
      </button>
      <span class="text-sm font-semibold text-[#33475B]">{{ dsl?.title || 'Vista previa' }}</span>
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
      <p v-if="!dsl" class="text-sm text-brand-text-muted">
        No hay datos de vista previa (recargaste la página, o llegaste acá directo). Volvé al diseñador para generar una.
      </p>
      <div v-else-if="loading" class="flex items-center gap-2 py-16 text-sm text-brand-text-muted">
        <LoaderCircle class="h-4 w-4 animate-spin" :stroke-width="1.75" />
        Generando vista previa...
      </div>
      <p v-else-if="errorMessage" class="text-sm text-brand-error-text">{{ errorMessage }}</p>
      <PrintReportSheet v-else-if="result" :result="result" :group-field-labels="groupFieldLabels" :generated-at="generatedAt" />
    </div>
  </div>
</template>

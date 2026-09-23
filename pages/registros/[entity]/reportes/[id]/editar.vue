<script setup lang="ts">
// ERD-88: reabre una plantilla de reporte imprimible guardada en el
// Diseñador de 3 columnas - alcanzable desde el lápiz del listado o desde
// la vista previa. Ambas entradas y la API de guardado exigen administrador.
import type { PrintReportDsl } from '~/composables/usePrintReports'

definePageMeta({ layout: 'default', editorFullscreen: true, fullBleed: true, middleware: 'report-admin' })

const route = useRoute()
const slug = route.params.entity as string
const id = route.params.id as string

interface PrintReportRecord {
  id: string
  title: string
  baseEntitySlug: string
  dsl: PrintReportDsl
}

const { data, pending, error } = await useFetch<PrintReportRecord>(`/api/print-reports/${id}`, {
  key: `print-report-${id}`,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
</script>

<template>
  <p v-if="pending" class="text-sm text-brand-text-muted">Cargando reporte...</p>
  <p v-else-if="error" class="text-sm text-brand-error-text">No se pudo cargar este reporte.</p>
  <PrintReportDesigner v-else-if="data" :entity-slug="slug" :report-id="id" :initial-title="data.title" :initial-dsl="data.dsl" />
</template>

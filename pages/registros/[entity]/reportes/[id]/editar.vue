<script setup lang="ts">
// ERD-88: reabre una plantilla de reporte imprimible guardada en el
// Diseñador de 3 columnas - alcanzable desde el botón "Editar" de Vista
// previa impresión (pages/registros/[entity]/reportes/vista-previa.vue,
// ERD-88 #293), NO desde el Entry Menu del listado (que va directo a
// imprimir - ver el comentario largo en pages/registros/[entity]/index.vue).
import type { PrintReportDsl } from '~/composables/usePrintReports'

definePageMeta({ layout: 'default' })

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

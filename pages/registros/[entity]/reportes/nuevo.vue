<script setup lang="ts">
// ERD-88: "Nuevo reporte" del Entry Menu (pages/registros/[entity]/index.vue)
// - Diseñador de 3 columnas vacío para esta entidad. Toda la lógica real
// vive en components/PrintReportDesigner.vue (compartido con .../[id]/editar.vue).
definePageMeta({ layout: 'default', editorFullscreen: true, fullBleed: true, middleware: 'report-admin' })

const route = useRoute()
const slug = route.params.entity as string
</script>

<template>
  <PrintReportDesigner :entity-slug="slug" />
</template>

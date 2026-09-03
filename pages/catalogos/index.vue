<script setup lang="ts">
// ERD-86: listado de catálogos (entities con moduleKind='dimension'). Mismo
// componente que "Módulos" (components/ModuleListing.vue, pedido directo del
// usuario), solo cambia moduleKind y los textos. Sin mock propio en el .pen
// para "Catálogos" - reusa el diseño real de Screen/Listado Módulos, ver
// comentario largo en components/ModuleWizard.vue.
definePageMeta({ layout: 'default' })
</script>

<template>
  <ModuleListing
    base-path="/catalogos"
    module-kind="dimension"
    section-label="Catálogos"
    noun="catálogo"
    subtitle="Datos de referencia de tu organización (no aparecen en el menú principal)"
    search-placeholder="Buscar catálogo..."
    create-label="Crear catálogo"
    :show-view-records-action="true"
  />
</template>

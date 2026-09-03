<script setup lang="ts">
// ERD-86: asistente "Crear catálogo" - mismo componente que "Crear módulo"
// (components/ModuleWizard.vue), solo cambia moduleKind y los textos. Ver
// comentario largo en server/db/schema.ts (entities.moduleKind).
definePageMeta({ layout: 'default' })
</script>

<template>
  <ModuleWizard
    base-path="/catalogos"
    module-kind="dimension"
    section-label="Catálogos"
    noun="catálogo"
    name-helper-text="Así se mostrará en Administración > Catálogos, no en el menú principal."
  />
</template>

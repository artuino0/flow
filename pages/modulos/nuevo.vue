<script setup lang="ts">
// HU-ERD-70: asistente "Crear módulo". ERD-86: la logica del wizard se
// extrajo a components/ModuleWizard.vue (reusado tal cual por
// pages/catalogos/nuevo.vue) - este archivo solo fija los parametros propios
// de "Módulos" (basePath, moduleKind='hecho', textos).
definePageMeta({ layout: 'default', fullBleed: true })
</script>

<template>
  <ModuleWizard
    edge-header
    base-path="/modulos"
    module-kind="hecho"
    section-label="Módulos"
    noun="módulo"
    name-helper-text="Así se mostrará en el menú lateral y en los listados."
  />
</template>

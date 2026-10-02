<script setup lang="ts">
// HU-ERD-69: listado de modulos (entities) del tenant - solo Administrador.
// Sigue el diseno real de Screen/Listado Módulos en ERPDinamico.pen.
//
// ERD-86: la logica se extrajo a components/ModuleListing.vue (reusado tal
// cual por pages/catalogos/index.vue, pedido directo del usuario) - este
// archivo solo fija los parametros propios de "Módulos" (moduleKind='hecho').
definePageMeta({ darkReady: true, layout: 'default', fullBleed: true })
</script>

<template>
  <ModuleListing
    edge-header
    base-path="/modulos"
    module-kind="hecho"
    section-label="Módulos"
    noun="módulo"
    subtitle="Entidades de negocio personalizadas de tu organización"
    search-placeholder="Buscar módulo..."
    create-label="Crear módulo"
  />
</template>

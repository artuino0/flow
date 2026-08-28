<script setup lang="ts">
// HU-ERD-21: placeholder estatico del menu lateral. HU-ERD-44 lo reemplaza
// por un listado dinamico armado desde GET /api/entities (ERD-43), filtrado
// por lo que el usuario puede leer (canRead por entidad).
const items = [{ label: 'Inicio', to: '/' }]
</script>

<template>
  <nav class="flex flex-col gap-1 p-3">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-primary-50 hover:text-primary-700"
      active-class="bg-primary-100 text-primary-800"
    >
      {{ item.label }}
    </NuxtLink>
  </nav>
</template>

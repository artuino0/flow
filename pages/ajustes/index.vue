<script setup lang="ts">
// Placeholder de "Ajustes" (seccion Administracion del menu) - a pedido del
// usuario, se reserva el lugar en la nav ahora; el alcance real (que se
// configura aca - datos fiscales del tenant de HU-ERD-61, branding, etc.) se
// define como HU aparte. Sin backend propio todavia: no hay nada que
// proteger con un guard de API, la pantalla es estatica.
definePageMeta({ layout: 'default' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <h1 class="text-[22px] font-bold text-brand-text">Ajustes</h1>
    <div class="rounded-lg border border-brand-border-light bg-brand-surface p-6 shadow-[0_1px_3px_0_#33475B14]">
      <p class="text-sm text-brand-text-secondary">Esta seccion todavia no tiene contenido. Proximamente vas a poder configurar aca los datos del tenant.</p>
    </div>
  </div>
</template>

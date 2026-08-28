<script setup lang="ts">
// HU-ERD-21: layout base (header + sidebar + contenido). Las pantallas
// autenticadas (dashboard, listados, formularios dinamicos) se montan
// dentro del <slot />.
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="flex h-14 items-center justify-between border-b border-gray-200 bg-primary-700 px-4 text-white">
      <span class="text-lg font-semibold">ERP Dinamico</span>
      <div class="text-sm text-primary-100">
        <!-- HU-ERD-22: aca va el nombre del usuario autenticado / boton de logout -->
      </div>
    </header>

    <div class="flex flex-1">
      <aside class="hidden w-56 shrink-0 border-r border-gray-200 bg-white sm:block">
        <AppNav />
      </aside>

      <main class="flex-1 bg-gray-50 p-6">
        <slot />
      </main>
    </div>
  </div>
</template>

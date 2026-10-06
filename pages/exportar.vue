<script setup lang="ts">
definePageMeta({ darkReady: true })
const { user } = useAuth()
</script>
<template><main class="mx-auto max-w-3xl p-6 text-brand-text"><h1 class="text-2xl font-semibold">Datos de tu organización</h1><AccountExport v-if="user?.isAdmin" /><p v-else class="mt-4 text-brand-text-secondary">Contacta al administrador para solicitar la exportación de tus datos.</p></main></template>

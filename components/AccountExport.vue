<script setup lang="ts">
const { data, refresh, status, error } = await useFetch<{ exports: Array<{ id: string; status: string; expiresAt: string; url: string | null; error: string | null }> }>('/api/account/export')
const creating = ref(false), message = ref('')
async function create() {
  creating.value = true; message.value = ''
  try { await $fetch('/api/account/export', { method: 'POST' }); await refresh() }
  catch { message.value = 'No se pudo solicitar la exportación. Vuelve a intentarlo.' }
  finally { creating.value = false }
}
</script>
<template>
  <section class="export-section" aria-labelledby="export-title">
    <h2 id="export-title" class="text-lg font-semibold text-brand-text">Exportar tus datos</h2>
    <p class="mt-2 text-brand-text-secondary">Archivo tar.gz con JSON, índice, adjuntos y CFDI. Límite: 100 MiB sin comprimir. El enlace dura 24 horas desde la solicitud y requiere iniciar sesión como administrador.</p>
    <p class="mt-2 text-brand-text-secondary">Si un adjunto supera el espacio disponible o no puede recuperarse, recibirás los registros y el índice con los archivos pendientes. Solicita su recuperación asistida a Flow. Si los datos por sí solos superan el límite, también necesitarás una exportación asistida.</p>
    <div class="mt-4 flex flex-wrap gap-3"><button class="rounded-lg bg-brand-navy px-4 py-2 text-brand-primary-fg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand-blue" :disabled="creating" @click="create">{{ creating ? 'Solicitando…' : 'Generar exportación' }}</button><button class="rounded-lg border border-brand-border px-4 py-2 text-brand-text focus-visible:ring-2 focus-visible:ring-brand-blue" :disabled="status === 'pending'" @click="refresh()">Actualizar estado</button></div>
    <p v-if="error || message" class="mt-3 text-brand-error-text" role="alert">{{ message || 'No se pudo consultar el estado. Pulsa Actualizar estado.' }}</p>
    <ul class="mt-4 space-y-3"><li v-for="item in data?.exports" :key="item.id" class="break-words text-brand-text-secondary"><a v-if="item.url" :href="item.url" class="font-semibold text-brand-navy underline underline-offset-4">Descargar exportación</a><span v-else>{{ item.status === 'pending' ? 'Preparando archivo. Actualiza el estado en unos minutos.' : item.error || 'Enlace caducado. Genera otra exportación.' }}</span></li></ul>
  </section>
</template>
<style scoped>.export-section{margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgb(var(--brand-border));max-width:65ch}</style>

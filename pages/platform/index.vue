<script setup lang="ts">
definePageMeta({ darkReady: true })
type Mail = { provider: string; from: string; status: string; reason?: string; fallbackProvider: string | null; lastSuccess: { provider: string; at: string } | null; lastFailure: { provider: string; at: string; reason: string } | null }
const { data: mail, error, refresh } = await useFetch<Mail>('/api/platform/mail')
const busy = ref(false), message = ref(''), failure = ref('')
async function testMail() {
  if (busy.value) return
  busy.value = true; message.value = ''; failure.value = ''
  try {
    const result = await $fetch<{ provider: string; durationMs: number }>('/api/platform/mail/test', { method: 'POST' })
    message.value = `Correo de prueba aceptado por ${result.provider} en ${result.durationMs} ms.`
    await refresh()
  } catch (cause) { failure.value = (cause as { data?: { statusMessage?: string } })?.data?.statusMessage || 'No se pudo enviar el correo de prueba.' }
  finally { busy.value = false }
}
</script>
<template>
  <main class="mx-auto max-w-3xl space-y-6 px-4 py-8 text-brand-text">
    <nav class="flex flex-wrap gap-6"><NuxtLink to="/platform/accounts" class="text-brand-blue underline underline-offset-4">Ciclo de vida de las cuentas</NuxtLink><NuxtLink to="/platform/plans" class="text-brand-blue underline underline-offset-4">Planes y límites</NuxtLink><NuxtLink to="/" class="text-brand-blue underline underline-offset-4">Volver a Flow</NuxtLink></nav>
    <div class="flex items-center justify-between gap-4"><h1 class="text-2xl font-bold">Correo de plataforma</h1><ThemeSelector /></div>
    <p v-if="error" role="alert" class="text-brand-error-text">No se pudo consultar la configuración o no tienes acceso al panel de plataforma.</p>
    <template v-else-if="mail">
      <dl class="grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl border border-brand-control-border bg-brand-surface p-5 sm:grid-cols-2">
        <dt class="text-brand-text-secondary">Proveedor activo</dt><dd>{{ mail.provider }}</dd>
        <dt class="text-brand-text-secondary">Estado</dt><dd>{{ mail.status === 'ok' ? 'Configurado' : mail.reason }}</dd>
        <dt class="text-brand-text-secondary">Remitente</dt><dd class="break-words">{{ mail.from || 'Sin configurar' }}</dd>
        <dt class="text-brand-text-secondary">Proveedor de respaldo</dt><dd>{{ mail.fallbackProvider || 'Sin configurar' }}</dd>
        <dt class="text-brand-text-secondary">Último envío correcto en este proceso</dt><dd>{{ mail.lastSuccess ? `${mail.lastSuccess.provider} · ${mail.lastSuccess.at}` : 'Sin envíos' }}</dd>
        <dt class="text-brand-text-secondary">Último fallo en este proceso</dt><dd class="break-words">{{ mail.lastFailure ? `${mail.lastFailure.provider} · ${mail.lastFailure.reason}` : 'Sin fallos' }}</dd>
      </dl>
      <p class="text-sm text-brand-text-secondary">La prueba se envía al correo de tu cuenta de administrador de plataforma.</p>
      <button type="button" :disabled="busy" class="rounded bg-brand-orange px-4 py-3 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover focus-visible:outline focus-visible:outline-brand-blue disabled:opacity-50" @click="testMail">{{ busy ? 'Enviando…' : 'Enviar correo de prueba' }}</button>
      <p v-if="message" role="status" class="text-brand-success-text">{{ message }}</p><p v-if="failure" role="alert" class="text-brand-error-text">{{ failure }}</p>
      <p><NuxtLink to="/platform/plans" class="text-brand-blue underline">Administrar planes</NuxtLink></p>
    </template>
  </main>
</template>

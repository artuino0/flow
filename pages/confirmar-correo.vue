<script setup lang="ts">
import { ArrowRight, MailCheck, RefreshCw } from '@lucide/vue'

definePageMeta({ layout: false, darkReady: true })
const { user, fetchMe } = useAuth()
const email = ref('')
const changing = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref('')

async function resend() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    await $fetch('/api/auth/email-verification/resend', { method: 'POST' })
    message.value = 'Enviamos un enlace nuevo. Revisa también la carpeta de spam.'
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'No se pudo reenviar el correo.' }
  finally { busy.value = false }
}

async function changeEmail() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await $fetch<{ email: string }>('/api/auth/email-verification/change-email', { method: 'PUT', body: { email: email.value } })
    await fetchMe()
    changing.value = false
    message.value = `Enviamos el enlace a ${result.email}.`
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'No se pudo cambiar el correo.' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="access-page flex min-h-screen items-center justify-center bg-brand-plan-page-bg px-4 py-12">
    <section class="w-full max-w-lg overflow-hidden rounded-xl border border-brand-control-border bg-brand-surface shadow-xl shadow-brand-overlay/10">
      <div class="bg-brand-plan-interval-bg px-8 py-7 text-brand-tooltip-fg"><p class="text-xs font-bold uppercase tracking-[.18em] text-brand-access-eyebrow">Flow · Paso 4 de 5</p><h1 class="mt-2 text-3xl font-bold">Confirma tu correo</h1></div>
      <div class="space-y-5 px-8 py-8">
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue-bg text-brand-blue"><MailCheck class="h-7 w-7" /></div>
        <p class="text-sm leading-6 text-brand-text-secondary">Enviamos un enlace de un solo uso a <strong class="text-brand-text">{{ user?.email }}</strong>. Vence en 24 horas. Al confirmarlo podrás elegir tu plan y comenzar la prueba de 30 días.</p>
        <p v-if="message" role="status" class="rounded bg-brand-success-bg px-3 py-2 text-sm text-brand-success-text">{{ message }}</p>
        <p v-if="error" role="alert" class="rounded bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">{{ error }}</p>
        <form v-if="changing" class="space-y-3" @submit.prevent="changeEmail">
          <label for="new-email" class="block text-sm font-semibold text-brand-text">Nuevo correo electrónico</label>
          <input id="new-email" v-model="email" type="email" required autocomplete="email" class="w-full rounded border border-brand-control-border px-3 py-2 focus:border-brand-blue focus:outline-none" />
          <div class="flex gap-2"><button type="submit" :disabled="busy" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg disabled:opacity-50">Guardar y enviar</button><button type="button" class="px-3 text-sm text-brand-text-secondary" @click="changing = false">Cancelar</button></div>
        </form>
        <div v-else class="flex flex-wrap gap-3">
          <button type="button" :disabled="busy" class="inline-flex items-center gap-2 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-brand-primary-fg disabled:opacity-50" @click="resend"><RefreshCw class="h-4 w-4" />Reenviar correo</button>
          <button type="button" class="rounded border border-brand-control-border px-4 py-2.5 text-sm font-semibold text-brand-text" @click="email = user?.email || ''; changing = true">Cambiar correo</button>
        </div>
        <p class="border-t border-brand-border-light pt-4 text-xs text-brand-sites-muted">Por seguridad, puedes solicitar un enlace cada minuto y hasta cinco por hora.</p>
      </div>
    </section>
  </main>
</template>

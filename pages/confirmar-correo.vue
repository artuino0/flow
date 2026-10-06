<script setup lang="ts">
import { MailCheck, RefreshCw } from '@lucide/vue'
definePageMeta({ layout: false, darkReady: true })
const { user, fetchMe } = useAuth()
const email = ref(''), code = ref('')
const changing = ref(false), busy = ref(false)
const message = ref(''), error = ref('')
const seconds = ref(0)
let countdown: ReturnType<typeof setInterval> | undefined
let pollElapsed = 0
const { data: delivery, refresh } = await useFetch<{ retryAfter: number; delivery: string; invitationFailures: number }>('/api/auth/email-verification/status')
seconds.value = delivery.value?.retryAfter ?? 0
onMounted(() => { countdown = setInterval(() => {
  if (seconds.value > 0) seconds.value--
  if (++pollElapsed % 5 === 0 && !busy.value) void refresh()
}, 1000) })
onUnmounted(() => { if (countdown) clearInterval(countdown) })
function failure(cause: unknown, fallback: string) { return (cause as { data?: { statusMessage?: string } })?.data?.statusMessage || fallback }
async function confirmCode() {
  if (busy.value || !/^\d{6}$/.test(code.value)) return
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/auth/email-verification/code', { method: 'POST', body: { code: code.value } })
    await fetchMe()
    await navigateTo('/elegir-plan')
  } catch (cause) { error.value = failure(cause, 'No pudimos verificar el código. Intenta de nuevo.') }
  finally { busy.value = false }
}
async function resend() {
  if (busy.value || seconds.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await $fetch('/api/auth/email-verification/resend', { method: 'POST' })
    seconds.value = 60; code.value = ''
    message.value = 'Solicitamos un código nuevo. Revisa también la carpeta de spam.'
    await refresh()
  } catch (cause) { error.value = failure(cause, 'No se pudo solicitar el código. Intenta de nuevo.') }
  finally { busy.value = false }
}
async function changeEmail() {
  if (busy.value || seconds.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await $fetch<{ email: string }>('/api/auth/email-verification/change-email', { method: 'PUT', body: { email: email.value } })
    await fetchMe(); await refresh()
    changing.value = false; seconds.value = 60; code.value = ''
    message.value = `Guardamos ${result.email} y solicitamos un código nuevo.`
  } catch (cause) { error.value = failure(cause, 'No se pudo cambiar el correo.') }
  finally { busy.value = false }
}
</script>

<template>
  <main class="access-page flex min-h-screen items-center justify-center bg-brand-plan-page-bg px-4 py-10">
    <section class="w-full max-w-lg rounded-xl border border-brand-control-border bg-brand-surface px-5 py-7 sm:px-8">
      <div class="mb-6 flex items-center justify-between gap-4"><p class="text-sm text-brand-text-secondary">Paso 4 de 5</p><ThemeSelector /></div>
      <MailCheck class="mb-4 h-9 w-9 text-brand-blue" aria-hidden="true" />
      <h1 class="text-2xl font-bold text-brand-text">Escribe el código que enviamos a tu correo</h1>
      <p class="mt-3 text-sm leading-6 text-brand-text-secondary">Tu organización ya está creada. Confirma <strong class="break-words text-brand-text">{{ user?.email }}</strong> para continuar con el plan elegido. El código vence en 15 minutos.</p>
      <p v-if="delivery?.delivery === 'failed'" role="alert" class="mt-4 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">No pudimos enviar el código; reenvíalo.</p>
      <p v-else-if="delivery?.delivery === 'queued'" role="status" class="mt-4 text-sm text-brand-text-secondary">El envío está pendiente. Si no llega, solicita un código nuevo.</p>
      <p v-if="delivery?.invitationFailures" role="status" class="mt-4 text-sm text-brand-error-text">{{ delivery.invitationFailures }} invitaciones no se pudieron enviar. Podrás reenviarlas desde Usuarios al activar tu organización.</p>
      <p v-if="message" role="status" class="mt-4 rounded bg-brand-success-bg p-3 text-sm text-brand-success-text">{{ message }}</p>
      <p v-if="error" id="verification-error" role="alert" class="mt-4 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ error }}</p>
      <form v-if="!changing" class="mt-6 space-y-4" @submit.prevent="confirmCode">
        <label for="verification-code" class="block text-sm font-semibold text-brand-text">Código de seis dígitos</label>
        <input id="verification-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required :disabled="busy" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'verification-error' : 'code-help'" class="w-full rounded border border-brand-control-border bg-brand-surface px-4 py-3 text-center text-2xl tabular-nums text-brand-text caret-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" />
        <p id="code-help" class="text-xs text-brand-text-secondary">Puedes pegar el código completo. Usa el del último correo recibido.</p>
        <button type="submit" :disabled="busy || !/^\d{6}$/.test(code)" class="w-full rounded bg-brand-orange px-4 py-3 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50">{{ busy ? 'Verificando…' : 'Verificar y continuar' }}</button>
      </form>
      <form v-else class="mt-6 space-y-4" @submit.prevent="changeEmail">
        <label for="new-email" class="block text-sm font-semibold text-brand-text">Nuevo correo electrónico</label>
        <input id="new-email" v-model="email" type="email" required autocomplete="email" class="w-full rounded border border-brand-control-border bg-brand-surface px-3 py-3 text-brand-text focus-visible:outline focus-visible:outline-brand-blue" />
        <div class="flex flex-wrap gap-3"><button type="submit" :disabled="busy || seconds > 0" class="rounded bg-brand-orange px-4 py-3 text-sm font-semibold text-brand-primary-fg disabled:opacity-50">Guardar y enviar</button><button type="button" class="rounded px-3 py-3 text-sm text-brand-text-secondary focus-visible:outline focus-visible:outline-brand-blue" @click="changing = false">Cancelar</button></div>
      </form>
      <div class="mt-5 flex flex-wrap gap-3">
        <button type="button" :disabled="busy || seconds > 0" class="inline-flex items-center gap-2 rounded border border-brand-control-border px-3 py-3 text-sm font-semibold text-brand-text focus-visible:outline focus-visible:outline-brand-blue disabled:opacity-50" @click="resend"><RefreshCw class="h-4 w-4" aria-hidden="true" />{{ seconds > 0 ? `Reenviar en ${seconds} s` : 'Reenviar código' }}</button>
        <button v-if="!changing" type="button" :disabled="busy" class="rounded px-3 py-3 text-sm font-semibold text-brand-blue focus-visible:outline focus-visible:outline-brand-blue disabled:opacity-50" @click="email = user?.email || ''; changing = true">Cambiar correo</button>
      </div>
      <p class="mt-5 border-t border-brand-border-light pt-4 text-xs leading-5 text-brand-text-secondary">Puedes solicitar un código cada minuto y hasta cinco por hora. El enlace de respaldo del correo también permite confirmar tu cuenta.</p>
    </section>
  </main>
</template>

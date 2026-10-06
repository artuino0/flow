<script setup lang="ts">
definePageMeta({ layout: false, darkReady: true })
const { user, fetchMe } = useAuth()
const email = ref(''), code = ref('')
const changing = ref(false), busy = ref(false)
const busyAction = ref<'verify' | 'resend' | 'change-email' | null>(null)
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
  busy.value = true; busyAction.value = 'verify'; error.value = ''
  try {
    await $fetch('/api/auth/email-verification/code', { method: 'POST', body: { code: code.value } })
    await fetchMe()
    await navigateTo('/elegir-plan')
  } catch (cause) { error.value = failure(cause, 'No pudimos verificar el código. Intenta de nuevo.') }
  finally { busy.value = false; busyAction.value = null }
}
async function resend() {
  if (busy.value || seconds.value) return
  busy.value = true; busyAction.value = 'resend'; error.value = ''; message.value = ''
  try {
    await $fetch('/api/auth/email-verification/resend', { method: 'POST' })
    seconds.value = 60; code.value = ''
    message.value = 'Solicitamos un código nuevo. Revisa también la carpeta de spam.'
    await refresh()
  } catch (cause) { error.value = failure(cause, 'No se pudo solicitar el código. Intenta de nuevo.') }
  finally { busy.value = false; busyAction.value = null }
}
async function changeEmail() {
  if (busy.value || seconds.value) return
  busy.value = true; busyAction.value = 'change-email'; error.value = ''; message.value = ''
  try {
    const result = await $fetch<{ email: string }>('/api/auth/email-verification/change-email', { method: 'PUT', body: { email: email.value } })
    await fetchMe(); await refresh()
    changing.value = false; seconds.value = 60; code.value = ''
    message.value = `Guardamos ${result.email} y solicitamos un código nuevo.`
  } catch (cause) { error.value = failure(cause, 'No se pudo cambiar el correo.') }
  finally { busy.value = false; busyAction.value = null }
}
const visualRegistrationSteps = ['Tu cuenta', 'Verifica tu correo', 'Tu organización', 'Invita a tu equipo', 'Listo']
</script>

<template>
  <main class="access-page flex min-h-screen flex-col font-sans lg:flex-row">
    <aside class="access-brand hidden w-[560px] shrink-0 flex-col items-center justify-center gap-5 px-16 text-brand-tooltip-fg lg:flex">
      <div class="flex h-16 w-16 items-center justify-center rounded-[14px] bg-brand-switch-thumb/15"><img src="/brand/isotipo-white.png" alt="Flow" class="h-9 w-9 object-contain" /></div>
      <h1 class="text-[28px] font-bold">Flow</h1>
      <p class="w-[340px] text-center text-[15px] leading-6 text-brand-access-description">Un último paso: confirma que tu correo es tuyo para proteger tu organización.</p>
    </aside>
    <div class="access-brand flex items-center gap-3 rounded-b-[28px] px-5 py-5 text-brand-tooltip-fg lg:hidden">
      <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-switch-thumb/15"><img src="/brand/isotipo-white.png" alt="Flow" class="h-8 w-8 object-contain" /></div>
      <span class="text-xl font-bold">Flow</span>
    </div>
    <section class="flex flex-1 flex-col items-center justify-center gap-5 bg-brand-surface px-4 py-8 sm:px-8">
      <div class="flex w-full max-w-lg justify-end"><ThemeSelector /></div>
      <div class="w-full max-w-lg rounded border border-brand-control-border bg-brand-surface px-5 py-6 sm:px-8">
        <RegistrationStepIndicator :steps="visualRegistrationSteps" :current-step="2" />
        <div class="mt-6">
          <RegistrationOtpStep
            :email="user?.email || ''" :code="code" :new-email="email" :changing="changing" :busy="busy"
            :busy-action="busyAction" :seconds="seconds" :message="message" :error="error"
            :delivery="delivery?.delivery" :invitation-failures="delivery?.invitationFailures || 0"
            @update:code="code = $event" @update:new-email="email = $event"
            @confirm-code="confirmCode" @resend-code="resend"
            @start-email-change="email = user?.email || ''; changing = true"
            @change-email="changeEmail" @cancel-email-change="changing = false"
          />
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref('')
async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/password-reset/request', { method: 'POST', body: { email: email.value } })
    sent.value = true
  } catch (e: any) { error.value = e.data?.statusMessage || 'No se pudo procesar la solicitud.' }
  finally { loading.value = false }
}
</script>

<template>
  <main class="flex min-h-screen font-sans">
    <div class="hidden w-[560px] shrink-0 flex-col justify-center gap-5 bg-[linear-gradient(200deg,#0091AE_0%,#213343_100%)] px-16 lg:flex">
      <div class="flex h-16 w-16 items-center justify-center rounded-[14px] bg-white/15">
        <img src="/brand/isotipo-white.png" alt="Flow" class="h-9 w-9 object-contain" />
      </div>
      <p class="text-[42px] font-bold text-white">Flow</p>
      <p class="w-[340px] text-[15px] text-[#DCEAF0]">Configura entidades, campos y relaciones sin escribir código.</p>
    </div>
    <div class="flex flex-1 items-center justify-center bg-brand-surface px-4">
      <section class="flex w-full max-w-[380px] flex-col gap-5">
        <div>
          <h1 class="text-[26px] font-semibold text-brand-text">Recuperar contraseña</h1>
          <p class="mt-2 text-sm leading-6 text-brand-text-muted">Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.</p>
        </div>
        <p v-if="sent" role="status" class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Si el correo existe, te enviaremos un enlace para restablecer tu contraseña.</p>
        <form v-else class="flex flex-col gap-5" @submit.prevent="submit">
          <div class="flex flex-col gap-2">
            <label for="email" class="text-[13px] font-semibold text-brand-text">Correo electrónico</label>
            <input id="email" v-model="email" type="email" required autocomplete="email" class="rounded border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none" />
          </div>
          <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
          <button :disabled="loading" class="rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{{ loading ? 'Enviando…' : 'Enviar enlace' }}</button>
        </form>
        <NuxtLink to="/login" class="text-center text-[13px] font-semibold text-brand-blue hover:underline">Volver al inicio de sesión</NuxtLink>
      </section>
    </div>
  </main>
</template>

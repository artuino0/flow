<script setup lang="ts">
definePageMeta({ layout: false })
import { PASSWORD_REQUIREMENTS_TEXT } from '~/server/utils/passwordPolicy'
const route = useRoute()
const password = ref('')
const confirmation = ref('')
const loading = ref(false)
const complete = ref(false)
const error = ref('')
const invalidLink = ref(false)
async function submit() {
  error.value = ''
  invalidLink.value = false
  if (password.value !== confirmation.value) { error.value = 'Las contraseñas no coinciden.'; return }
  loading.value = true
  try {
    await $fetch('/api/auth/password-reset/confirm', { method: 'POST', body: { token: route.params.token, password: password.value } })
    complete.value = true
  } catch (e: any) {
    error.value = e.data?.statusMessage || 'No se pudo restablecer la contraseña.'
    invalidLink.value = error.value.includes('El enlace es inválido')
  }
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
          <h1 class="text-[26px] font-semibold text-brand-text">Crear contraseña nueva</h1>
          <p class="mt-2 text-sm leading-6 text-brand-text-muted">Elige una contraseña para volver a entrar a tu cuenta.</p>
        </div>
        <template v-if="complete">
          <p role="status" class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Tu contraseña se restableció. Inicia sesión con la contraseña nueva.</p>
          <NuxtLink to="/login" class="rounded bg-brand-orange px-4 py-2.5 text-center text-sm font-semibold text-white">Ir al inicio de sesión</NuxtLink>
        </template>
        <template v-else>
          <form class="flex flex-col gap-5" @submit.prevent="submit">
            <div class="flex flex-col gap-2">
              <label for="password" class="text-[13px] font-semibold text-brand-text">Contraseña nueva</label>
              <input id="password" v-model="password" type="password" required minlength="8" autocomplete="new-password" aria-describedby="password-help" class="rounded border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none" />
              <p id="password-help" class="text-xs text-brand-text-muted">{{ PASSWORD_REQUIREMENTS_TEXT }}</p>
            </div>
            <div class="flex flex-col gap-2">
              <label for="confirmation" class="text-[13px] font-semibold text-brand-text">Confirmar contraseña</label>
              <input id="confirmation" v-model="confirmation" type="password" required autocomplete="new-password" class="rounded border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none" />
            </div>
            <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
            <button :disabled="loading" class="rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{{ loading ? 'Guardando…' : 'Restablecer contraseña' }}</button>
          </form>
          <NuxtLink v-if="invalidLink" to="/recuperar" class="text-center text-[13px] font-semibold text-brand-blue hover:underline">Solicitar otro enlace</NuxtLink>
        </template>
        <NuxtLink to="/login" class="text-center text-[13px] font-semibold text-brand-blue hover:underline">Volver al inicio de sesión</NuxtLink>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { CircleCheck, CircleAlert } from '@lucide/vue'

definePageMeta({ layout: false })
const route = useRoute()
const { user, fetchMe } = useAuth()
const state = ref<'loading' | 'success' | 'error'>('loading')
const error = ref('')

onMounted(async () => {
  const token = route.query.token
  if (typeof token !== 'string') { state.value = 'error'; error.value = 'El enlace no contiene un token válido.'; return }
  try {
    await $fetch('/api/auth/email-verification/confirm', { method: 'POST', body: { token } })
    if (user.value) await fetchMe()
    state.value = 'success'
  } catch (cause: any) { state.value = 'error'; error.value = cause?.data?.statusMessage || 'No pudimos verificar el correo.' }
})
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#eef1f5] px-4">
    <section class="w-full max-w-md rounded-xl border border-brand-border bg-white px-8 py-10 text-center shadow-xl shadow-[#213343]/10">
      <p class="text-xs font-bold uppercase tracking-[.18em] text-brand-blue">Flow · Verificación</p>
      <div v-if="state === 'loading'" class="mt-6 text-brand-text-secondary">Verificando tu enlace…</div>
      <template v-else-if="state === 'success'"><CircleCheck class="mx-auto mt-6 h-12 w-12 text-brand-success-text" /><h1 class="mt-4 text-2xl font-bold text-brand-text">Correo confirmado</h1><p class="mt-2 text-sm text-brand-text-secondary">Ya puedes elegir un plan y activar tu organización.</p><NuxtLink :to="user ? '/elegir-plan' : '/login?redirect=%2Felegir-plan'" class="mt-6 inline-block rounded bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white">Continuar</NuxtLink></template>
      <template v-else><CircleAlert class="mx-auto mt-6 h-12 w-12 text-brand-error-text" /><h1 class="mt-4 text-2xl font-bold text-brand-text">No se pudo confirmar</h1><p class="mt-2 text-sm text-brand-text-secondary">{{ error }}</p><NuxtLink to="/confirmar-correo" class="mt-6 inline-block rounded bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white">Solicitar otro enlace</NuxtLink></template>
    </section>
  </main>
</template>

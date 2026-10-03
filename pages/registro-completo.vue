<script setup lang="ts">
import { CircleCheck, Clock3 } from '@lucide/vue'

definePageMeta({ layout: false, darkReady: true })
const { user, fetchMe } = useAuth()
const ready = computed(() => user.value?.onboardingStatus === 'complete')
let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => { if (!ready.value) poll = setInterval(() => void fetchMe(), 3000) })
onBeforeUnmount(() => { if (poll) clearInterval(poll) })
</script>

<template>
  <main class="access-page flex min-h-screen items-center justify-center bg-brand-plan-page-bg px-4">
    <section class="w-full max-w-md rounded-xl border border-brand-border bg-brand-surface px-8 py-10 text-center shadow-xl shadow-brand-overlay/10">
      <CircleCheck v-if="ready" class="mx-auto h-14 w-14 text-brand-success-text" /><Clock3 v-else class="mx-auto h-14 w-14 text-brand-blue" />
      <h1 class="mt-5 text-3xl font-bold text-brand-text">{{ ready ? 'Todo listo' : 'Activando tu plan' }}</h1>
      <p class="mt-3 text-sm leading-6 text-brand-text-secondary">{{ ready ? 'Tu prueba comenzó. La organización ya está preparada para trabajar.' : 'Estamos esperando la confirmación segura de Stripe. Esta pantalla se actualizará automáticamente.' }}</p>
      <NuxtLink v-if="ready" to="/" class="mt-7 inline-block rounded bg-brand-orange px-5 py-3 text-sm font-semibold text-brand-primary-fg">Entrar a la aplicación</NuxtLink>
      <NuxtLink v-else to="/elegir-plan" class="mt-7 inline-block text-sm font-semibold text-brand-blue hover:underline">Volver a elegir plan</NuxtLink>
    </section>
  </main>
</template>

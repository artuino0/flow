<script setup lang="ts">
import { ArrowRight, Check, CreditCard } from '@lucide/vue'

definePageMeta({ layout: false, darkReady: true })
type Plan = { code: string; name: string; description: string; monthlyPriceCents: number; annualPriceCents: number; limits: Record<string, number | null>; blockedBy: unknown[] }
const { data, error: loadError } = await useFetch<{ plans: Plan[] }>('/api/billing/plans')
const interval = ref<'month' | 'year'>('month')
const busy = ref('')
const error = ref('')
const canceled = useRoute().query.canceled === '1'
const money = (cents: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100)

async function choose(plan: Plan) {
  error.value = ''; busy.value = plan.code
  try {
    const result = await $fetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { planCode: plan.code, interval: interval.value } })
    window.location.assign(result.url)
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'No se pudo abrir Checkout.'; busy.value = '' }
}
</script>

<template>
  <main class="min-h-screen bg-brand-plan-page-bg px-5 py-12 text-brand-text">
    <div class="mx-auto max-w-6xl">
      <header class="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p class="text-xs font-bold uppercase tracking-[.18em] text-brand-blue">Flow · Paso 5 de 5</p><h1 class="mt-2 text-3xl font-bold md:text-4xl">Elige tu plan</h1><p class="mt-3 max-w-2xl text-sm text-brand-text-secondary">Todos incluyen 30 días gratis. Agrega una tarjeta ahora; el cobro comienza al terminar la prueba. Cancela cuando quieras.</p></div><div class="flex rounded border border-brand-border bg-brand-surface p-1 text-sm"><button type="button" class="rounded px-4 py-2" :class="interval === 'month' ? 'bg-brand-plan-interval-bg text-brand-tooltip-fg' : 'text-brand-text-secondary'" @click="interval = 'month'">Mensual</button><button type="button" class="rounded px-4 py-2" :class="interval === 'year' ? 'bg-brand-plan-interval-bg text-brand-tooltip-fg' : 'text-brand-text-secondary'" @click="interval = 'year'">Anual</button></div></header>
      <p v-if="canceled" role="status" class="mb-5 rounded border border-brand-border bg-brand-surface px-4 py-3 text-sm">No se completó Checkout. Puedes elegir un plan cuando quieras.</p>
      <p v-if="error || loadError" role="alert" class="mb-5 rounded bg-brand-error-bg px-4 py-3 text-sm text-brand-error-text">{{ error || 'No se pudieron cargar los planes.' }}</p>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="plan in data?.plans || []" :key="plan.code" class="flex flex-col rounded-xl border border-brand-border bg-brand-surface p-6 shadow-sm transition-shadow hover:shadow-lg hover:shadow-brand-plan-interval-bg/10">
          <div class="flex items-start justify-between gap-3"><div><h2 class="text-xl font-bold">{{ plan.name }}</h2><p class="mt-1 min-h-10 text-sm text-brand-text-secondary">{{ plan.description }}</p></div><span v-if="plan.code === 'agenda'" class="rounded-full bg-brand-blue-bg px-2.5 py-1 text-[11px] font-bold text-brand-blue">Plantilla incluida</span></div>
          <div class="mt-6 border-t border-brand-border-light pt-5"><p class="text-3xl font-bold">{{ money(interval === 'month' ? plan.monthlyPriceCents : plan.annualPriceCents) }}<span class="ml-1 text-sm font-normal text-brand-sites-muted">/{{ interval === 'month' ? 'mes' : 'año' }}</span></p><p class="mt-2 text-xs font-semibold text-brand-success-text">Primeros 30 días: $0</p></div>
          <ul class="my-6 space-y-2 text-sm text-brand-text-secondary"><li class="flex items-center gap-2"><Check class="h-4 w-4 text-brand-blue" />{{ plan.limits.users ?? 'Usuarios ilimitados' }} usuarios</li><li class="flex items-center gap-2"><Check class="h-4 w-4 text-brand-blue" />{{ plan.limits.modules ?? 'Módulos ilimitados' }} módulos propios</li><li class="flex items-center gap-2"><Check class="h-4 w-4 text-brand-blue" />{{ plan.limits.aiCredits ?? 0 }} créditos de IA al mes</li></ul>
          <button type="button" :disabled="Boolean(busy) || plan.blockedBy.length > 0" class="mt-auto flex items-center justify-center gap-2 rounded bg-brand-orange px-4 py-3 text-sm font-semibold text-brand-primary-fg disabled:cursor-not-allowed disabled:opacity-50" @click="choose(plan)"><CreditCard class="h-4 w-4" />{{ busy === plan.code ? 'Abriendo Checkout…' : 'Comenzar prueba' }}<ArrowRight class="h-4 w-4" /></button>
          <p v-if="plan.blockedBy.length" class="mt-2 text-xs text-brand-error-text">Tu uso actual supera los límites de este plan.</p>
        </article>
      </div>
    </div>
  </main>
</template>

<style scoped>
button:focus-visible { outline: 2px solid rgb(var(--brand-blue)); outline-offset: 2px; }
</style>

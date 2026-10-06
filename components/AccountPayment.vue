<script setup lang="ts">
type Plan = { code: string; name: string; monthlyPriceCents: number; annualPriceCents: number; currency: string; blockedBy: unknown[] }
const { data, error } = await useFetch<{ plans: Plan[] }>('/api/billing/plans')
const planCode = ref(''), interval = ref<'month' | 'year'>('month'), busy = ref(false), message = ref('')
const selected = computed(() => data.value?.plans.find(plan => plan.code === planCode.value))
const amount = computed(() => selected.value ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: selected.value.currency }).format((interval.value === 'year' ? selected.value.annualPriceCents : selected.value.monthlyPriceCents) / 100) : '')
async function checkout() {
  busy.value = true; message.value = ''
  try {
    const result = await $fetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { planCode: planCode.value, interval: interval.value } })
    await navigateTo(result.url, { external: true })
  } catch { message.value = 'No se pudo abrir Checkout. Si el plan no admite tu consumo actual o la suscripción requiere revisión, contacta al equipo de Flow.' }
  finally { busy.value = false }
}
</script>
<template>
  <section class="mt-6 border-t border-brand-border pt-6 text-brand-text" aria-labelledby="payment-title">
    <h2 id="payment-title" class="text-lg font-semibold">Contratar de nuevo</h2><p class="mt-2 leading-relaxed text-brand-text-secondary">Si terminó tu prueba o cancelaste la suscripción, elige un plan y abre Checkout. Para actualizar un método de pago de una suscripción vigente, usa el portal de pago.</p>
    <p v-if="error" class="mt-3 text-brand-error-text" role="alert">No se pudieron cargar los planes. Contacta al equipo de Flow.</p>
    <form v-else class="mt-4" @submit.prevent="checkout">
      <div class="grid gap-4 sm:grid-cols-2"><label>Plan<select v-model="planCode" required><option value="" disabled>Selecciona un plan</option><option v-for="plan in data?.plans" :key="plan.code" :value="plan.code" :disabled="plan.blockedBy.length > 0">{{ plan.name }}{{ plan.blockedBy.length ? ' · Tu consumo supera el límite' : '' }}</option></select></label><label>Periodo<select v-model="interval"><option value="month">Mensual</option><option value="year">Anual</option></select></label></div>
      <p v-if="selected" class="mt-3 font-medium">{{ amount }} / {{ interval === 'year' ? 'año' : 'mes' }}</p>
      <button class="mt-4 rounded-lg bg-brand-navy px-4 py-2 font-semibold text-brand-primary-fg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand-blue" :disabled="busy || !selected || !!selected.blockedBy.length">{{ busy ? 'Abriendo…' : 'Contratar con Checkout' }}</button>
      <p v-if="message" class="mt-3 text-brand-error-text" role="alert">{{ message }}</p>
    </form>
  </section>
</template>
<style scoped>select{display:block;width:100%;margin-top:.5rem;border:1px solid rgb(var(--brand-border));border-radius:.5rem;padding:.65rem .75rem;background:rgb(var(--brand-surface));color:rgb(var(--brand-text))}select:focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:3px}</style>

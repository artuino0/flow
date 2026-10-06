<script setup lang="ts">
definePageMeta({ layout: false, darkReady: true })
const { user, logout, fetchMe } = useAuth()
const account = computed(() => user.value?.accountLifecycle)
const busy = ref(false)
const message = ref('')
const utc = (value?: string | null) => value ? new Date(value).toLocaleDateString('es-MX', { timeZone: 'UTC', dateStyle: 'long' }) + ' (UTC)' : 'Por confirmar'
const reasons: Record<string, string> = { payment_due: 'El pago sigue pendiente.', canceled: 'Terminó el periodo contratado.', trial_ended: 'Terminó el periodo de prueba.', manual: 'La plataforma suspendió esta organización.' }
async function pay() {
  busy.value = true; message.value = ''
  try {
    const result = await $fetch<{ url: string }>('/api/billing/portal', { method: 'POST' })
    await navigateTo(result.url, { external: true })
  } catch { message.value = 'No se pudo abrir el portal de pago. Contacta al equipo de Flow para revisar tu suscripción.' }
  finally { busy.value = false }
}
async function check() { busy.value = true; try { await fetchMe(); if (!['suspended', 'pending_deletion'].includes(account.value?.phase ?? '')) await navigateTo('/') } finally { busy.value = false } }
</script>

<template>
  <main class="account-page">
    <section aria-labelledby="account-title">
      <h1 id="account-title">La cuenta está suspendida</h1>
      <p class="organization">{{ user?.tenantName }}</p>
      <template v-if="user?.isAdmin">
        <p>{{ reasons[account?.reason ?? ''] ?? 'El acceso a esta organización está suspendido.' }} Tus datos se conservan durante el plazo de retención.</p>
        <dl><dt>Fecha prevista de borrado</dt><dd>{{ utc(account?.deleteAt) }}</dd></dl>
        <p>Pagar antes de que empiece el borrado restaura el acceso. Si necesitas ayuda para contratar o reactivar, contacta al equipo de Flow.</p>
        <div class="actions"><button :disabled="busy" @click="pay">Pagar o reactivar</button><button class="secondary" :disabled="busy" @click="check">Ya pagué, comprobar acceso</button></div>
        <p role="status" class="notice">{{ message }}</p>
        <AccountPayment />
        <AccountExport />
      </template>
      <p v-else>Contacta al administrador de tu organización para recuperar el acceso.</p>
      <button class="secondary exit" @click="logout">Cerrar sesión</button>
    </section>
  </main>
</template>

<style scoped>
.account-page{min-height:100dvh;display:grid;place-items:center;padding:clamp(1.25rem,5vw,4rem);background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}
section{width:100%;max-width:42rem}h1{font-size:clamp(1.8rem,4vw,2.5rem);line-height:1.15;font-weight:700;letter-spacing:-.025em;text-wrap:balance}.organization{margin:.75rem 0 2rem;color:rgb(var(--brand-text-secondary))}p{line-height:1.65;margin:1rem 0}dl{padding:1.25rem 0;border-block:1px solid rgb(var(--brand-border));margin:1.5rem 0}dt{color:rgb(var(--brand-text-secondary));font-size:.875rem}dd{margin:.5rem 0 0;font-weight:600}.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem}button{padding:.7rem 1rem;border:1px solid rgb(var(--brand-border));border-radius:.5rem;background:rgb(var(--brand-navy));color:rgb(var(--brand-primary-fg));font-weight:600;cursor:pointer}button:hover{filter:brightness(.95)}button:disabled{opacity:.6;cursor:wait}button:focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:3px}.secondary{background:rgb(var(--brand-surface));color:rgb(var(--brand-text))}.exit{margin-top:2rem}.notice{color:rgb(var(--brand-text-secondary));min-height:1.5rem}
</style>

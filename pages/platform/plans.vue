<script setup lang="ts">
import { PLAN_CONCEPTS } from '~/utils/planConcepts'

type Plan = { id: string; code: string; name: string; isActive: boolean; isPublic: boolean; sortOrder: number; monthlyPriceCents: number; annualPriceCents: number; stripeMonthlyPriceId: string | null; stripeAnnualPriceId: string | null; limits: Record<string, number | null> }
type Organization = { id: string; name: string; slug: string }
type Override = { id: string; tenantId: string; concept: string; value: number | null; reason: string; validFrom: string | null; validUntil: string | null }
const labels: Record<string, string> = { users: 'Usuarios máximos', usersIncluded: 'Usuarios incluidos', modules: 'Módulos personalizados', activeFlows: 'Flujos activos', executions: 'Ejecuciones al mes', emails: 'Correos al mes', storageBytes: 'Almacenamiento (bytes)', stamps: 'Timbres al mes', sites: 'Sitios', pages: 'Páginas', forms: 'Formularios', formSubmissions: 'Envíos de formulario al mes' }
const { data, error, refresh } = await useFetch<{ plans: Plan[]; organizations: Organization[]; overrides: Override[] }>('/api/platform/plans')
const selectedKey = ref('')
const draft = reactive<Record<string, any>>({})
const override = reactive({ tenantId: '', concept: 'users', value: '', reason: '', validFrom: '', validUntil: '' })
const message = ref('')
const planRows = computed(() => data.value?.plans ?? [])
const orgRows = computed(() => data.value?.organizations ?? [])
function loadPlan(key: string) {
  selectedKey.value = key
  const plan = planRows.value.find(row => row.code === key)
  if (!plan) return Object.assign(draft, { code: '', name: '', isActive: true, isPublic: true, sortOrder: 100, monthlyPriceCents: 0, annualPriceCents: 0, stripeMonthlyPriceId: '', stripeAnnualPriceId: '', limits: Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, null])) })
  Object.assign(draft, { ...plan, limits: { ...plan.limits } })
}
watch(planRows, rows => { if (rows.length && !selectedKey.value) loadPlan(rows[0]!.code) }, { immediate: true })
async function savePlan() {
  const newKey = String(draft.code)
  const payload = { ...draft, limits: Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, draft.limits[concept] === '' ? null : draft.limits[concept] === null ? null : Number(draft.limits[concept])])) }
  if (selectedKey.value) await $fetch(`/api/platform/plans/${encodeURIComponent(selectedKey.value)}`, { method: 'PUT', body: payload })
  else await $fetch('/api/platform/plans', { method: 'POST', body: payload })
  message.value = 'Plan guardado.'
  selectedKey.value = newKey
  await refresh()
}
async function saveOverride() {
  await $fetch('/api/platform/overrides', { method: 'PUT', body: { ...override, value: override.value === '' ? null : Number(override.value), validFrom: override.validFrom || null, validUntil: override.validUntil || null } })
  message.value = 'Excepción guardada.'
  override.value = ''
  await refresh()
}
async function removeOverride(row: Override) {
  await $fetch(`/api/platform/overrides/${row.tenantId}/${row.concept}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <main class="mx-auto max-w-5xl space-y-6 p-6 text-brand-text">
    <header><p class="text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Flow · Administración de plataforma</p><h1 class="mt-1 text-2xl font-bold">Planes y límites</h1><p class="mt-1 text-sm text-brand-text-secondary">Los cambios se guardan en la base de datos y se reflejan sin desplegar.</p></header>
    <p v-if="error" class="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">No tienes acceso de administración de plataforma o no se pudo cargar la configuración.</p>
    <template v-else-if="data">
      <section class="space-y-4 rounded-lg border border-brand-border-light bg-white p-5">
        <div class="flex flex-wrap items-end gap-3"><label class="min-w-56 flex-1 text-sm font-semibold">Plan existente<select v-model="selectedKey" class="mt-1 w-full rounded border border-brand-border-light p-2" @change="loadPlan(selectedKey)"><option v-for="plan in planRows" :key="plan.id" :value="plan.code">{{ plan.name }} ({{ plan.code }})</option></select></label><button class="rounded border border-brand-border-light px-4 py-2 text-sm" @click="loadPlan('')">Crear plan</button></div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label class="text-sm">Clave<input v-model="draft.code" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Nombre<input v-model="draft.name" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Orden<input v-model.number="draft.sortOrder" type="number" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Precio mensual informativo (centavos MXN)<input v-model.number="draft.monthlyPriceCents" type="number" min="0" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Precio anual informativo (centavos MXN)<input v-model.number="draft.annualPriceCents" type="number" min="0" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Stripe Price ID mensual<input v-model="draft.stripeMonthlyPriceId" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Stripe Price ID anual<input v-model="draft.stripeAnnualPriceId" class="mt-1 w-full rounded border border-brand-border-light p-2"></label></div>
        <div class="flex gap-5 text-sm"><label><input v-model="draft.isActive" type="checkbox"> Activo</label><label><input v-model="draft.isPublic" type="checkbox"> Visible en planes públicos</label></div>
        <h2 class="border-b border-brand-border-light pb-2 font-semibold">Límites · null significa ilimitado</h2><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label v-for="concept in PLAN_CONCEPTS" :key="concept" class="text-sm">{{ labels[concept] }}<input v-model.number="draft.limits[concept]" type="number" min="0" placeholder="Ilimitado" class="mt-1 w-full rounded border border-brand-border-light p-2"></label></div>
        <div class="flex items-center gap-3"><button class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white" @click="savePlan">Guardar plan</button><span class="text-sm text-brand-text-secondary">{{ message }}</span></div>
      </section>
      <section class="space-y-4 rounded-lg border border-brand-border-light bg-white p-5"><div><h2 class="text-lg font-bold">Excepción por organización</h2><p class="text-sm text-brand-text-secondary">La excepción vigente reemplaza el límite del plan para ese concepto.</p></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label class="text-sm">Organización<select v-model="override.tenantId" class="mt-1 w-full rounded border border-brand-border-light p-2"><option value="">Selecciona…</option><option v-for="org in orgRows" :key="org.id" :value="org.id">{{ org.name }} · {{ org.slug }}</option></select></label><label class="text-sm">Concepto<select v-model="override.concept" class="mt-1 w-full rounded border border-brand-border-light p-2"><option v-for="concept in PLAN_CONCEPTS" :key="concept" :value="concept">{{ labels[concept] }}</option></select></label><label class="text-sm">Valor (vacío = ilimitado)<input v-model="override.value" type="number" min="0" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Válida desde<input v-model="override.validFrom" type="datetime-local" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Válida hasta<input v-model="override.validUntil" type="datetime-local" class="mt-1 w-full rounded border border-brand-border-light p-2"></label><label class="text-sm">Motivo<input v-model="override.reason" class="mt-1 w-full rounded border border-brand-border-light p-2"></label></div><button class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white" @click="saveOverride">Guardar excepción</button>
        <div v-if="data.overrides.length" class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="border-b"><th class="p-2">Organización</th><th class="p-2">Concepto</th><th class="p-2">Valor</th><th class="p-2">Motivo</th><th /></tr></thead><tbody><tr v-for="row in data.overrides" :key="row.id" class="border-b"><td class="p-2">{{ orgRows.find(org => org.id === row.tenantId)?.name || row.tenantId }}</td><td class="p-2">{{ labels[row.concept] || row.concept }}</td><td class="p-2">{{ row.value ?? 'Ilimitado' }}</td><td class="p-2">{{ row.reason }}</td><td class="p-2"><button class="text-red-700 underline" @click="removeOverride(row)">Eliminar</button></td></tr></tbody></table></div>
      </section>
    </template>
  </main>
</template>

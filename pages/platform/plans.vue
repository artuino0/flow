<script setup lang="ts">
import { AlertCircle, BadgeDollarSign, Building2, Check, ChevronRight, CloudOff, Database, FileText, Gauge, Globe, HardDrive, Layers, MessageCircle, Plus, Power, RefreshCw, Save, SlidersHorizontal, Sparkles, Trash2, Undo2, Zap } from '@lucide/vue'
import { PLAN_CONCEPTS } from '~/utils/planConcepts'
import { bytesToGb, dateTimeLocalToIso, formatPlanPrice, normalizeOverrideValue, normalizePlanLimits } from '~/utils/platformPlanForm'

definePageMeta({ fullBleed: true, darkReady: true })

type Plan = { id: string; code: string; name: string; isActive: boolean; isPublic: boolean; sortOrder: number; monthlyPriceCents: number; annualPriceCents: number; stripeMonthlyPriceId: string | null; stripeAnnualPriceId: string | null; limits: Record<string, number | null> }
type Organization = { id: string; name: string; slug: string }
type Override = { id: string; tenantId: string; concept: string; value: number | null; reason: string; validFrom: string | null; validUntil: string | null }
type Draft = Omit<Plan, 'id' | 'limits'> & { limits: Record<string, number | string | null> }

const conceptGroups = [
  { name: 'Core', concepts: ['users', 'usersIncluded', 'modules'], icon: Database },
  { name: 'Automatización', concepts: ['activeFlows', 'executions'], icon: Zap },
  { name: 'IA', concepts: ['aiCredits', 'agentQueries', 'agentUserDaily'], icon: Sparkles },
  { name: 'Comunicaciones', concepts: ['emails'], icon: MessageCircle },
  { name: 'Facturación', concepts: ['stamps'], icon: FileText },
  { name: 'Sites', concepts: ['sites', 'pages', 'forms', 'formSubmissions'], icon: Globe },
  { name: 'Almacenamiento', concepts: ['storageBytes'], icon: HardDrive }
]
const labels: Record<string, string> = { users: 'Usuarios máximos', usersIncluded: 'Usuarios incluidos', modules: 'Módulos personalizados', activeFlows: 'Flujos activos', executions: 'Ejecuciones al mes', aiCredits: 'Créditos de IA al mes', agentQueries: 'Consultas de Chattito al mes', agentUserDaily: 'Consultas de IA por usuario al día', emails: 'Correos al mes', storageBytes: 'Almacenamiento (GB)', stamps: 'Timbres al mes', sites: 'Sitios', pages: 'Páginas', forms: 'Formularios', formSubmissions: 'Envíos de formulario al mes' }
const units: Record<string, string> = { users: 'usuarios', usersIncluded: 'usuarios', modules: 'módulos', activeFlows: 'flujos', executions: 'ejecuciones', aiCredits: 'créditos', agentQueries: 'consultas', agentUserDaily: 'consultas', emails: 'correos', storageBytes: 'GB', stamps: 'timbres', sites: 'sitios', pages: 'páginas', forms: 'formularios', formSubmissions: 'envíos' }
const { data, error, status, refresh } = await useFetch<{ plans: Plan[]; organizations: Organization[]; overrides: Override[] }>('/api/platform/plans')
const { confirm: confirmAction } = useConfirm()
const planRows = computed(() => data.value?.plans ?? [])
const orgRows = computed(() => data.value?.organizations ?? [])
const selectedKey = ref('')
const creating = ref(false)
const draft = reactive<Draft>(emptyDraft())
const savedSnapshot = ref('')
const activeSection = ref('general')
const editingCode = ref(false)
const override = reactive({ tenantId: '', concept: 'users', value: '', reason: '', validFrom: '', validUntil: '', unlimited: false })
const saving = ref(false)
const overrideSaving = ref(false)
const showOverrideForm = ref(false)
const actionError = ref('')
const overrideError = ref('')
const toast = ref('')
const showTechnicalDetail = ref(false)
const selectedPlan = computed(() => planRows.value.find(row => row.code === selectedKey.value))
const hasEditor = computed(() => creating.value || !!selectedPlan.value)
const isDirty = computed(() => hasEditor.value && JSON.stringify(draft) !== savedSnapshot.value)
const isLoading = computed(() => status.value === 'pending' && !data.value)
const loadError = computed(() => !!error.value && !data.value)

function emptyDraft(): Draft {
  return { code: '', name: '', isActive: true, isPublic: true, sortOrder: 100, monthlyPriceCents: 0, annualPriceCents: 0, stripeMonthlyPriceId: '', stripeAnnualPriceId: '', limits: Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, null])) }
}

function loadPlan(key: string) {
  const plan = planRows.value.find(row => row.code === key)
  selectedKey.value = plan?.code || ''
  creating.value = !plan
  Object.assign(draft, plan ? { ...plan, limits: { ...plan.limits } } : emptyDraft())
  if (plan && plan.limits.storageBytes != null) draft.limits.storageBytes = bytesToGb(plan.limits.storageBytes)
  savedSnapshot.value = JSON.stringify(draft)
  actionError.value = ''
  activeSection.value = 'general'
  editingCode.value = false
}

watch(planRows, rows => { if (rows.length && !selectedKey.value && !creating.value) loadPlan(rows[0]!.code) }, { immediate: true })

async function selectPlan(key: string) {
  if (key && key === selectedKey.value && !creating.value) return
  if (isDirty.value && !await confirmAction({ title: 'Cambios sin guardar', message: 'Los cambios de este plan se perderán al cambiar de plan.', confirmLabel: 'Descartar cambios' })) return
  loadPlan(key)
}

function isLimitModified(concept: string) {
  if (!selectedPlan.value) return false
  const saved = selectedPlan.value.limits[concept]
  return draft.limits[concept] !== (concept === 'storageBytes' && saved != null ? bytesToGb(saved) : saved)
}

function formatOverrideValue(row: Override) {
  if (row.value == null) return 'Ilimitado'
  return row.concept === 'storageBytes' ? bytesToGb(row.value) : row.value
}

function payload(source: Draft | Plan) {
  return { code: source.code, name: source.name, isActive: source.isActive, isPublic: source.isPublic, sortOrder: Number(source.sortOrder), monthlyPriceCents: Number(source.monthlyPriceCents), annualPriceCents: Number(source.annualPriceCents), stripeMonthlyPriceId: source.stripeMonthlyPriceId, stripeAnnualPriceId: source.stripeAnnualPriceId, limits: normalizePlanLimits(source.limits) }
}

function errorText(cause: unknown, fallback: string) {
  const response = cause as { data?: { message?: string }; message?: string }
  return response?.data?.message || response?.message || fallback
}

async function savePlan() {
  actionError.value = ''
  if (!/^[a-z0-9_-]{2,48}$/.test(draft.code) || draft.name.trim().length < 2) {
    actionError.value = 'Escribe un nombre y una clave válida (2 a 48 caracteres, minúsculas, números, _ o -).'
    return
  }
  if (!Number.isInteger(draft.monthlyPriceCents) || draft.monthlyPriceCents < 0 || !Number.isInteger(draft.annualPriceCents) || draft.annualPriceCents < 0) {
    actionError.value = 'Los precios deben ser importes válidos mayores o iguales a cero.'
    return
  }
  saving.value = true
  const wasExisting = !!selectedKey.value
  const newKey = draft.code
  const newName = draft.name
  try {
    if (wasExisting) await $fetch(`/api/platform/plans/${encodeURIComponent(selectedKey.value)}`, { method: 'PUT', body: payload(draft) })
    else await $fetch('/api/platform/plans', { method: 'POST', body: payload(draft) })
    selectedKey.value = newKey
    creating.value = false
    savedSnapshot.value = JSON.stringify(draft)
    await refresh()
    toast.value = `Plan ${newName} ${wasExisting ? 'actualizado' : 'guardado'}.`
  } catch (cause) {
    actionError.value = errorText(cause, 'No se pudo guardar el plan.')
  } finally {
    saving.value = false
  }
}

async function deactivatePlan() {
  const plan = selectedPlan.value
  if (!plan || !plan.isActive || saving.value) return
  const discarded = isDirty.value ? ' Los cambios sin guardar se descartarán.' : ''
  if (!await confirmAction({ title: `¿Desactivar el plan ${plan.name}?`, message: `Dejará de estar disponible para nuevas contrataciones. Las organizaciones que ya lo usan conservarán su configuración. Podrás volver a activarlo.${discarded}`, confirmLabel: 'Desactivar plan', destructive: true })) return
  saving.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/platform/plans/${encodeURIComponent(plan.code)}`, { method: 'PUT', body: { ...payload({ ...plan, limits: { ...plan.limits, storageBytes: bytesToGb(plan.limits.storageBytes) } }), isActive: false } })
    await refresh()
    loadPlan(plan.code)
    toast.value = `Plan ${plan.name} desactivado.`
  } catch (cause) {
    actionError.value = errorText(cause, 'No se pudo desactivar el plan.')
  } finally {
    saving.value = false
  }
}

async function toggleActive() {
  if (selectedPlan.value?.isActive && draft.isActive) await deactivatePlan()
  else draft.isActive = !draft.isActive
}

async function saveOverride() {
  overrideError.value = ''
  if (!override.tenantId || !override.concept || override.reason.trim().length < 5 || (!override.unlimited && override.value !== '' && !(Number(override.value) >= 0 && (override.concept === 'storageBytes' ? Number.isFinite(Number(override.value)) : Number.isInteger(Number(override.value)))))) {
    overrideError.value = 'Selecciona organización y concepto, indica un valor válido o deja el campo vacío para ilimitado, y escribe un motivo de al menos 5 caracteres.'
    return
  }
  overrideSaving.value = true
  try {
    await $fetch('/api/platform/overrides', { method: 'PUT', body: { tenantId: override.tenantId, concept: override.concept, value: normalizeOverrideValue(override.value, override.unlimited, override.concept), reason: override.reason, validFrom: dateTimeLocalToIso(override.validFrom), validUntil: dateTimeLocalToIso(override.validUntil) } })
    Object.assign(override, { tenantId: '', concept: 'users', value: '', reason: '', validFrom: '', validUntil: '', unlimited: false })
    await refresh()
    toast.value = 'Excepción guardada.'
  } catch (cause) {
    overrideError.value = errorText(cause, 'No se pudo guardar la excepción.')
  } finally {
    overrideSaving.value = false
  }
}

async function removeOverride(row: Override) {
  overrideError.value = ''
  try {
    await $fetch(`/api/platform/overrides/${row.tenantId}/${row.concept}`, { method: 'DELETE' })
    await refresh()
    toast.value = 'Excepción eliminada.'
  } catch (cause) {
    overrideError.value = errorText(cause, 'No se pudo eliminar la excepción.')
  }
}

function goToSection(id: string) {
  activeSection.value = id
  document.getElementById(`plans-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) : 'Sin vencimiento'
}
</script>

<template>
  <main class="h-full overflow-y-auto bg-brand-bg text-brand-text">
    <header class="flex flex-wrap items-center justify-between gap-4 border-b border-brand-border-light bg-brand-surface px-5 py-5 sm:px-7">
      <div>
        <p class="text-[11px] font-semibold text-brand-text-muted">Plataforma <span class="mx-1">›</span> Planes y límites</p>
        <h1 class="mt-1 text-xl font-bold">Planes y límites</h1>
        <p class="mt-1 text-[13px] text-brand-text-secondary">Define precios, límites y excepciones por organización.</p>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="inline-flex items-center gap-1.5 rounded border border-brand-border px-3 py-2 text-[13px] font-semibold hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" @click="refresh()"><RefreshCw class="h-4 w-4" />Actualizar</button>
        <button type="button" class="inline-flex items-center gap-1.5 rounded bg-brand-orange px-3 py-2 text-[13px] font-semibold text-brand-primary-fg hover:bg-brand-orange-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" @click="selectPlan('')"><Plus class="h-4 w-4" />Nuevo plan</button>
      </div>
    </header>

    <div v-if="toast" role="status" class="fixed right-5 top-20 z-40 flex max-w-sm items-start gap-2 rounded-lg border border-brand-border-light bg-brand-surface p-3 text-sm shadow-lg">
      <span class="rounded-full bg-brand-success-bg p-1 text-brand-success-text"><Check class="h-3.5 w-3.5" /></span>
      <div><strong>{{ toast }}</strong><p class="text-xs text-brand-text-secondary">La configuración actualizada ya está disponible.</p></div>
      <button type="button" class="ml-auto text-brand-text-muted" aria-label="Cerrar notificación" @click="toast = ''">×</button>
    </div>

    <div v-if="isLoading" class="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]" aria-label="Cargando planes">
      <div class="space-y-3 rounded-lg border border-brand-border-light bg-brand-surface p-4">
        <div v-for="index in 5" :key="index" class="animate-pulse space-y-3 border-b border-brand-border-light py-3"><div class="h-3 w-1/3 rounded bg-brand-neutral-bg" /><div class="h-5 w-2/3 rounded bg-brand-neutral-bg" /><div class="h-3 w-1/2 rounded bg-brand-neutral-bg" /></div>
      </div>
      <div class="space-y-4"><div v-for="index in 3" :key="index" class="animate-pulse rounded-lg border border-brand-border-light bg-brand-surface p-6"><div class="mb-5 h-4 w-1/4 rounded bg-brand-neutral-bg" /><div class="h-10 rounded bg-brand-neutral-bg" /></div></div>
      <p class="col-span-full text-center text-xs text-brand-text-muted">Cargando planes y límites…</p>
    </div>

    <div v-else-if="loadError" class="space-y-5 p-5 sm:p-7">
      <div class="flex gap-3 rounded-lg bg-brand-error-bg p-4 text-brand-error-text"><AlertCircle class="mt-0.5 h-5 w-5 shrink-0" /><div><h2 class="text-sm font-bold">No se pudieron cargar los planes</h2><p class="mt-1 text-[13px]">Revisa la conexión y vuelve a intentarlo.</p><div class="mt-3 flex flex-wrap gap-2"><button type="button" class="rounded bg-brand-error-text px-3 py-1.5 text-xs font-semibold text-brand-primary-fg" @click="refresh()">Reintentar</button><button type="button" class="rounded border border-brand-error-text px-3 py-1.5 text-xs font-semibold" @click="showTechnicalDetail = !showTechnicalDetail">{{ showTechnicalDetail ? 'Ocultar' : 'Ver' }} detalle técnico</button></div><p v-if="showTechnicalDetail" class="mt-3 break-all text-xs">{{ error?.message }}</p></div></div>
      <div class="flex min-h-56 flex-col items-center justify-center gap-2 rounded-lg border border-brand-border-light bg-brand-surface text-center"><CloudOff class="h-8 w-8 text-brand-error-text" /><h2 class="text-sm font-bold">No hay datos para mostrar</h2><p class="text-[13px] text-brand-text-secondary">Reintenta la carga para ver y editar los planes.</p></div>
    </div>

    <template v-else-if="data">
      <div v-if="error" class="mx-5 mt-5 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text sm:mx-7">No se pudo actualizar la información. Los cambios locales siguen en pantalla. <button type="button" class="font-semibold underline" @click="refresh()">Reintentar</button></div>
      <div class="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <section class="h-fit overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface" aria-label="Lista de planes">
          <div class="flex items-center justify-between border-b border-brand-border-light px-4 py-3.5"><h2 class="text-sm font-bold">Planes <span class="ml-1 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs text-brand-text-secondary">{{ planRows.length }}</span></h2><span class="text-[11px] text-brand-text-muted">Precios en MXN</span></div>
          <template v-if="planRows.length">
            <button v-for="plan in planRows" :key="plan.id" type="button" class="block w-full border-b border-brand-border-light px-4 py-3.5 text-left last:border-b-0 hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue" :class="selectedKey === plan.code && !creating ? 'border-l-[3px] border-l-brand-blue bg-brand-sidebar-active-bg pl-[13px]' : ''" @click="selectPlan(plan.code)">
              <span class="flex items-center justify-between gap-2"><span class="flex min-w-0 items-center gap-2"><strong class="truncate text-[15px]">{{ plan.name }}</strong><code class="rounded bg-brand-bg px-1.5 py-0.5 text-[10px] text-brand-text-secondary">{{ plan.code }}</code></span><ChevronRight class="h-4 w-4 shrink-0 text-brand-text-muted" /></span>
              <span class="mt-2.5 flex gap-6"><span><span class="block text-[10px] font-bold text-brand-text-muted">MENSUAL</span><strong>{{ formatPlanPrice(plan.monthlyPriceCents) }}</strong><small class="ml-1 text-brand-text-muted">/mes</small></span><span><span class="block text-[10px] font-bold text-brand-text-muted">ANUAL</span><strong>{{ formatPlanPrice(plan.annualPriceCents) }}</strong><small class="ml-1 text-brand-text-muted">/año</small></span></span>
              <span class="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold"><span class="rounded-full px-2 py-0.5" :class="plan.isActive ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-neutral-bg text-brand-neutral-text'">{{ plan.isActive ? 'Activo' : 'Inactivo' }}</span><span v-if="plan.isPublic" class="rounded-full bg-brand-info-bg px-2 py-0.5 text-brand-info-text">Público</span><span class="ml-auto text-brand-text-muted">{{ plan.stripeMonthlyPriceId || plan.stripeAnnualPriceId ? 'Price IDs capturados' : 'Sin Price IDs' }}</span></span>
            </button>
          </template>
          <div v-else class="flex flex-col items-center gap-3 px-6 py-10 text-center"><Layers class="h-10 w-10 text-brand-blue" /><h2 class="text-base font-bold">Todavía no hay planes</h2><p class="text-[13px] text-brand-text-secondary">Crea el primer plan para definir precios y límites.</p><button type="button" class="rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-brand-primary-fg" @click="selectPlan('')">Crear primer plan</button></div>
        </section>

        <div v-if="hasEditor" class="min-w-0 space-y-4">
          <section class="overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
            <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div class="flex min-w-0 items-center gap-3"><span class="rounded-lg bg-brand-blue-bg p-2 text-brand-blue"><Layers class="h-5 w-5" /></span><div><div class="flex flex-wrap items-center gap-2"><h2 class="text-lg font-bold">{{ draft.name || 'Nuevo plan' }}</h2><span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="draft.isActive ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-neutral-bg text-brand-neutral-text'">{{ draft.isActive ? 'Activo' : 'Inactivo' }}</span><span v-if="draft.isPublic" class="rounded-full bg-brand-info-bg px-2 py-0.5 text-[11px] font-semibold text-brand-info-text">Público</span><span v-if="isDirty" class="rounded-full bg-brand-warning-bg px-2 py-0.5 text-[11px] font-semibold text-brand-warning-text">Sin guardar</span></div><p class="text-xs text-brand-text-secondary">Clave {{ draft.code || 'pendiente' }}</p></div></div><button v-if="selectedPlan?.isActive" type="button" class="inline-flex items-center gap-1.5 rounded border border-brand-error-text px-3 py-2 text-xs font-semibold text-brand-error-text hover:bg-brand-error-bg" @click="deactivatePlan"><Power class="h-3.5 w-3.5" />Desactivar plan</button></div>
            <nav class="flex gap-5 overflow-x-auto border-t border-brand-border-light px-5 pt-2" aria-label="Secciones del plan"><button v-for="section in [{ id: 'general', label: 'General' }, { id: 'prices', label: 'Precios' }, { id: 'limits', label: 'Límites' }, { id: 'exceptions', label: 'Excepciones' }]" :key="section.id" type="button" class="whitespace-nowrap border-b-2 px-1 pb-2 text-xs font-semibold" :class="activeSection === section.id ? 'border-brand-blue text-brand-blue' : 'border-transparent text-brand-text-secondary hover:text-brand-text'" @click="goToSection(section.id)">{{ section.label }}</button></nav>
          </section>
          <section id="plans-general" class="scroll-mt-5 overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
            <div class="flex items-center gap-2 border-b border-brand-border-light px-5 py-4"><SlidersHorizontal class="h-4 w-4 text-brand-blue" /><h3 class="text-sm font-bold">General</h3></div>
            <div class="grid gap-5 p-5 sm:grid-cols-2">
              <label class="block text-[13px] font-semibold">Nombre del plan<input v-model="draft.name" maxlength="100" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-normal focus:border-brand-blue focus:outline-none" /><small class="mt-1 block font-normal text-brand-text-muted">Se muestra a los clientes en la página de planes.</small></label>
              <label class="block text-[13px] font-semibold">Clave<input v-model="draft.code" :readonly="!!selectedPlan && !editingCode" maxlength="48" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-mono font-normal focus:border-brand-blue focus:outline-none read-only:bg-brand-bg read-only:text-brand-text-secondary" /><small class="mt-1 block font-normal text-brand-text-muted">{{ selectedPlan && !editingCode ? 'Se usa en la API y en Stripe.' : 'Minúsculas, números, guion y guion bajo.' }} <button v-if="selectedPlan && !editingCode" type="button" class="font-semibold text-brand-blue underline" @click.prevent="editingCode = true">Editar clave</button></small></label>
              <label class="block text-[13px] font-semibold">Orden<input v-model.number="draft.sortOrder" type="number" step="1" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-normal focus:border-brand-blue focus:outline-none" /><small class="mt-1 block font-normal text-brand-text-muted">Posición en la lista pública.</small></label>
              <div class="space-y-2">
                <label class="flex items-center justify-between gap-3 rounded bg-brand-bg px-3 py-2.5"><span><strong class="block text-[13px]">Público</strong><small class="text-brand-text-secondary">Visible en planes públicos</small></span><input v-model="draft.isPublic" type="checkbox" role="switch" class="h-4 w-4 accent-brand-blue" /></label>
                <label class="flex items-center justify-between gap-3 rounded bg-brand-bg px-3 py-2.5"><span><strong class="block text-[13px]">Activo</strong><small class="text-brand-text-secondary">Disponible para nuevas contrataciones</small></span><input :checked="draft.isActive" type="checkbox" role="switch" class="h-4 w-4 accent-brand-blue" @click.prevent="toggleActive" /></label>
              </div>
            </div>
          </section>

          <section id="plans-prices" class="scroll-mt-5 overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
            <div class="flex items-center gap-2 border-b border-brand-border-light px-5 py-4"><BadgeDollarSign class="h-4 w-4 text-brand-blue" /><div><h3 class="text-sm font-bold">Precios</h3><p class="text-xs text-brand-text-secondary">Importes informativos en MXN y referencias de Stripe.</p></div></div>
            <div class="grid gap-6 p-5 sm:grid-cols-2">
              <div class="space-y-4"><h4 class="text-[11px] font-bold tracking-wide text-brand-text-muted">MENSUAL</h4><label class="block text-[13px] font-semibold">Precio mensual <span class="font-normal text-brand-text-muted">MXN</span><CurrencyInput :model-value="draft.monthlyPriceCents" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-normal focus:border-brand-blue focus:outline-none" @update:model-value="draft.monthlyPriceCents = $event ?? 0" /></label><label class="block text-[13px] font-semibold">Stripe Price ID mensual<input v-model="draft.stripeMonthlyPriceId" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-mono text-xs font-normal focus:border-brand-blue focus:outline-none" placeholder="price_..." /></label></div>
              <div class="space-y-4"><h4 class="text-[11px] font-bold tracking-wide text-brand-text-muted">ANUAL</h4><label class="block text-[13px] font-semibold">Precio anual <span class="font-normal text-brand-text-muted">MXN</span><CurrencyInput :model-value="draft.annualPriceCents" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-normal focus:border-brand-blue focus:outline-none" @update:model-value="draft.annualPriceCents = $event ?? 0" /></label><label class="block text-[13px] font-semibold">Stripe Price ID anual<input v-model="draft.stripeAnnualPriceId" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 font-mono text-xs font-normal focus:border-brand-blue focus:outline-none" placeholder="price_..." /></label></div>
            </div>
            <p class="mx-5 mb-5 rounded bg-brand-info-bg px-3 py-2 text-xs font-semibold text-brand-info-text">{{ [draft.stripeMonthlyPriceId, draft.stripeAnnualPriceId].filter(Boolean).length }} de 2 Price IDs capturados. La conexión con Stripe no se verifica aquí.</p>
          </section>

          <section id="plans-limits" class="scroll-mt-5 overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
            <div class="flex items-center gap-2 border-b border-brand-border-light px-5 py-4"><Gauge class="h-4 w-4 text-brand-blue" /><div><h3 class="text-sm font-bold">Límites</h3><p class="text-xs text-brand-text-secondary">Vacío o ilimitado = sin límite para ese concepto.</p></div></div>
            <div class="overflow-x-auto"><div class="min-w-[560px]">
              <div class="grid grid-cols-[minmax(160px,1fr)_120px_90px_90px] gap-3 border-b border-brand-border-light bg-brand-bg px-5 py-2 text-[10px] font-bold tracking-wide text-brand-text-secondary"><span>CONCEPTO</span><span>VALOR</span><span>UNIDAD</span><span>ILIMITADO</span></div>
              <template v-for="group in conceptGroups" :key="group.name"><h4 class="flex items-center gap-1.5 bg-brand-surface px-5 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-brand-blue"><component :is="group.icon" class="h-4 w-4" />{{ group.name }}</h4>
                <div v-for="concept in group.concepts" :key="concept" class="grid grid-cols-[minmax(160px,1fr)_120px_90px_90px] items-center gap-3 border-b border-brand-border-light px-5 py-2.5 last:border-b-0" :class="isLimitModified(concept) ? 'bg-brand-info-bg' : ''">
                  <div><label :for="`limit-${concept}`" class="text-[13px] font-semibold">{{ labels[concept] }}</label><small v-if="isLimitModified(concept)" class="block text-[11px] text-brand-blue">Modificado</small></div>
                  <input :id="`limit-${concept}`" v-model.number="draft.limits[concept]" type="number" min="0" :step="concept === 'storageBytes' ? 'any' : '1'" :disabled="draft.limits[concept] === null" placeholder="Ilimitado" class="min-w-0 rounded border border-brand-border px-2 py-1.5 text-right text-[13px] focus:border-brand-blue focus:outline-none disabled:bg-brand-bg disabled:text-brand-text-muted" />
                  <span class="text-xs text-brand-text-secondary">{{ units[concept] }}</span>
                  <label class="flex items-center gap-1.5 text-xs text-brand-text-secondary"><input type="checkbox" :checked="draft.limits[concept] === null" class="h-4 w-4 accent-brand-blue" @change="draft.limits[concept] = draft.limits[concept] === null ? 0 : null" />{{ draft.limits[concept] === null ? 'Sí' : 'No' }}</label>
                </div>
              </template>
            </div></div>
          </section>
        </div>
        <div v-else class="flex min-h-[340px] flex-col items-center justify-center gap-2 rounded-lg border border-brand-border-light bg-brand-surface px-5 text-center"><Layers class="h-9 w-9 text-brand-text-muted" /><h2 class="text-sm font-bold">Selecciona un plan para editarlo</h2><p class="text-[13px] text-brand-text-secondary">Verás sus datos generales, precios de Stripe y límites por concepto.</p></div>
      </div>
      <section id="plans-exceptions" class="scroll-mt-5 px-5 pb-7 sm:px-7" aria-label="Excepciones por organización">
        <div class="overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
          <div class="flex items-center gap-2 border-b border-brand-border-light px-5 py-4"><Building2 class="h-4 w-4 text-brand-blue" /><h2 class="text-sm font-bold">Excepciones por organización</h2></div>
          <div v-if="planRows.length || showOverrideForm" class="border-b border-brand-border-light bg-brand-bg p-5">
            <h3 class="mb-3 text-[11px] font-bold tracking-wide text-brand-text-muted">NUEVA EXCEPCIÓN</h3>
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_220px_150px_100px]">
              <label class="text-xs font-semibold">Organización <span class="text-brand-error-text">*</span><select v-model="override.tenantId" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-[13px] font-normal"><option value="">Selecciona una organización</option><option v-for="org in orgRows" :key="org.id" :value="org.id">{{ org.name }} · {{ org.slug }}</option></select></label>
              <label class="text-xs font-semibold">Concepto <span class="text-brand-error-text">*</span><select v-model="override.concept" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-[13px] font-normal"><option v-for="concept in PLAN_CONCEPTS" :key="concept" :value="concept">{{ labels[concept] }}</option></select></label>
              <label class="text-xs font-semibold">Valor <span class="font-normal text-brand-text-muted">{{ override.concept === 'storageBytes' ? 'GB · vacío = ilimitado' : 'vacío = ilimitado' }}</span><input v-model="override.value" type="number" min="0" :step="override.concept === 'storageBytes' ? 'any' : '1'" :disabled="override.unlimited" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-[13px] font-normal disabled:bg-brand-neutral-bg" /></label>
              <label class="text-xs font-semibold">Ilimitado<span class="mt-3 flex items-center gap-2 font-normal"><input v-model="override.unlimited" type="checkbox" class="h-4 w-4 accent-brand-blue" />{{ override.unlimited ? 'Sí' : 'No' }}</span></label>
            </div>
            <div class="mt-4 grid items-end gap-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_200px_200px_auto]">
              <label class="text-xs font-semibold">Motivo <span class="text-brand-error-text">*</span><input v-model="override.reason" maxlength="500" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-[13px] font-normal" placeholder="Ej. Acuerdo comercial" /></label>
              <label class="text-xs font-semibold">Válida desde <span class="font-normal text-brand-text-muted">opcional</span><input v-model="override.validFrom" type="datetime-local" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-[13px] font-normal" /></label>
              <label class="text-xs font-semibold">Válida hasta <span class="font-normal text-brand-text-muted">opcional</span><input v-model="override.validUntil" type="datetime-local" class="mt-1.5 w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-[13px] font-normal" /></label>
              <button type="button" :disabled="overrideSaving" class="inline-flex items-center justify-center gap-1.5 rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-xs font-semibold hover:bg-brand-surface disabled:opacity-50" @click="saveOverride"><Plus class="h-4 w-4" />Agregar excepción</button>
            </div>
            <p v-if="overrideError" role="alert" class="mt-3 text-xs text-brand-error-text">{{ overrideError }}</p>
          </div>
          <div v-if="data.overrides.length" class="overflow-x-auto">
            <table class="w-full min-w-[780px] text-left text-[13px]"><thead class="bg-brand-bg text-[10px] font-bold tracking-wide text-brand-text-secondary"><tr><th class="px-5 py-3">ORGANIZACIÓN</th><th class="px-4 py-3">CONCEPTO</th><th class="px-4 py-3">VALOR</th><th class="px-4 py-3">MOTIVO</th><th class="px-4 py-3">VIGENCIA</th><th class="px-4 py-3"><span class="sr-only">Acciones</span></th></tr></thead>
              <tbody><tr v-for="row in data.overrides" :key="row.id" class="border-t border-brand-border-light"><td class="px-5 py-3 font-semibold">{{ orgRows.find(org => org.id === row.tenantId)?.name || row.tenantId }}</td><td class="px-4 py-3">{{ labels[row.concept] || row.concept }}</td><td class="px-4 py-3 font-semibold">{{ formatOverrideValue(row) }}</td><td class="px-4 py-3 text-brand-text-secondary">{{ row.reason }}</td><td class="px-4 py-3 text-brand-text-secondary">{{ row.validFrom ? `Desde ${formatDate(row.validFrom)} · ` : '' }}{{ row.validUntil ? `Hasta ${formatDate(row.validUntil)}` : 'Sin vencimiento' }}</td><td class="px-4 py-3"><button type="button" class="inline-flex items-center gap-1 text-xs font-semibold text-brand-error-text hover:underline" :aria-label="`Quitar excepción de ${orgRows.find(org => org.id === row.tenantId)?.name || row.tenantId}`" @click="removeOverride(row)"><Trash2 class="h-3.5 w-3.5" />Quitar</button></td></tr></tbody>
            </table>
          </div>
          <div v-else class="flex flex-col items-center gap-2 px-5 py-8 text-center"><Building2 class="h-6 w-6 text-brand-text-muted" /><h3 class="text-sm font-bold">Sin excepciones activas</h3><p class="text-xs text-brand-text-secondary">Cuando una organización necesite un límite distinto al de su plan, agrégalo aquí con su motivo.</p><button v-if="!planRows.length && orgRows.length" type="button" class="text-xs font-semibold text-brand-blue underline" @click="showOverrideForm = true">Agregar excepción</button></div>
        </div>
      </section>

      <div v-if="hasEditor" class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-brand-border bg-brand-surface px-5 py-3 shadow-[0_-2px_8px_rgb(var(--brand-shadow)/0.0784313725)] sm:px-7">
        <div class="text-xs"><p :class="isDirty ? 'font-semibold text-brand-warning-text' : 'font-semibold text-brand-success-text'">{{ isDirty ? 'Tienes cambios sin guardar' : 'Todos los cambios están guardados' }}</p><p v-if="actionError" role="alert" class="mt-1 text-brand-error-text">{{ actionError }}</p></div>
        <div class="flex items-center gap-2"><button type="button" :disabled="!isDirty || saving" class="inline-flex items-center gap-1.5 rounded border border-brand-border px-3 py-2 text-xs font-semibold hover:bg-brand-bg disabled:opacity-50" @click="loadPlan(selectedKey)"><Undo2 class="h-4 w-4" />Descartar cambios</button><button type="button" :disabled="!isDirty || saving" class="inline-flex items-center gap-1.5 rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:opacity-50" @click="savePlan"><Save class="h-4 w-4" />{{ saving ? 'Guardando…' : 'Guardar cambios' }}</button></div>
      </div>
      <AgentUsageTable platform allowed class="mx-5 my-6 sm:mx-7" />
    </template>
  </main>
</template>

<style scoped>
input, textarea, select { color-scheme: inherit; }
</style>

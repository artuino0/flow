<script setup lang="ts">
import {
  AlertCircle,
  Archive,
  ArrowRightCircle,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Globe2,
  HardDrive,
  Loader2,
  RefreshCw,
  Users,
  Workflow
} from '@lucide/vue'

type UsageResource = 'storageBytes' | 'users' | 'sites' | 'automationExecutions' | 'emails'
interface UsageItem { resourceKey: UsageResource; quantity: number; limit: number | null; percentUsed: number | null; isOverLimit: boolean }
interface Plan { id: string; code: string; name: string; description: string; monthlyPriceCents: number; annualPriceCents: number; currency: string; limits: Record<string, number> }
interface Invoice {
  id: string
  status: string
  totalCents: number
  amountPaidCents: number
  currency: string
  issuedAt: string | null
  periodStart?: string | null
  periodEnd?: string | null
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
}
interface Overview {
  stripeConfigured: boolean
  subscription: { id: string; status: string; billingInterval: string; stripeCustomerId: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; plan: Plan } | null
  usage: UsageItem[]
  invoices: Invoice[]
  usageHistory: Array<{ resourceKey: UsageResource; quantity: number; limitValue: number | null; capturedOn: string }>
}

const toast = useToast()
const busyPlan = ref<string | null>(null)
const billingInterval = ref<'month' | 'year'>('month')
const openingPortal = ref(false)
const { data, pending, error, refresh } = await useFetch<Overview>('/api/billing/overview', { key: 'billing-overview', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })
const { data: plansResponse } = await useFetch<{ plans: Plan[] }>('/api/billing/plans', { key: 'billing-plans', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })

const labels: Record<UsageResource, { label: string; short: string; icon: typeof HardDrive; compact: (value: number) => string }> = {
  users: { label: 'Usuarios activos', short: 'Usuarios', icon: Users, compact: value => String(value) },
  storageBytes: { label: 'Almacenamiento', short: 'Almacenamiento', icon: HardDrive, compact: bytes => `${(bytes / 1024 / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 * 1024 ? 0 : 1)} GB` },
  automationExecutions: { label: 'Automatizaciones', short: 'Automatizaciones', icon: Workflow, compact: value => value.toLocaleString('es-MX') },
  sites: { label: 'Sitios publicados', short: 'Sitios', icon: Globe2, compact: value => String(value) },
  emails: { label: 'Correos administrados', short: 'Correos', icon: FileText, compact: value => value.toLocaleString('es-MX') }
}
const usageOrder: UsageResource[] = ['users', 'storageBytes', 'automationExecutions', 'sites', 'emails']
const historyOrder: UsageResource[] = ['storageBytes', 'automationExecutions', 'emails', 'users']
const plans = computed(() => plansResponse.value?.plans ?? [])
const subscription = computed(() => data.value?.subscription ?? null)
const usage = computed(() => usageOrder.map(key => data.value?.usage.find(item => item.resourceKey === key)).filter(Boolean) as UsageItem[])
const storage = computed(() => data.value?.usage.find(item => item.resourceKey === 'storageBytes'))
const money = (cents: number, currency = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin fecha definida'
const shortDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—'
const monthLabel = (value: string) => new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(new Date(`${value}T12:00:00`)).replace('.', '')
const statusLabel = (status: string | undefined) => ({ active: 'Activo', trialing: 'En prueba', past_due: 'Pendiente', canceled: 'Cancelado', unpaid: 'Pendiente', paused: 'Pausado', paid: 'Pagada', failed: 'Fallida', refunded: 'Reembolsada', void: 'Anulada' }[status || ''] || status || 'Sin activar')
const periodLabel = computed(() => {
  const end = subscription.value?.currentPeriodEnd ? new Date(subscription.value.currentPeriodEnd) : new Date()
  const start = new Date(end.getFullYear(), end.getMonth() - 1, end.getDate())
  return `${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(start)} — ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(end)}`
})
const currentPrice = computed(() => {
  const plan = subscription.value?.plan
  if (!plan) return 0
  return subscription.value?.billingInterval === 'year' ? plan.annualPriceCents : plan.monthlyPriceCents
})

function usageClass(item: UsageItem) {
  if (item.isOverLimit || (item.percentUsed ?? 0) >= 100) return 'usage-fill critical'
  if ((item.percentUsed ?? 0) >= 80) return 'usage-fill warning'
  return 'usage-fill'
}
function planFeatureList(plan: Plan) {
  const limits = plan.limits || {}
  return [
    `${limits.users ?? '—'} usuarios`,
    `${limits.storageBytes ? Math.round(limits.storageBytes / 1024 / 1024 / 1024) + ' GB' : 'Sin límite'} de almacenamiento`,
    `${Number(limits.automationExecutions || 0).toLocaleString('es-MX')} automatizaciones/mes`,
    `${limits.sites ?? '—'} sitios publicados`,
    plan.code === 'escala' ? 'Soporte prioritario 24/7' : plan.code === 'crecimiento' ? 'Soporte prioritario' : 'Soporte por correo'
  ]
}
function historyPoints(resourceKey: UsageResource) {
  const points = (data.value?.usageHistory || []).filter(point => point.resourceKey === resourceKey).slice(-6)
  const max = Math.max(1, ...points.map(point => point.quantity))
  return points.map(point => ({ ...point, height: Math.max(8, Math.round((point.quantity / max) * 34)) }))
}
function trendValue(resourceKey: UsageResource) {
  const points = historyPoints(resourceKey)
  const last = points.at(-1)?.quantity ?? data.value?.usage.find(item => item.resourceKey === resourceKey)?.quantity ?? 0
  return labels[resourceKey].compact(last)
}
function invoicePeriod(invoice: Invoice) {
  if (!invoice.periodStart && !invoice.periodEnd) return '—'
  return `${shortDate(invoice.periodStart)} – ${shortDate(invoice.periodEnd)}`
}
function scrollToPlans() { document.getElementById('available-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
async function upgrade(plan: Plan) {
  busyPlan.value = plan.code
  try {
    const result = await $fetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { planCode: plan.code, interval: billingInterval.value } })
    await navigateTo(result.url, { external: true })
  } catch (err: any) {
    toast.error('No se pudo abrir el checkout', err?.data?.statusMessage || err?.message || 'Intenta de nuevo.')
  } finally { busyPlan.value = null }
}
async function openPortal() {
  openingPortal.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/billing/portal', { method: 'POST' })
    await navigateTo(result.url, { external: true })
  } catch (err: any) {
    toast.error('No se pudo abrir la gestión de pago', err?.data?.statusMessage || err?.message || 'Intenta de nuevo.')
  } finally { openingPortal.value = false }
}
</script>

<template>
  <div class="billing-screen">
    <div v-if="pending && !data" class="billing-state"><Loader2 class="spin" :size="20" /> Cargando plan y consumo…</div>
    <div v-else-if="error" class="billing-error">No se pudo cargar el plan ni el consumo. Actualiza la página e inténtalo de nuevo.</div>

    <template v-else-if="data">
      <section class="panel plan-summary">
        <div class="summary-copy">
          <div class="summary-plan">
            <div class="summary-name-row">
              <h2>Flow {{ subscription?.plan.name || 'Inicio' }}</h2>
              <span class="status-pill success"><CheckCircle2 :size="12" />{{ statusLabel(subscription?.status) }}</span>
              <span v-if="!subscription?.cancelAtPeriodEnd" class="renewal-copy"><RefreshCw :size="12" /> Renovación automática</span>
            </div>
            <p>Próxima renovación: {{ date(subscription?.currentPeriodEnd) }}</p>
          </div>
          <span class="summary-divider" />
          <div class="summary-price">
            <strong>{{ money(currentPrice, subscription?.plan.currency || 'MXN') }}</strong>
            <span>{{ subscription?.plan.currency || 'MXN' }}</span>
            <p>Facturación {{ subscription?.billingInterval === 'year' ? 'anual' : 'mensual' }}</p>
          </div>
        </div>
        <div class="summary-actions">
          <button v-if="subscription?.stripeCustomerId" type="button" class="button outline" :disabled="openingPortal" @click="openPortal"><CreditCard :size="15" />{{ openingPortal ? 'Abriendo…' : 'Administrar facturación' }}</button>
          <button type="button" class="button primary" @click="scrollToPlans"><ArrowRightCircle :size="15" />Cambiar plan</button>
        </div>
      </section>

      <section class="panel usage-card">
        <header class="section-head compact"><div><h2>Consumo del periodo</h2><p>{{ periodLabel }}</p></div></header>
        <div class="usage-grid">
          <article v-for="item in usage" :key="item.resourceKey" class="usage-metric">
            <div class="metric-title"><component :is="labels[item.resourceKey].icon" :size="14" /><strong>{{ labels[item.resourceKey].label }}</strong></div>
            <div v-if="item.limit !== null" class="usage-track"><span :class="usageClass(item)" :style="{ width: `${Math.min(100, item.percentUsed || 0)}%` }" /></div>
            <div class="metric-bottom"><span>{{ labels[item.resourceKey].compact(item.quantity) }}<template v-if="item.limit !== null"> de {{ labels[item.resourceKey].compact(item.limit) }}</template></span><b v-if="item.limit !== null" :class="{ critical: (item.percentUsed || 0) >= 100, warning: (item.percentUsed || 0) >= 80 && (item.percentUsed || 0) < 100 }">{{ item.percentUsed }}%</b></div>
          </article>
        </div>
      </section>

      <section class="panel storage-card">
        <header class="section-head"><h2>Uso de almacenamiento</h2><button type="button" class="button outline small"><Archive :size="14" />Ver detalle de archivos</button></header>
        <div class="storage-body">
          <div class="storage-stats"><p><strong>{{ labels.storageBytes.compact(storage?.quantity || 0) }}</strong> de {{ labels.storageBytes.compact(storage?.limit || 0) }} contratados</p><b>{{ labels.storageBytes.compact(Math.max(0, (storage?.limit || 0) - (storage?.quantity || 0))) }} disponibles</b></div>
          <div class="segmented-storage"><span class="segment chat" :style="{ width: `${Math.min(100, storage?.percentUsed || 0)}%` }" /><span class="segment sites" /><span class="segment docs" /></div>
          <div class="storage-legend"><span><i class="chat" />Archivos del chat</span><span><i class="sites" />Imágenes de sitios</span><span><i class="docs" />Documentos</span></div>
          <p class="storage-help">Incluye archivos del chat, imágenes de sitios y documentos.</p>
        </div>
        <footer class="storage-foot"><CalendarDays :size="13" />Consumo calculado con corte al {{ date(new Date().toISOString()) }}</footer>
      </section>

      <section id="available-plans" class="panel plans-card">
        <header class="section-head plans-head">
          <div><h2>Planes disponibles</h2><p>Compara beneficios y cambia de plan cuando lo necesites.</p></div>
          <div class="billing-toggle"><button :class="{ active: billingInterval === 'month' }" @click="billingInterval = 'month'">Mensual</button><button :class="{ active: billingInterval === 'year' }" @click="billingInterval = 'year'">Anual <span>2 meses gratis</span></button></div>
        </header>
        <div class="plans-grid">
          <article v-for="plan in plans" :key="plan.code" class="plan-card" :class="{ current: subscription?.plan.code === plan.code }">
            <div class="plan-card-head">
              <div class="plan-title-row"><h3>{{ plan.name }}</h3><span v-if="subscription?.plan.code === plan.code">Plan actual</span></div>
              <p>{{ plan.description }}</p>
              <div class="plan-price"><strong>{{ money(billingInterval === 'year' ? plan.annualPriceCents : plan.monthlyPriceCents, plan.currency) }}</strong><span>{{ plan.currency }}/{{ billingInterval === 'year' ? 'año' : 'mes' }}</span></div>
              <button v-if="subscription?.plan.code === plan.code" type="button" class="plan-action" disabled>Plan actual</button>
              <button v-else type="button" class="plan-action" :disabled="busyPlan !== null || !data.stripeConfigured" @click="upgrade(plan)"><Loader2 v-if="busyPlan === plan.code" :size="14" class="spin" />{{ busyPlan === plan.code ? 'Abriendo…' : 'Cambiar a este plan' }}</button>
            </div>
            <ul><li v-for="feature in planFeatureList(plan)" :key="feature"><CheckCircle2 :size="14" />{{ feature }}</li></ul>
          </article>
        </div>
      </section>

      <section class="panel billing-history">
        <header class="section-head"><h2>Historial de facturación</h2><button v-if="data.invoices.length > 4" type="button" class="text-action">Ver todas</button></header>
        <div v-if="!data.invoices.length" class="empty-history"><Clock3 :size="17" />Aún no hay cobros registrados para esta organización.</div>
        <div v-else class="table-scroll"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Periodo</th><th>Importe</th><th>Estado</th><th>Acción</th></tr></thead><tbody><tr v-for="invoice in data.invoices.slice(0, 4)" :key="invoice.id"><td>{{ shortDate(invoice.issuedAt) }}</td><td><strong>Suscripción Flow {{ subscription?.plan.name }} — {{ subscription?.billingInterval === 'year' ? 'anual' : 'mensual' }}</strong></td><td>{{ invoicePeriod(invoice) }}</td><td><strong>{{ money(invoice.totalCents, invoice.currency) }}</strong></td><td><span class="invoice-status" :class="invoice.status">{{ statusLabel(invoice.status) }}</span></td><td><a v-if="invoice.invoicePdfUrl || invoice.hostedInvoiceUrl" :href="invoice.invoicePdfUrl || invoice.hostedInvoiceUrl || undefined" target="_blank" rel="noopener"><Download :size="13" />Descargar</a><span v-else>—</span></td></tr></tbody></table></div>
      </section>

      <section class="panel usage-history">
        <header class="section-head"><div><h2>Historial de consumo</h2><p>Últimos 6 periodos</p></div></header>
        <div class="history-body">
          <div v-for="resourceKey in historyOrder" :key="resourceKey" class="history-row">
            <div class="history-label"><component :is="labels[resourceKey].icon" :size="15" /><strong>{{ labels[resourceKey].short }}</strong></div>
            <div class="history-bars">
              <div v-for="point in historyPoints(resourceKey)" :key="point.capturedOn" class="history-point"><span :style="{ height: `${point.height}px` }" /><small>{{ monthLabel(point.capturedOn) }}</small></div>
              <div v-if="!historyPoints(resourceKey).length" class="history-empty">Sin muestras</div>
            </div>
            <div class="history-trend">↗ {{ trendValue(resourceKey) }}</div>
          </div>
        </div>
      </section>

      <div class="alerts-column">
        <div v-if="(storage?.percentUsed || 0) >= 80" class="billing-alert warning"><span class="alert-icon"><Archive :size="16" /></span><div><strong>Tu almacenamiento está cerca del límite</strong><p>Has usado {{ storage?.percentUsed }}% del espacio de tu plan. Libera archivos o mejora tu plan para evitar interrupciones.</p></div><button class="alert-action">Ver detalle de archivos</button></div>
        <div v-if="data.invoices.some(invoice => ['failed', 'past_due', 'uncollectible'].includes(invoice.status))" class="billing-alert danger"><span class="alert-icon"><CircleDollarSign :size="16" /></span><div><strong>Tu pago no pudo procesarse</strong><p>Actualiza tu método de pago para evitar la suspensión del servicio.</p></div><button class="alert-action" @click="openPortal">Actualizar método de pago</button></div>
        <div v-if="subscription?.status === 'trialing'" class="billing-alert info"><span class="alert-icon"><AlertCircle :size="16" /></span><div><strong>Tu periodo de prueba termina pronto</strong><p>Elige un plan para conservar tus datos y funciones activas.</p></div><button class="alert-action" @click="scrollToPlans">Elegir plan</button></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.billing-screen{display:flex;flex-direction:column;gap:24px;color:#33475b}.panel{overflow:hidden;border:1px solid #e5eaf0;border-radius:8px;background:#fff}.billing-state,.billing-error{display:flex;min-height:120px;align-items:center;justify-content:center;gap:8px;border:1px solid #e5eaf0;border-radius:8px;background:#fff;color:#516f90}.billing-error{margin:0;background:#fbe0dd;color:#c7391f}.plan-summary{display:flex;min-height:93px;align-items:center;justify-content:space-between;padding:24px;gap:24px}.summary-copy{display:flex;min-width:0;align-items:center;gap:28px}.summary-plan{min-width:398px}.summary-name-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.summary-name-row h2{margin:0;font-size:18px;line-height:24px}.summary-plan>p,.summary-price>p{margin:6px 0 0;font-size:11px;color:#8da1b5}.status-pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700}.status-pill.success{background:#ccf1de;color:#0a7a4f}.renewal-copy{display:flex;align-items:center;gap:4px;font-size:10px;color:#8da1b5}.summary-divider{width:1px;height:44px;background:#e5eaf0}.summary-price{min-width:126px}.summary-price strong{font-size:22px;line-height:27px}.summary-price>span{margin-left:4px;font-size:10px;font-weight:700;color:#8da1b5}.summary-actions{display:flex;align-items:center;gap:10px}.button{display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:7px;border-radius:4px;padding:0 16px;font-size:12px;font-weight:700;white-space:nowrap}.button.outline{border:1px solid #cbd6e2;box-shadow:none;outline:0;background:#fff;color:#33475b}.button.outline:hover{border-color:#0091ae;background:#fff;color:#0091ae}.button.primary{border:1px solid #ff7a59;background:#ff7a59;color:#fff}.button.primary:hover{background:#e66e50}.button.small{min-height:29px;padding:0 12px;font-size:11px}.section-head{display:flex;min-height:61px;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf0;padding:0 24px}.section-head.compact{min-height:67px}.section-head h2{margin:0;font-size:14px;line-height:18px}.section-head p{margin:2px 0 0;font-size:11px;color:#8da1b5}.usage-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:20px 24px}.usage-metric{min-width:0;padding-right:16px}.usage-metric+.usage-metric{padding-left:16px;border-left:1px solid #eef2f6}.metric-title{display:flex;align-items:center;gap:6px;font-size:11px;color:#516f90}.metric-title svg{color:#516f90}.usage-track{height:6px;margin-top:10px;overflow:hidden;border-radius:999px;background:#e5eaf0}.usage-fill{display:block;height:100%;border-radius:999px;background:#0091ae}.usage-fill.warning{background:#d99a16}.usage-fill.critical{background:#e05b43}.metric-bottom{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:10px;color:#8da1b5}.metric-bottom b{border-radius:999px;background:#eaf3f6;padding:2px 6px;font-size:9px;color:#0091ae}.metric-bottom b.warning{background:#fef0d2;color:#b3720a}.metric-bottom b.critical{background:#fbe0dd;color:#c7391f}.storage-body{padding:20px 24px 18px}.storage-stats{display:flex;align-items:flex-end;justify-content:space-between}.storage-stats p{margin:0;font-size:12px;color:#8da1b5}.storage-stats strong{font-size:22px;color:#33475b}.storage-stats b{font-size:11px;color:#0091ae}.segmented-storage{display:flex;height:10px;margin-top:12px;gap:2px;overflow:hidden;border-radius:999px;background:#e5eaf0}.segment{height:100%}.segment.chat{background:#0091ae}.segment.sites{flex:1;background:#36b9d1}.segment.docs{width:13%;background:#9bdded}.storage-legend{display:flex;gap:18px;margin-top:11px;font-size:10px;color:#516f90}.storage-legend span{display:flex;align-items:center;gap:5px}.storage-legend i{width:7px;height:7px;border-radius:50%}.storage-help{margin:14px 0 0;font-size:10px;color:#8da1b5}.storage-foot{display:flex;height:33px;align-items:center;gap:7px;border-top:1px solid #e5eaf0;background:#f8fafc;padding:0 24px;font-size:10px;color:#8da1b5}.plans-card{scroll-margin-top:20px}.plans-head{min-height:68px}.billing-toggle{display:flex;border-radius:999px;background:#eaf0f6;padding:3px}.billing-toggle button{height:30px;border-radius:999px;padding:0 14px;font-size:11px;font-weight:700;color:#516f90}.billing-toggle button.active{background:#fff;color:#33475b;box-shadow:0 1px 2px #33475b18}.billing-toggle span{margin-left:5px;border-radius:999px;background:#ccf1de;padding:2px 6px;font-size:8px;color:#0a7a4f}.plans-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:24px}.plan-card{overflow:hidden;border:1px solid #e5eaf0;border-radius:8px}.plan-card.current{border-color:#0091ae;box-shadow:0 0 0 1px #0091ae}.plan-card-head{min-height:158px;padding:20px}.plan-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.plan-title-row h3{margin:0;font-size:15px}.plan-title-row span{border-radius:999px;background:#eaf3f6;padding:3px 8px;font-size:9px;font-weight:700;color:#516f90}.plan-card-head>p{min-height:32px;margin:5px 0 0;font-size:11px;line-height:16px;color:#516f90}.plan-price{display:flex;align-items:baseline;gap:5px;margin-top:9px}.plan-price strong{font-size:22px}.plan-price span{font-size:9px;color:#8da1b5}.plan-action{display:flex;width:100%;height:32px;margin-top:10px;align-items:center;justify-content:center;gap:6px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;font-size:11px;font-weight:700;color:#33475b}.plan-action:hover:not(:disabled){border-color:#0091ae;color:#0091ae}.plan-action:disabled{color:#8da1b5}.plan-card ul{display:flex;min-height:147px;flex-direction:column;gap:7px;margin:0;border-top:1px solid #e5eaf0;padding:18px 20px;list-style:none;font-size:11px;color:#516f90}.plan-card li{display:flex;align-items:center;gap:7px}.plan-card li svg{flex:none;color:#0a7a4f}.billing-history .section-head{min-height:50px}.text-action{font-size:10px;font-weight:700;color:#0091ae}.empty-history{display:flex;align-items:center;gap:9px;padding:20px 24px;color:#8da1b5;font-size:12px}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:11px}th{height:36px;background:#f5f8fa;padding:0 16px;text-align:left;font-size:9px;letter-spacing:.03em;color:#8da1b5}td{height:52px;border-top:1px solid #e5eaf0;padding:0 16px;color:#516f90}td:nth-child(2){color:#33475b}td:last-child{text-align:right}td a{display:inline-flex;align-items:center;gap:5px;font-weight:700;color:#0091ae}.invoice-status{display:inline-flex;border-radius:999px;background:#eaf0f6;padding:4px 8px;font-size:9px;font-weight:700}.invoice-status.paid{background:#ccf1de;color:#0a7a4f}.invoice-status.failed,.invoice-status.past_due{background:#fbe0dd;color:#c7391f}.invoice-status.refunded{background:#eaf0f6;color:#516f90}.usage-history .section-head{min-height:67px}.history-body{padding:8px 24px 20px}.history-row{display:grid;min-height:68px;grid-template-columns:190px minmax(0,1fr) 120px;align-items:center;border-bottom:1px solid #e5eaf0}.history-row:last-child{border-bottom:0}.history-label{display:flex;align-items:center;gap:8px;font-size:11px;color:#516f90}.history-bars{display:flex;height:48px;align-items:flex-end;justify-content:space-around;gap:16px}.history-point{display:flex;height:48px;min-width:38px;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px}.history-point span{width:14px;border-radius:2px 2px 0 0;background:#dfe8ef}.history-point:last-child span{background:#0091ae}.history-point small{font-size:8px;color:#8da1b5}.history-empty{align-self:center;font-size:10px;color:#8da1b5}.history-trend{text-align:right;font-size:10px;font-weight:700;color:#516f90}.alerts-column{display:flex;flex-direction:column;gap:12px}.billing-alert{display:grid;min-height:61px;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:12px;border:1px solid;border-radius:8px;padding:12px 14px}.billing-alert.warning{border-color:#f4d58d;background:#fff4d6;color:#805800}.billing-alert.danger{border-color:#f0b7ad;background:#fde7e3;color:#a83420}.billing-alert.info{border-color:#bee4ec;background:#eaf7fa;color:#086f83}.alert-icon{display:flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:4px;background:#fff}.billing-alert strong{font-size:11px}.billing-alert p{margin:2px 0 0;font-size:10px}.alert-action{height:29px;border:1px solid currentColor;border-radius:4px;background:#fff;padding:0 12px;font-size:10px;font-weight:700}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.plan-summary{align-items:flex-start;flex-direction:column}.summary-actions{width:100%;justify-content:flex-end}.usage-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.usage-metric+.usage-metric{padding-left:0;border-left:0}.plans-grid{grid-template-columns:1fr}.summary-plan{min-width:0}.history-row{grid-template-columns:150px minmax(0,1fr) 100px}}
@media(max-width:720px){.billing-screen{gap:16px}.plan-summary,.summary-copy,.summary-actions{align-items:stretch;flex-direction:column}.summary-copy{gap:14px}.summary-divider{width:100%;height:1px}.summary-actions .button{width:100%}.usage-grid{grid-template-columns:1fr}.usage-metric{padding:0}.section-head{padding:12px 16px}.storage-body{padding:16px}.plans-grid{padding:16px}.plans-head{align-items:flex-start;flex-direction:column}.billing-toggle{align-self:stretch}.billing-toggle button{flex:1}.history-row{grid-template-columns:1fr;gap:8px;padding:12px 0}.history-bars{justify-content:flex-start;overflow-x:auto}.history-trend{text-align:left}.billing-alert{grid-template-columns:32px 1fr}.alert-action{grid-column:1/-1}.table-scroll table{min-width:760px}}
</style>


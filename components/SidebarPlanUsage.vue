<script setup lang="ts">
import { CalendarDays, Gauge, HardDrive, Zap, Users, Globe, Mail, Receipt, X } from '@lucide/vue'
import { detailConcepts, resourcePercent, sidebarResource, usageActions, usageMessages, usageState, usageText } from '~/utils/sidebarPlanUsage'

const props = defineProps<{ compact?: boolean }>()
const { data: isAdmin, pending: permissionsPending } = useIsAdmin()
const { user } = useAuth()
const { data: snapshot, error: usageError, refresh: refreshUsage } = useDesignerPlanUsage(isAdmin)
const { data: overview, status: overviewStatus, refresh: refreshOverview } = useBillingOverview(isAdmin)
const scope = computed(() => [user.value?.id, user.value?.tenantId, user.value?.roleId, user.value?.sessionId].join(':'))
const resource = computed(() => sidebarResource(snapshot.value?.usage ?? []))
const planName = computed(() => snapshot.value?.plan ? `Flow ${snapshot.value.plan}` : '')
const visible = computed(() => isAdmin.value === true && !permissionsPending.value && !usageError.value && snapshot.value?.scope === scope.value && !!snapshot.value?.plan && !!resource.value && (overview.value?.scope === scope.value || overviewStatus.value === 'error'))
const subscription = computed(() => overview.value?.scope === scope.value ? overview.value.subscription : null)
const cycle = computed(() => subscription.value?.billingInterval === 'year' ? 'Ciclo anual' : subscription.value?.billingInterval === 'month' ? 'Ciclo mensual' : '')
const renewal = computed(() => {
  const value = subscription.value?.currentPeriodEnd
  if (!value || subscription.value?.cancelAtPeriodEnd || !Number.isFinite(new Date(value).getTime())) return ''
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
})
const state = computed(() => usageState(resource.value))
const details = computed(() => detailConcepts.flatMap(concept => snapshot.value?.usage.filter(item => item.concept === concept) ?? []))
const icons = { storageBytes: HardDrive, executions: Zap, users: Users, sites: Globe, emails: Mail, stamps: Receipt }
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const dialogId = useId()
const position = ref({ left: '0px', top: '0px' })
const route = useRoute()

function close(restore = false) {
  open.value = false
  if (restore) trigger.value?.focus()
}
async function showDetail(event: MouseEvent) {
  if (open.value) return close(true)
  trigger.value = event.currentTarget as HTMLButtonElement
  open.value = true
  const rect = trigger.value.getBoundingClientRect()
  position.value = { left: Math.max(8, Math.min(window.innerWidth - 348, rect.right + 14)) + 'px', top: '8px' }
  await nextTick()
  if (!open.value || !panel.value) return
  position.value.top = Math.max(8, Math.min(window.innerHeight - panel.value.offsetHeight - 8, rect.bottom - panel.value.offsetHeight)) + 'px'
  panel.value.querySelector<HTMLButtonElement>('button')?.focus()
}
function outside(event: MouseEvent) {
  if (event.target instanceof Node && !panel.value?.contains(event.target) && !trigger.value?.contains(event.target)) close()
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(true) }
  if (event.key !== 'Tab') return
  const focusable = panel.value?.querySelectorAll<HTMLElement>('button, a[href]')
  if (!focusable?.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
async function refresh() {
  if (isAdmin.value === true && !permissionsPending.value) await Promise.all([refreshUsage(), refreshOverview()])
}
function wake() { if (document.visibilityState === 'visible') void refresh() }
function reposition(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return
  close()
}
watch(() => route.fullPath, () => {
  close()
  if (route.path === '/ajustes' && route.query.section === 'plan') void refresh()
})
watch([visible, () => props.compact], () => close())
onMounted(() => {
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('click', outside)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', wake)
  window.removeEventListener('click', outside)
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
})
</script>

<template>
  <div class="usage-reveal" :class="{ 'is-visible': visible && resource }" :aria-hidden="!visible" :inert="!visible" :style="{ visibility: isAdmin !== true || permissionsPending || snapshot?.scope !== scope ? 'hidden' : undefined }">
  <div class="usage-reveal-inner">
  <Transition name="usage-enter" appear>
  <section v-if="visible && resource" aria-label="Consumo del plan" class="plan-usage" :class="[state, { compact }]">
    <div class="usage-variant-row" :class="{ 'is-active': compact }" :aria-hidden="!compact" :inert="!compact">
    <div class="usage-variant-clip">
    <AppNavTooltip :enabled="compact && !open" plan-usage class="usage-collapsed">
      <button type="button" class="usage-icon" aria-label="Ver consumo del plan" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? dialogId : undefined" @click="showDetail">
        <Gauge :size="18" /><span class="alert-dot" aria-hidden="true" />
      </button>
      <template #tooltip>
        <div class="tooltip-plan" :class="state"><span class="status-dot" />{{ planName }}</div>
        <p class="tooltip-usage">{{ resource.label }}: {{ resourcePercent(resource) === null ? 'Ilimitado' : `${resource.percent}% usado` }}</p>
        <span class="tooltip-action">Ver consumo</span>
      </template>
    </AppNavTooltip>
    </div>
    </div>
    <div class="usage-variant-row" :class="{ 'is-active': !compact }" :aria-hidden="compact" :inert="compact">
    <div class="usage-variant-clip">
    <div class="usage-expanded">
      <div class="plan-row"><div><strong>{{ planName }}</strong><p v-if="cycle" class="cycle">{{ cycle }}</p></div><span class="status-dot" aria-hidden="true" /></div>
      <div class="bar-col">
        <div v-if="resourcePercent(resource) !== null" role="progressbar" :aria-label="resource.label" :aria-valuenow="resourcePercent(resource)!" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="usageText(resource)" class="usage-track"><span :style="{ width: `${resourcePercent(resource)}%` }" /></div>
        <p class="usage-text">{{ usageText(resource) }}</p>
      </div>
      <p class="state-message">{{ resource.limit === null ? 'Almacenamiento sin límite en tu plan' : usageMessages[state] }}</p>
      <p v-if="state === 'limit'" class="limit-explanation">No se eliminarán tus datos. Revisa las opciones de tu plan para nuevas cargas.</p>
      <div class="links-row"><button type="button" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? dialogId : undefined" @click="showDetail">Ver consumo</button><NuxtLink v-if="state === 'normal' || state === 'warning'" to="/ajustes?section=plan" class="upgrade-link" :style="{ visibility: open ? 'hidden' : undefined }">{{ usageActions[state] }}</NuxtLink></div>
      <NuxtLink v-if="state === 'critical' || state === 'limit'" to="/ajustes?section=plan" class="upgrade-button" :style="{ visibility: open ? 'hidden' : undefined }">{{ usageActions[state] }}</NuxtLink>
    </div>
    </div>
    </div>
    <Teleport to="body">
      <div v-if="open" :id="dialogId" ref="panel" role="dialog" aria-label="Detalle del consumo del plan" class="usage-detail" :style="position" @keydown="keyboard">
        <header><div class="detail-title"><div><strong>{{ planName }}</strong><p v-if="cycle" class="cycle">{{ cycle }}</p></div><button type="button" aria-label="Cerrar detalle del consumo" @click="close(true)"><X :size="16" /></button></div><p v-if="renewal" class="renewal"><CalendarDays :size="12" />Se renueva el {{ renewal }}</p></header>
        <div class="detail-body">
          <div v-for="item in details" :key="item.concept" class="detail-resource" :class="usageState(item)">
            <div class="resource-title"><span><component :is="icons[item.concept as keyof typeof icons]" :size="13" />{{ item.label }}</span><b>{{ resourcePercent(item) === null ? 'Ilimitado' : `${item.percent}%` }}</b></div>
            <div v-if="resourcePercent(item) !== null" role="progressbar" :aria-label="item.label" :aria-valuenow="resourcePercent(item)!" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="usageText(item)" class="usage-track"><span :style="{ width: `${resourcePercent(item)}%` }" /></div>
            <p>{{ usageText(item) }}</p>
          </div>
        </div>
        <footer><NuxtLink to="/ajustes?section=plan" class="upgrade-button" @click="close()">Mejorar plan</NuxtLink></footer>
      </div>
    </Teleport>
  </section>
  </Transition>
  </div>
  </div>
</template>

<style scoped>
.usage-reveal { flex:none; display:grid; grid-template-rows:0fr; transition:grid-template-rows 240ms ease-out; }
.usage-reveal.is-visible { grid-template-rows:1fr; }
.usage-reveal-inner,.usage-variant-clip { min-height:0; overflow:hidden; }
.usage-enter-enter-active,.usage-enter-leave-active { transition:opacity 240ms ease-out,transform 240ms ease-out; }
.usage-enter-enter-from,.usage-enter-leave-to { opacity:0; transform:translateY(4px); }
.usage-variant-row { display:grid; grid-template-rows:0fr; transition:grid-template-rows 240ms ease-out; }
.usage-variant-row.is-active { grid-template-rows:1fr; }
.usage-variant-clip { opacity:0; transform:translateY(4px); transition:opacity 240ms ease-out,transform 240ms ease-out; }
.is-active>.usage-variant-clip { opacity:1; transform:translateY(0); }
.usage-expanded { display:flex; flex-direction:column; gap:8px; padding:12px 10px; }
.usage-collapsed { display:flex; justify-content:center; padding:12px 0; }
.plan-usage { --usage-color:theme('colors.brand.blue'); flex:none; display:flex; flex-direction:column; width:100%; border-top:1px solid theme('colors.brand.border-light'); background:theme('colors.brand.surface'); color:theme('colors.brand.text'); font-size:10px; line-height:1.2; max-height:45vh; overflow-y:auto; }
.warning { --usage-color:theme('colors.brand.warning-text'); }
.critical,.limit { --usage-color:theme('colors.brand.error-text'); }
.plan-row,.links-row,.detail-title,.resource-title { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.plan-row strong { font-size:12px; font-weight:700; }
p { margin:0; }
.cycle { margin-top:1px; color:theme('colors.brand.text-secondary'); font-size:10px; }
.status-dot { flex:none; width:7px; height:7px; border-radius:50%; background:var(--usage-color); }
.bar-col { display:flex; flex-direction:column; gap:4px; }
.usage-track { height:6px; overflow:hidden; border-radius:999px; background:theme('colors.brand.border-light'); }
.usage-track>span { display:block; height:100%; border-radius:999px; background:var(--usage-color); }
.usage-text,.limit-explanation { color:theme('colors.brand.text-secondary'); font-weight:500; }
.state-message { color:var(--usage-color); font-weight:600; }
.warning .state-message { color:#985e08; }
.normal .state-message { color:theme('colors.brand.text-secondary'); font-weight:400; }
.limit-explanation { font-weight:400; }
.links-row { font-size:11px; font-weight:600; }
.links-row button { color:#007c95; }
.upgrade-link { color:theme('colors.brand.text-secondary'); }
.warning .upgrade-link { color:#985e08; font-weight:700; }
.upgrade-button { display:flex; align-items:center; justify-content:center; border-radius:4px; padding:8px 10px; background:theme('colors.brand.orange'); color:#fff; font-size:12px; font-weight:700; }
.upgrade-button:hover { background:theme('colors.brand.orange-hover'); }
button:hover,.upgrade-link:hover { text-decoration:underline; }
button:focus-visible,a:focus-visible { outline:2px solid theme('colors.brand.navy'); outline-offset:3px; border-radius:4px; }
.usage-icon { position:relative; display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:4px; color:theme('colors.brand.text-secondary'); }
.usage-icon:hover { background:theme('colors.brand.bg'); }
.alert-dot { position:absolute; left:24px; top:-2px; width:8px; height:8px; border:2px solid theme('colors.brand.surface'); border-radius:50%; background:var(--usage-color); }
.tooltip-plan { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; }
.tooltip-plan { --usage-color:theme('colors.brand.blue'); }
.tooltip-plan.warning { --usage-color:theme('colors.brand.warning-text'); }
.tooltip-plan.critical,.tooltip-plan.limit { --usage-color:theme('colors.brand.error-text'); }
.tooltip-plan .status-dot { width:6px; height:6px; }
.tooltip-usage { margin:4px 0; color:#d7e0e8; }
.tooltip-action { color:#7fd8ee; font-weight:700; }
.usage-detail { position:fixed; z-index:75; width:340px; max-width:calc(100vw - 16px); max-height:calc(100dvh - 16px); overflow-y:auto; border:1px solid theme('colors.brand.border-light'); border-radius:8px; background:theme('colors.brand.surface'); box-shadow:0 8px 20px #33475b26; color:theme('colors.brand.text'); font-family:Inter,ui-sans-serif,system-ui,sans-serif; font-size:11px; line-height:1.2; }
.usage-detail header { padding:16px 18px; border-bottom:1px solid theme('colors.brand.border-light'); }
.detail-title strong { font-size:15px; font-weight:700; }
.usage-detail .cycle { font-size:11px; }
.renewal { display:flex; align-items:center; gap:6px; margin-top:6px; color:theme('colors.brand.text-secondary'); }
.detail-body { display:flex; flex-direction:column; gap:14px; padding:18px; }
.detail-resource { --usage-color:theme('colors.brand.blue'); display:flex; flex-direction:column; gap:5px; }
.detail-resource.warning { --usage-color:theme('colors.brand.warning-text'); }
.detail-resource.critical,.detail-resource.limit { --usage-color:theme('colors.brand.error-text'); }
.resource-title>span { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; }
.resource-title svg,.detail-resource p { color:theme('colors.brand.text-secondary'); }
.resource-title b { color:theme('colors.brand.text-secondary'); font-weight:700; }
.warning .resource-title b { color:#985e08; }
.critical .resource-title b,.limit .resource-title b { color:theme('colors.brand.error-text'); }
.usage-detail footer { padding:14px 18px; border-top:1px solid theme('colors.brand.border-light'); }
.usage-detail footer .upgrade-button { padding:9px 14px; }
.status-dot,.alert-dot,.usage-track>span { transition:background-color 300ms ease-out; }
.usage-track>span { transition:width 300ms ease-out,background-color 300ms ease-out; }
.state-message,.upgrade-link,.resource-title b,.upgrade-button { transition:color 300ms ease-out,background-color 300ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .usage-reveal,.usage-variant-row,.usage-variant-clip,.usage-enter-enter-active,.usage-enter-leave-active,
  .status-dot,.alert-dot,.usage-track>span,.state-message,.upgrade-link,.resource-title b,.upgrade-button { transition:none; }
  .usage-variant-clip,.usage-enter-enter-from,.usage-enter-leave-to { transform:none; }
  .usage-enter-enter-from,.usage-enter-leave-to { opacity:1; }
}
</style>

<script setup lang="ts">
import { AlertCircle, ArrowRight, Boxes, Check, ClipboardList, FileText, Pencil, ReceiptText, Settings2 } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'

definePageMeta({ layout: 'default' })

interface ModuleSummary { slug: string; name: string; icon?: string | null; total: number; attention: number }
interface ShortcutOption { slug: string; name: string; icon?: string | null }
interface ActivityItem { id: string; recordId: string; entityName: string; entitySlug: string; label: string; actionType: string; userName: string; createdAt: string }
interface DashboardData { from: string; to: string; modules: ModuleSummary[]; activityTotal: number; activity: ActivityItem[] }

const { user } = useAuth()
const loading = ref(true)
const error = ref('')
const shortcutError = ref('')
const shortcutEditorOpen = ref(false)
const savingShortcuts = ref(false)
const shortcutOptions = ref<ShortcutOption[]>([])
const shortcuts = ref<string[]>([])
const data = ref<DashboardData>({ from: '', to: '', modules: [], activityTotal: 0, activity: [] })

const firstName = computed(() => (user.value?.fullName || user.value?.email || 'Usuario').trim().split(/\s+/)[0])
const tenantName = computed(() => user.value?.tenantName || 'tu organización')
const totalRecords = computed(() => data.value.modules.reduce((sum, item) => sum + item.total, 0))
const attentionTotal = computed(() => data.value.modules.reduce((sum, item) => sum + item.attention, 0))
const activeModules = computed(() => data.value.modules.filter(item => item.total > 0).length)
const shortcutItems = computed(() => shortcuts.value.map(slug => {
  const option = shortcutOptions.value.find(item => item.slug === slug)
  const metric = data.value.modules.find(item => item.slug === slug)
  return option ? { ...option, total: metric?.total ?? 0 } : null
}).filter((item): item is ShortcutOption & { total: number } => Boolean(item)))

const actionVerb = (type: string) => ({ CREATED: 'creó', UPDATED: 'actualizó', DELETED: 'eliminó', LINKED: 'relacionó', UNLINKED: 'desvinculó', NOTE: 'añadió una nota en', EMAIL: 'registró un correo en', CALL: 'registró una llamada en', TASK: 'creó una tarea en' }[type] || 'modificó')
const relativeTime = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Ayer' : `Hace ${days} días`
}
const formatCount = (value: number) => new Intl.NumberFormat('es-MX').format(value)

async function loadDashboard() {
  loading.value = true
  error.value = ''
  try {
    const [dashboard, preferences] = await Promise.all([
      $fetch<DashboardData>('/api/dashboard/operational'),
      $fetch<{ available: ShortcutOption[]; shortcuts: string[] }>('/api/dashboard/shortcuts')
    ])
    data.value = dashboard
    shortcutOptions.value = preferences.available
    shortcuts.value = preferences.shortcuts
  } catch {
    error.value = 'No pudimos cargar el tablero. Intenta actualizar la página.'
  } finally {
    loading.value = false
  }
}
function toggleShortcut(slug: string) {
  if (shortcuts.value.includes(slug)) shortcuts.value = shortcuts.value.filter(item => item !== slug)
  else if (shortcuts.value.length < 8) shortcuts.value = [...shortcuts.value, slug]
}
async function saveShortcuts() {
  savingShortcuts.value = true
  shortcutError.value = ''
  try {
    const result = await $fetch<{ shortcuts: string[] }>('/api/dashboard/shortcuts', { method: 'PUT', body: { shortcuts: shortcuts.value } })
    shortcuts.value = result.shortcuts
    shortcutEditorOpen.value = false
  } catch {
    shortcutError.value = 'No pudimos guardar tus accesos.'
  } finally {
    savingShortcuts.value = false
  }
}
onMounted(loadDashboard)
</script>

<template>
  <div class="dashboard" data-tour="dashboard">
    <header class="welcome">
      <div>
        <h1>Hola, {{ firstName }} <span aria-hidden="true">👋</span></h1>
        <p>Esto es lo que está pasando en {{ tenantName }} durante los últimos 30 días.</p>
      </div>
    </header>

    <div v-if="error" class="error-state" role="alert">
      <AlertCircle :size="18" />
      <span>{{ error }}</span>
      <button type="button" @click="loadDashboard">Reintentar</button>
    </div>

    <section class="metrics" aria-label="Resumen operativo">
      <template v-if="loading">
        <div v-for="item in 4" :key="item" class="metric-card skeleton-card"><span /><strong /><small /></div>
      </template>
      <template v-else>
        <article class="metric-card"><div class="metric-label"><span>Registros capturados</span><i><FileText :size="15" /></i></div><strong>{{ formatCount(totalRecords) }}</strong><small class="positive">En el periodo actual</small></article>
        <article class="metric-card"><div class="metric-label"><span>Requieren atención</span><i class="warning-icon"><AlertCircle :size="15" /></i></div><strong>{{ formatCount(attentionTotal) }}</strong><small :class="attentionTotal ? 'warning' : 'positive'">{{ attentionTotal ? 'Pendientes por revisar' : 'Todo en orden' }}</small></article>
        <article class="metric-card"><div class="metric-label"><span>Módulos con actividad</span><i><Boxes :size="15" /></i></div><strong>{{ activeModules }}</strong><small>De {{ data.modules.length }} módulos disponibles</small></article>
        <article class="metric-card"><div class="metric-label"><span>Movimientos registrados</span><i><Pencil :size="15" /></i></div><strong>{{ formatCount(data.activityTotal) }}</strong><small>Creaciones y actualizaciones</small></article>
      </template>
    </section>

    <div class="dashboard-columns">
      <section class="panel shortcuts-panel">
        <header class="panel-header">
          <div><h2>Accesos rápidos</h2><p>Los módulos que más utilizas.</p></div>
          <button class="customize-button" type="button" :aria-expanded="shortcutEditorOpen" @click="shortcutEditorOpen = !shortcutEditorOpen"><Settings2 :size="14" /> Personalizar</button>
        </header>

        <div v-if="shortcutEditorOpen" class="shortcut-editor">
          <div class="editor-copy"><strong>Elige tus accesos</strong><span>Puedes seleccionar hasta 8 módulos.</span></div>
          <div class="shortcut-options">
            <button v-for="item in shortcutOptions" :key="item.slug" type="button" :disabled="!shortcuts.includes(item.slug) && shortcuts.length >= 8" :class="{ selected: shortcuts.includes(item.slug) }" @click="toggleShortcut(item.slug)">
              <component :is="moduleIconComponent(item.icon)" :size="15" /><span>{{ item.name }}</span><Check v-if="shortcuts.includes(item.slug)" :size="15" />
            </button>
          </div>
          <div class="editor-footer"><span :class="{ 'error-text': shortcutError }">{{ shortcutError || `${shortcuts.length} de 8 seleccionados` }}</span><button type="button" :disabled="savingShortcuts" @click="saveShortcuts">{{ savingShortcuts ? 'Guardando…' : 'Guardar' }}</button></div>
        </div>

        <div v-if="loading" class="shortcut-grid"><div v-for="item in 6" :key="item" class="shortcut-card skeleton-card" /></div>
        <div v-else-if="shortcutItems.length" class="shortcut-grid">
          <NuxtLink v-for="item in shortcutItems" :key="item.slug" :to="'/registros/' + item.slug" class="shortcut-card">
            <span class="shortcut-icon"><component :is="moduleIconComponent(item.icon)" :size="17" /></span>
            <strong>{{ item.name }}</strong><small>{{ formatCount(item.total) }} registros</small>
            <ArrowRight class="shortcut-arrow" :size="15" />
          </NuxtLink>
        </div>
        <div v-else class="empty-state"><Settings2 :size="22" /><strong>Configura tus accesos rápidos</strong><p>Elige los módulos que quieres tener disponibles al entrar.</p><button type="button" @click="shortcutEditorOpen = true">Seleccionar módulos</button></div>
      </section>

      <aside class="panel activity-panel">
        <header class="panel-header"><div><h2>Actividad reciente</h2><p>Cambios en los módulos que puedes consultar.</p></div></header>
        <div v-if="loading" class="activity-list"><div v-for="item in 5" :key="item" class="activity-item skeleton-activity"><span /><div><strong /><small /></div></div></div>
        <div v-else-if="data.activity.length" class="activity-list">
          <NuxtLink v-for="item in data.activity" :key="item.id" :to="`/registros/${item.entitySlug}/${item.recordId}`" class="activity-item">
            <span class="activity-avatar">{{ item.userName.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() }}</span>
            <span class="activity-copy"><span><strong>{{ item.userName }}</strong> {{ actionVerb(item.actionType) }} <b>{{ item.label }}</b></span><small>{{ item.entityName }} · {{ relativeTime(item.createdAt) }}</small></span>
          </NuxtLink>
        </div>
        <div v-else class="empty-activity"><ClipboardList :size="22" /><strong>Sin movimientos recientes</strong><p>La actividad aparecerá aquí cuando se creen o actualicen registros.</p></div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.dashboard{min-height:100%;padding:32px;color:#33475b}.welcome{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px}.welcome h1{margin:0;font-size:22px;font-weight:700;line-height:1.25}.welcome p{margin:6px 0 0;color:#516f90;font-size:14px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}.metric-card{min-height:122px;padding:20px;border:1px solid #e5eaf0;border-radius:8px;background:#fff;box-shadow:0 1px 3px #33475b14}.metric-label{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#516f90;font-size:13px;font-weight:600}.metric-label i{display:grid;width:28px;height:28px;place-items:center;border-radius:4px;background:#eaf3f6;color:#0091ae;font-style:normal}.metric-label .warning-icon{background:#fef0d2;color:#b3720a}.metric-card>strong{display:block;margin-top:7px;color:#33475b;font-size:26px;line-height:1;font-weight:700}.metric-card>small{display:block;margin-top:9px;color:#8da1b5;font-size:12px}.metric-card>small.positive{color:#0a7a4f;font-weight:600}.metric-card>small.warning{color:#b3720a;font-weight:600}.dashboard-columns{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px;align-items:start}.panel{overflow:hidden;border:1px solid #e5eaf0;border-radius:8px;background:#fff;box-shadow:0 1px 3px #33475b14}.panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px;border-bottom:1px solid #e5eaf0}.panel-header h2{margin:0;color:#33475b;font-size:16px;font-weight:700}.panel-header p{margin:4px 0 0;color:#516f90;font-size:13px}.customize-button{display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;color:#516f90;font-size:12px;font-weight:600;transition:background .18s ease,color .18s ease}.customize-button:hover,.customize-button:focus-visible{background:#eaf3f6;color:#007f98;outline:2px solid #0091ae33;outline-offset:2px}.shortcut-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:20px}.shortcut-card{position:relative;display:flex;min-width:0;min-height:118px;flex-direction:column;align-items:flex-start;gap:8px;padding:14px;border:1px solid #e5eaf0;border-radius:4px;background:#fff;color:#33475b;text-decoration:none;transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease}.shortcut-card:hover,.shortcut-card:focus-visible{border-color:#9fcbd5;box-shadow:0 5px 14px #33475b12;transform:translateY(-1px);outline:none}.shortcut-icon{display:grid;width:32px;height:32px;place-items:center;border-radius:4px;background:#eaf3f6;color:#0091ae}.shortcut-card strong{max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}.shortcut-card small{color:#8da1b5;font-size:12px}.shortcut-arrow{position:absolute;right:12px;bottom:13px;color:#b1bfcc;opacity:0;transform:translateX(-3px);transition:opacity .18s ease,transform .18s ease}.shortcut-card:hover .shortcut-arrow,.shortcut-card:focus-visible .shortcut-arrow{opacity:1;transform:none}.shortcut-editor{padding:16px 20px;border-bottom:1px solid #e5eaf0;background:#f8fafc}.editor-copy{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px}.editor-copy strong{font-size:13px}.editor-copy span{color:#8da1b5;font-size:12px}.shortcut-options{display:flex;flex-wrap:wrap;gap:8px}.shortcut-options button{display:flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;color:#516f90;font-size:12px}.shortcut-options button.selected{border-color:#71bdcd;background:#eaf3f6;color:#007f98}.shortcut-options button:disabled{cursor:not-allowed;opacity:.45}.editor-footer{display:flex;align-items:center;justify-content:space-between;margin-top:14px;color:#8da1b5;font-size:12px}.editor-footer button,.empty-state button{padding:8px 13px;border:0;border-radius:4px;background:#ff7a59;color:#fff;font-size:12px;font-weight:700}.editor-footer button:disabled{opacity:.6}.error-text{color:#c7391f}.activity-list{padding:20px}.activity-item{display:flex;gap:10px;padding-bottom:16px;color:#33475b;text-decoration:none}.activity-item:last-child{padding-bottom:0}.activity-avatar{display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border-radius:999px;background:#eaf3f6;color:#0091ae;font-size:10px;font-weight:700}.activity-copy{display:flex;min-width:0;flex-direction:column;gap:3px;font-size:13px;line-height:1.4}.activity-copy b{font-weight:600}.activity-copy small{color:#8da1b5;font-size:12px}.activity-item:hover .activity-copy>span{color:#007f98}.empty-state,.empty-activity{display:flex;min-height:220px;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;color:#8da1b5}.empty-state strong,.empty-activity strong{margin-top:10px;color:#516f90;font-size:13px}.empty-state p,.empty-activity p{max-width:300px;margin:5px 0 14px;font-size:12px;line-height:1.5}.empty-activity p{margin-bottom:0}.error-state{display:flex;align-items:center;gap:9px;margin-bottom:18px;padding:12px 14px;border:1px solid #efb8b0;border-radius:6px;background:#fbe0dd;color:#a9321c;font-size:13px}.error-state span{flex:1}.error-state button{border:0;background:transparent;color:#a9321c;font-weight:700}.skeleton-card span,.skeleton-card strong,.skeleton-card small,.skeleton-activity span,.skeleton-activity strong,.skeleton-activity small{display:block;border-radius:4px;background:linear-gradient(90deg,#edf1f4 25%,#f7f9fa 50%,#edf1f4 75%);background-size:200% 100%;animation:shimmer 1.4s infinite}.skeleton-card span{width:65%;height:12px}.skeleton-card strong{width:35%;height:25px;margin-top:14px}.skeleton-card small{width:50%;height:10px;margin-top:12px}.skeleton-activity>span{width:28px;height:28px;border-radius:999px}.skeleton-activity>div{flex:1}.skeleton-activity strong{width:90%;height:11px}.skeleton-activity small{width:40%;height:9px;margin-top:7px}@keyframes shimmer{to{background-position:-200% 0}}@media(prefers-reduced-motion:reduce){.shortcut-card,.shortcut-arrow{transition:none}.skeleton-card span,.skeleton-card strong,.skeleton-card small,.skeleton-activity span,.skeleton-activity strong,.skeleton-activity small{animation:none}}@media(max-width:1100px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-columns{grid-template-columns:1fr}.activity-panel{width:100%}}@media(max-width:720px){.dashboard{padding:24px 16px}.metrics{grid-template-columns:1fr 1fr;gap:10px}.metric-card{min-height:112px;padding:15px}.dashboard-columns{gap:16px}.shortcut-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:16px}.panel-header{padding:16px}.editor-copy{flex-direction:column;gap:4px}}@media(max-width:480px){.metrics{grid-template-columns:1fr}.shortcut-grid{grid-template-columns:1fr}.panel-header{align-items:flex-start;flex-direction:column}.customize-button{align-self:flex-start}}
</style>

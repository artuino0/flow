<script setup lang="ts">
import { EllipsisVertical, FileText, Plus, X } from '@lucide/vue'

const props = withDefaults(defineProps<{ siteId?: string; kind?: 'website' | 'landing' }>(), { kind: 'website' })

interface PageRow {
  id: string
  siteId: string
  siteName: string
  siteSlug: string
  title: string
  path: string
  kind: 'website' | 'landing'
  status: string
  formCount: number
  updatedAt: string
}

interface SiteRow { id: string; name: string; slug: string }

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const endpoint = computed(() => '/api/sites/pages?kind=' + props.kind)
const [{ data, pending, error, refresh }, { data: sitesData }] = await Promise.all([
  useFetch<{ pages: PageRow[] }>(endpoint, { headers }),
  useFetch<{ sites: SiteRow[] }>('/api/sites', { headers })
])

const query = ref('')
const status = ref('all')
const createOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ siteId: props.siteId ?? '', title: '', path: props.kind === 'landing' ? '/landing/' : '/' })
const toast = useToast()
// HU-ERD-104c: aviso de límite del plan ('pages') al presionar "Nueva página",
// antes de abrir el modal, y mismo aviso si el servidor responde 402 al guardar.
const { checkBeforeCreate, handlePlanLimitError } = usePlanLimit()

const rows = computed(() => (data.value?.pages ?? [])
  .filter(page => !props.siteId || page.siteId === props.siteId)
  .filter(page => status.value === 'all' || page.status === status.value)
  .filter(page => {
    const term = query.value.trim().toLowerCase()
    return !term || page.title.toLowerCase().includes(term) || page.path.toLowerCase().includes(term) || page.siteName.toLowerCase().includes(term)
  }))

const counts = computed(() => {
  const source = (data.value?.pages ?? []).filter(page => !props.siteId || page.siteId === props.siteId)
  return {
    all: source.length,
    published: source.filter(page => page.status === 'published').length,
    draft: source.filter(page => page.status === 'draft').length,
    archived: source.filter(page => page.status === 'archived').length
  }
})

const title = computed(() => props.kind === 'landing' ? 'Landing pages' : 'Páginas')
const singular = computed(() => props.kind === 'landing' ? 'landing page' : 'página')
function countFor(key: string) { return counts.value[key as keyof typeof counts.value] ?? 0 }

async function openCreate() {
  if (!await checkBeforeCreate('pages')) return
  Object.assign(form, { siteId: props.siteId ?? sitesData.value?.sites?.[0]?.id ?? '', title: '', path: props.kind === 'landing' ? '/landing/' : '/' })
  formError.value = ''
  createOpen.value = true
}

function suggestPath() {
  if (!form.title || (form.path !== '/' && form.path !== '/landing/')) return
  const slug = form.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  form.path = (props.kind === 'landing' ? '/landing/' : '/') + slug
}

async function createPage() {
  if (!form.siteId) {
    formError.value = 'Selecciona un sitio.'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const page = await $fetch<PageRow>('/api/sites/' + form.siteId + '/pages', {
      method: 'POST',
      body: { title: form.title, path: form.path, kind: props.kind }
    })
    await refresh()
    createOpen.value = false
    toast.success((props.kind === 'landing' ? 'Landing page' : 'Página') + ' creada', 'El borrador está listo para editar.')
    await navigateTo('/sites/' + form.siteId + '/pages/' + page.id)
  } catch (err: any) {
    if (await handlePlanLimitError(err)) {
      createOpen.value = false
      return
    }
    formError.value = err?.data?.statusMessage || 'No se pudo crear el contenido.'
  } finally {
    saving.value = false
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function statusLabel(value: string) {
  if (value === 'published') return 'Publicada'
  if (value === 'archived') return 'Archivada'
  return 'Borrador'
}
</script>

<template>
  <section class="content-manager">
    <ListPageHeader
      v-model:search="query"
      :title="title"
      description="Administra, publica y consulta el contenido de tus sitios."
      :count="counts.all"
      :count-noun="singular"
      :search-placeholder="'Buscar ' + title.toLowerCase() + '...'"
      :refreshing="pending"
      @refresh="refresh"
    >
      <template #actions>
        <button type="button" class="primary-button" @click="openCreate"><Plus />Nueva {{ singular }}</button>
      </template>
      <template #toolbar-right>
        <NuxtLink class="analytics-link" to="/sites/analytics">Ver analítica</NuxtLink>
      </template>
    </ListPageHeader>

    <div class="manager-tabs">
      <button v-for="tab in [{ key: 'all', label: 'Todas' }, { key: 'published', label: 'Publicadas' }, { key: 'draft', label: 'Borradores' }, { key: 'archived', label: 'Archivadas' }]" :key="tab.key" type="button" :class="{ active: status === tab.key }" @click="status = tab.key">
        {{ tab.label }} <span>{{ countFor(tab.key) }}</span>
      </button>
    </div>

    <div class="content-table">
      <div class="content-row content-head" :class="{ global: !siteId }">
        <div>Página</div><div v-if="!siteId">Sitio</div><div>Estado</div><div>Formularios</div><div>Última actualización</div><div />
      </div>
      <div v-if="pending" class="content-state">Cargando contenido…</div>
      <div v-else-if="error" class="content-state error">No se pudo cargar el contenido.</div>
      <template v-else-if="rows.length">
        <div v-for="page in rows" :key="page.id" class="content-row content-data" :class="{ global: !siteId }">
          <NuxtLink :to="'/sites/' + page.siteId + '/pages/' + page.id" class="page-cell">
            <span class="page-icon"><FileText /></span>
            <span><strong>{{ page.title }}</strong><small>{{ page.siteSlug }}.flow.site{{ page.path }}</small></span>
          </NuxtLink>
          <div v-if="!siteId" class="site-cell">{{ page.siteName }}</div>
          <div><span class="status-badge" :class="'status-' + page.status">{{ statusLabel(page.status) }}</span></div>
          <div>{{ page.formCount }}</div>
          <div>{{ formatDate(page.updatedAt) }}</div>
          <div class="row-action"><NuxtLink :to="'/sites/' + page.siteId + '/pages/' + page.id" :aria-label="'Editar ' + page.title"><EllipsisVertical /></NuxtLink></div>
        </div>
      </template>
      <div v-else class="empty-state"><FileText /><strong>No hay contenido en esta vista</strong><p>Crea una {{ singular }} o cambia los filtros.</p></div>
    </div>

    <div v-if="createOpen" class="modal-layer" @keydown.esc="createOpen = false">
      <form class="create-modal" @submit.prevent="createPage">
        <header><div><h2>Nueva {{ singular }}</h2><p>El contenido se crea como borrador.</p></div><button type="button" aria-label="Cerrar" @click="createOpen = false"><X /></button></header>
        <div class="modal-body">
          <label v-if="!siteId">Sitio<select v-model="form.siteId" required><option value="" disabled>Selecciona un sitio</option><option v-for="site in sitesData?.sites ?? []" :key="site.id" :value="site.id">{{ site.name }}</option></select></label>
          <label>Nombre interno<input v-model="form.title" required maxlength="160" placeholder="Solicitar información" @blur="suggestPath" /></label>
          <label>Ruta<input v-model="form.path" required maxlength="220" placeholder="/solicitar-informacion" /></label>
          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>
        <footer><button type="button" class="secondary-button" @click="createOpen = false">Cancelar</button><button class="primary-button" :disabled="saving">{{ saving ? 'Creando…' : 'Crear borrador' }}</button></footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.content-manager{min-height:100%;width:100%;padding:32px;background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.manager-heading{display:flex;min-height:54px;align-items:flex-start;justify-content:space-between;gap:24px}.manager-heading h1{margin:0;font-size:26px;line-height:1.15;font-weight:700}.manager-heading p{margin:6px 0 0;color:rgb(var(--brand-text-secondary));font-size:14px}.primary-button{display:inline-flex;height:36px;align-items:center;justify-content:center;gap:7px;border:0;border-radius:4px;background:rgb(var(--brand-orange));padding:0 15px;color:rgb(var(--brand-primary-fg));font-size:13px;font-weight:700;cursor:pointer}.primary-button:hover{background:rgb(var(--brand-orange-hover))}.primary-button:disabled{opacity:.6}.primary-button svg{height:16px;width:16px}.manager-tabs{display:flex;margin-top:20px;border-bottom:1px solid rgb(var(--brand-control-border));gap:24px}.manager-tabs button{position:relative;height:40px;border:0;background:transparent;padding:0;color:rgb(var(--brand-text-secondary));font-size:13px;font-weight:600}.manager-tabs button.active{color:rgb(var(--brand-text))}.manager-tabs button.active:after{position:absolute;right:0;bottom:-1px;left:0;height:2px;background:rgb(var(--brand-orange));content:""}.manager-tabs span{margin-left:4px;color:rgb(var(--brand-sites-muted));font-size:11px}.manager-toolbar{display:flex;align-items:center;justify-content:space-between;padding:16px 0}.manager-toolbar label{display:flex;height:36px;width:320px;align-items:center;gap:8px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 11px}.manager-toolbar svg{height:16px;width:16px;color:rgb(var(--brand-sites-muted))}.manager-toolbar input{min-width:0;flex:1;border:0;outline:0;color:rgb(var(--brand-text));font-size:13px}.manager-toolbar>a,.analytics-link{color:rgb(var(--brand-blue));font-size:13px;font-weight:600;text-decoration:none}.content-table{overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-surface))}.content-row{display:grid;grid-template-columns:minmax(320px,2fr) 120px 100px 170px 46px;min-width:790px;align-items:center}.content-row.global{grid-template-columns:minmax(300px,2fr) minmax(150px,1fr) 120px 100px 170px 46px}.content-row>div,.content-row>a{min-width:0;padding:0 16px}.content-head{height:40px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary));font-size:11.5px;font-weight:700}.content-data{min-height:64px;border-bottom:1px solid rgb(var(--brand-border-light));color:rgb(var(--brand-text-secondary));font-size:13px}.content-data:last-child{border-bottom:0}.content-data:hover{background:rgb(var(--brand-sites-row-hover))}.page-cell{display:flex;min-height:64px;align-items:center;gap:10px;color:rgb(var(--brand-text));text-decoration:none}.page-icon{display:grid;height:34px;width:34px;flex:0 0 34px;place-items:center;border-radius:4px;background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-blue))}.page-icon svg{height:16px;width:16px}.page-cell>span:last-child{display:flex;min-width:0;flex-direction:column;gap:3px}.page-cell strong{overflow:hidden;font-size:13.5px;text-overflow:ellipsis;white-space:nowrap}.page-cell small{overflow:hidden;color:rgb(var(--brand-sites-muted));font-family:"Roboto Mono",Consolas,monospace;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.site-cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status-badge{display:inline-flex;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700}.status-published{background:rgb(var(--brand-success-bg));color:rgb(var(--brand-success-text))}.status-draft{background:rgb(var(--brand-kanban-divider));color:rgb(var(--brand-text-secondary))}.status-archived{background:rgb(var(--brand-error-bg));color:rgb(var(--brand-error-text))}.row-action{display:flex;justify-content:center;padding:0!important}.row-action a{display:grid;height:30px;width:30px;place-items:center;border-radius:4px;color:rgb(var(--brand-sites-muted))}.row-action a:hover{background:rgb(var(--brand-sites-action-hover));color:rgb(var(--brand-text))}.row-action svg{height:16px;width:16px}.content-state{padding:28px 16px;color:rgb(var(--brand-text-secondary));font-size:13px}.content-state.error{color:rgb(var(--brand-error-text))}.empty-state{display:flex;min-height:280px;align-items:center;justify-content:center;flex-direction:column;text-align:center}.empty-state>svg{height:28px;width:28px;color:rgb(var(--brand-blue))}.empty-state strong{margin-top:12px;font-size:14px}.empty-state p{margin:5px 0;color:rgb(var(--brand-sites-muted));font-size:13px}.modal-layer{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:rgb(var(--brand-shadow) / 0.4);padding:20px}.create-modal{width:min(440px,100%);overflow:hidden;border:1px solid rgb(var(--brand-control-border));border-radius:8px;background:rgb(var(--brand-surface));box-shadow:0 12px 40px rgb(var(--brand-shadow) / 0.1803921568627451)}.create-modal>header{display:flex;justify-content:space-between;border-bottom:1px solid rgb(var(--brand-border-light));padding:20px 22px}.create-modal h2{margin:0;font-size:18px}.create-modal header p{margin:4px 0 0;color:rgb(var(--brand-sites-muted));font-size:13px}.create-modal header button{display:grid;height:28px;width:28px;place-items:center;border:0;background:transparent;color:rgb(var(--brand-sites-muted))}.create-modal header svg{height:16px;width:16px}.modal-body{display:grid;gap:16px;padding:22px}.modal-body label{display:grid;gap:7px;font-size:13px;font-weight:700}.modal-body input,.modal-body select{height:38px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 10px;color:rgb(var(--brand-text));font-size:13px;font-weight:400;outline:none}.modal-body input:focus,.modal-body select:focus{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}.form-error{margin:0;border-radius:4px;background:rgb(var(--brand-error-bg));padding:9px 10px;color:rgb(var(--brand-error-text));font-size:12px}.create-modal footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-designer-section-bg));padding:14px 22px}.secondary-button{height:36px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 14px;color:rgb(var(--brand-text));font-size:13px;font-weight:600}@media(max-width:920px){.content-table{overflow-x:auto}}@media(max-width:640px){.content-manager{--list-page-gutter-y:20px;--list-page-gutter-x:16px;padding:20px 16px}.manager-heading p{display:none}.manager-toolbar label{width:100%}.manager-toolbar>a{display:none}}
.manager-toolbar input{background:rgb(var(--brand-surface))}
input,select,textarea{color-scheme:inherit}
</style>

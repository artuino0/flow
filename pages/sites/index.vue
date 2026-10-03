<script setup lang="ts">
import { EllipsisVertical, Globe2, LayoutTemplate, Plus, X } from '@lucide/vue'

definePageMeta({ layout: 'default', darkReady: true, fullBleed: true })

interface SiteRow {
  id: string
  name: string
  slug: string
  status: 'draft' | 'published' | 'archived'
  locale: string
  pageCount: number
  formCount: number
  updatedAt: string
}

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ sites: SiteRow[] }>('/api/sites', { headers })
const sites = computed(() => data.value?.sites ?? [])
const search = ref('')
const filteredSites = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return sites.value
  return sites.value.filter(site =>
    site.name.toLowerCase().includes(term)
    || site.slug.toLowerCase().includes(term)
    || statusLabel(site.status).toLowerCase().includes(term)
  )
})
const createOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', slug: '', locale: 'es-MX' })
const formError = ref<string | null>(null)
const toast = useToast()
// HU-ERD-104c: aviso de límite del plan ('sites') al presionar "Crear sitio",
// antes de abrir el modal, y mismo aviso si el servidor responde 402 al guardar.
const { checkBeforeCreate, handlePlanLimitError } = usePlanLimit()

async function openCreate() {
  if (!await checkBeforeCreate('sites')) return
  Object.assign(form, { name: '', slug: '', locale: 'es-MX' })
  formError.value = null
  createOpen.value = true
}

function toSlug() {
  if (form.slug) return
  form.slug = form.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function createSite() {
  saving.value = true
  formError.value = null
  try {
    const site = await $fetch<SiteRow>('/api/sites', { method: 'POST', body: form })
    createOpen.value = false
    await refresh()
    toast.success('Sitio creado', 'Ya puedes comenzar a diseñar sus páginas.')
    await navigateTo('/sites/' + site.id + '/overview')
  } catch (err: any) {
    if (await handlePlanLimitError(err)) {
      createOpen.value = false
      return
    }
    formError.value = err?.data?.statusMessage || 'No se pudo crear el sitio'
  } finally {
    saving.value = false
  }
}

function statusLabel(status: SiteRow['status']) {
  return status === 'published' ? 'Publicado' : status === 'archived' ? 'Archivado' : 'Borrador'
}

function statusClass(status: SiteRow['status']) {
  if (status === 'published') return 'is-published'
  if (status === 'archived') return 'is-archived'
  return 'is-draft'
}

function lastPublication(site: SiteRow) {
  if (site.status !== 'published') return 'Sin publicar'
  const days = Math.max(0, Math.floor((Date.now() - new Date(site.updatedAt).getTime()) / 86_400_000))
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  return 'Hace ' + days + ' días'
}
</script>

<template>
  <div class="sites-inbox">
    <ListPageHeader
      v-model:search="search"
      title="Sites"
      description="Crea experiencias públicas conectadas con Flow Core."
      :count="sites.length"
      count-noun="sitio"
      search-placeholder="Buscar sitios..."
      :refreshing="pending"
      @refresh="refresh"
    >
      <template #actions>
        <button type="button" class="sites-primary" @click="openCreate"><Plus />Crear sitio</button>
      </template>
    </ListPageHeader>

    <section class="sites-table" aria-label="Listado de sitios">
      <div class="sites-row sites-row-head">
        <div>Sitio</div><div>Subdominio</div><div>Estado</div><div>Páginas</div><div>Formularios</div><div>Última publicación</div><div><span class="sr-only">Acciones</span></div>
      </div>

      <template v-if="pending">
        <div v-for="item in 3" :key="item" class="sites-row sites-row-loading">
          <div><span class="loading-line w-44" /></div><div><span class="loading-line w-36" /></div><div><span class="loading-pill" /></div>
        </div>
      </template>
      <div v-else-if="error" class="sites-state error-state">No se pudieron cargar los sitios. Intenta actualizar la página.</div>
      <template v-else-if="filteredSites.length">
        <div v-for="site in filteredSites" :key="site.id" class="sites-row sites-row-data">
          <NuxtLink :to="'/sites/' + site.id + '/overview'" class="site-name-cell"><span class="site-icon"><Globe2 /></span><span>{{ site.name }}</span></NuxtLink>
          <NuxtLink :to="'/sites/' + site.id + '/overview'" class="site-domain">{{ site.slug }}.flow.site</NuxtLink>
          <div><span class="status-pill" :class="statusClass(site.status)">{{ statusLabel(site.status) }}</span></div>
          <div>{{ site.pageCount }}</div><div>{{ site.formCount ?? 0 }}</div><div>{{ lastPublication(site) }}</div>
          <div class="site-actions"><button type="button" :aria-label="'Acciones de ' + site.name"><EllipsisVertical /></button></div>
        </div>
      </template>
      <div v-else class="sites-empty">
        <span class="site-empty-icon"><LayoutTemplate /></span><strong>Crea tu primer sitio</strong>
        <p>Empieza con una página y conecta sus formularios con Flow Core.</p>
        <button type="button" class="sites-primary" @click="openCreate"><Plus />Crear sitio</button>
      </div>
    </section>

    <div v-if="createOpen" class="modal-backdrop" @keydown.esc="createOpen = false">
      <form class="site-modal" @submit.prevent="createSite">
        <header><div><h2>Crear sitio</h2><p>Configura el nombre y la dirección inicial.</p></div><button type="button" aria-label="Cerrar" @click="createOpen = false"><X /></button></header>
        <div class="site-modal-body">
          <label>Nombre<input v-model="form.name" required placeholder="Sitio principal" @blur="toSlug" /></label>
          <label>Subdominio<span class="slug-input"><input v-model="form.slug" required placeholder="mi-empresa" /><span>.flow.site</span></span></label>
          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>
        <footer><button type="button" class="secondary-button" @click="createOpen = false">Cancelar</button><button :disabled="saving" class="sites-primary">{{ saving ? 'Creando…' : 'Crear sitio' }}</button></footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sites-inbox{width:100%;min-height:100%;padding:32px;background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.sites-heading{display:flex;min-height:54px;align-items:flex-start;justify-content:space-between;gap:24px}.sites-heading h1{margin:0;font-size:26px;line-height:1.12;font-weight:700}.sites-heading p{margin:6px 0 0;font-size:14px;line-height:1.35;color:rgb(var(--brand-text-secondary))}.sites-primary{display:inline-flex;height:36px;align-items:center;justify-content:center;gap:7px;border:0;border-radius:4px;background:rgb(var(--brand-orange));padding:0 15px;color:rgb(var(--brand-primary-fg));font-size:13px;font-weight:700;cursor:pointer}.sites-primary:hover{background:rgb(var(--brand-sites-primary-hover))}.sites-primary:disabled{cursor:default;opacity:.6}.sites-primary svg{height:16px;width:16px}
.sites-table{margin-top:20px;width:100%;overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-surface))}.sites-row{display:grid;grid-template-columns:minmax(240px,2fr) minmax(180px,1.35fr) 140px 80px 100px 160px 50px;min-width:950px;align-items:center}.sites-row>div,.sites-row>a{min-width:0;padding:0 16px}.sites-row-head{height:40px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary));font-size:11.5px;font-weight:700;letter-spacing:.3px}.sites-row-data{height:60px;border-bottom:1px solid rgb(var(--brand-border-light));color:rgb(var(--brand-text-secondary));font-size:13px}.sites-row-data:last-child{border-bottom:0}.sites-row-data:hover{background:rgb(var(--brand-sites-row-hover))}
.site-name-cell{display:flex;height:100%;align-items:center;gap:10px;color:rgb(var(--brand-text));font-size:13.5px;font-weight:600;text-decoration:none}.site-icon{display:grid;height:34px;width:34px;flex:0 0 34px;place-items:center;border-radius:4px;background:rgb(var(--brand-info-bg));color:rgb(var(--brand-blue))}.site-icon svg{height:16px;width:16px}.site-domain{overflow:hidden;color:rgb(var(--brand-text-secondary));font-family:"Roboto Mono",Consolas,monospace;font-size:12px;text-decoration:none;text-overflow:ellipsis;white-space:nowrap}
.status-pill{display:inline-flex;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700}.is-published{background:rgb(var(--brand-sites-published-bg));color:rgb(var(--brand-sites-published-text))}.is-draft{background:rgb(var(--brand-kanban-divider));color:rgb(var(--brand-text-secondary))}.is-archived{background:rgb(var(--brand-sites-archived-bg));color:rgb(var(--brand-sites-archived-text))}.site-actions{display:flex;justify-content:center;padding:0!important}.site-actions button{display:grid;height:32px;width:32px;place-items:center;border:0;border-radius:4px;background:transparent;color:rgb(var(--brand-sites-icon));cursor:pointer}.site-actions button:hover{background:rgb(var(--brand-sites-action-hover));color:rgb(var(--brand-text))}.site-actions svg{height:16px;width:16px}
.sites-row-loading{height:60px;border-bottom:1px solid rgb(var(--brand-border-light))}.loading-line,.loading-pill{display:block;height:12px;border-radius:3px;background:rgb(var(--brand-kanban-divider));animation:pulse 1.2s ease-in-out infinite}.loading-pill{height:20px;width:76px;border-radius:999px}@keyframes pulse{50%{opacity:.45}}.sites-state{padding:28px 16px;font-size:13px}.error-state{color:rgb(var(--brand-sites-archived-text))}.sites-empty{display:flex;min-height:280px;align-items:center;justify-content:center;flex-direction:column;padding:40px;text-align:center}.site-empty-icon{display:grid;height:48px;width:48px;place-items:center;border-radius:8px;background:rgb(var(--brand-info-bg));color:rgb(var(--brand-blue))}.site-empty-icon svg{height:22px;width:22px}.sites-empty strong{margin-top:14px;font-size:15px}.sites-empty p{margin:6px 0 18px;color:rgb(var(--brand-sites-icon));font-size:13px}
.modal-backdrop{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:rgb(var(--brand-shadow) / 0.4);padding:20px}.site-modal{width:min(440px,100%);overflow:hidden;border:1px solid rgb(var(--brand-sites-modal-border));border-radius:8px;background:rgb(var(--brand-surface));box-shadow:0 12px 40px rgb(var(--brand-shadow) / 0.1803921568627451)}.site-modal>header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid rgb(var(--brand-border-light));padding:20px 22px}.site-modal h2{margin:0;font-size:18px}.site-modal header p{margin:4px 0 0;color:rgb(var(--brand-sites-icon));font-size:13px}.site-modal header button{display:grid;height:28px;width:28px;place-items:center;border:0;background:transparent;color:rgb(var(--brand-sites-icon))}.site-modal header svg{height:16px;width:16px}.site-modal-body{display:grid;gap:17px;padding:22px}.site-modal label{display:grid;gap:7px;color:rgb(var(--brand-text));font-size:13px;font-weight:700}.site-modal input{height:38px;width:100%;border:1px solid rgb(var(--brand-control-border));border-radius:4px;padding:0 11px;color:rgb(var(--brand-text));font-size:13px;font-weight:400;outline:none}.site-modal input:focus{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}.slug-input{display:flex;align-items:center}.slug-input input{border-radius:4px 0 0 4px}.slug-input>span{display:flex;height:38px;align-items:center;border:1px solid rgb(var(--brand-control-border));border-left:0;border-radius:0 4px 4px 0;background:rgb(var(--brand-bg));padding:0 10px;color:rgb(var(--brand-sites-icon));font-size:12px;font-weight:400}.form-error{margin:0;border-radius:4px;background:rgb(var(--brand-sites-archived-bg));padding:9px 10px;color:rgb(var(--brand-sites-archived-text));font-size:12px}.site-modal footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-designer-section-bg));padding:14px 22px}.secondary-button{height:36px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 14px;color:rgb(var(--brand-text));font-size:13px;font-weight:600}
@media(max-width:1050px){.sites-table{overflow-x:auto}}@media(max-width:640px){.sites-inbox{--list-page-gutter-y:20px;--list-page-gutter-x:16px;padding:20px 16px}.sites-heading{align-items:center}.sites-heading p{display:none}}
.site-modal input{background:rgb(var(--brand-surface))}
input,select,textarea{color-scheme:inherit}
</style>

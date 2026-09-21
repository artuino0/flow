<script setup lang="ts">
import { Check, Copy, ExternalLink, Globe2, Plus, RefreshCw, ShieldCheck, Trash2, X } from '@lucide/vue'
const props = defineProps<{ siteId?: string }>()
interface Page { id: string; title: string; path: string; status: string }
interface Site { id: string; name: string; slug: string; status: string; pages?: Page[] }
interface Domain {
  id: string; siteId: string; siteName: string; hostname: string; status: 'pending' | 'active' | 'error'
  isPrimary: boolean; rootPageId: string | null; rootPageTitle: string | null; recordType: 'apex' | 'subdomain'
  dns: { type: 'A' | 'CNAME'; name: string; value: string }; providerConfigured: boolean; lastCheckedAt: string | null
  providerData?: { providerError?: string }
}
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data: sitesData } = await useFetch<{ sites: Site[] }>('/api/sites', { headers })
const domainUrl = computed(() => props.siteId ? `/api/sites/domains?siteId=${props.siteId}` : '/api/sites/domains')
const { data: domainData, pending, error, refresh } = await useFetch<{ domains: Domain[] }>(domainUrl, { headers })
const sites = computed(() => (sitesData.value?.sites ?? []).filter(site => !props.siteId || site.id === props.siteId))
const domains = computed(() => domainData.value?.domains ?? [])
const modalOpen = ref(false)
const saving = ref(false)
const checking = ref<string | null>(null)
const feedback = ref('')
const copied = ref('')
const pages = ref<Page[]>([])
const form = reactive({ siteId: props.siteId ?? '', hostname: '', recordType: 'subdomain' as 'apex' | 'subdomain', rootPageId: '' })

async function loadPages(siteId: string) {
  if (!siteId) { pages.value = []; return }
  try { pages.value = (await $fetch<Site>(`/api/sites/${siteId}`)).pages ?? [] } catch { pages.value = [] }
}
async function openModal() {
  feedback.value = ''
  form.siteId = props.siteId ?? sites.value[0]?.id ?? ''
  form.hostname = ''
  form.recordType = 'subdomain'
  form.rootPageId = ''
  await loadPages(form.siteId)
  form.rootPageId = pages.value.find(page => page.path === '/')?.id ?? ''
  modalOpen.value = true
}
watch(() => form.siteId, async value => {
  if (!modalOpen.value) return
  await loadPages(value)
  form.rootPageId = pages.value.find(page => page.path === '/')?.id ?? ''
})
async function createDomain() {
  saving.value = true; feedback.value = ''
  try {
    await $fetch('/api/sites/domains', { method: 'POST', body: { ...form, rootPageId: form.rootPageId || null } })
    modalOpen.value = false
    await refresh()
  } catch (cause: any) {
    feedback.value = cause?.data?.statusMessage || cause?.statusMessage || 'No se pudo conectar el dominio.'
  } finally { saving.value = false }
}
async function verifyDomain(domain: Domain) {
  checking.value = domain.id; feedback.value = ''
  try {
    const result = await $fetch<Domain>(`/api/sites/domains/${domain.id}/verify`, { method: 'POST' })
    feedback.value = result.status === 'active' ? `${domain.hostname} quedó activo.` : 'El DNS todavía no coincide. GoDaddy puede tardar algunos minutos en propagar el cambio.'
    await refresh()
  } catch (cause: any) { feedback.value = cause?.data?.statusMessage || cause?.statusMessage || 'No se pudo verificar el dominio.' }
  finally { checking.value = null }
}
async function removeDomain(domain: Domain) {
  if (!confirm(`¿Desconectar ${domain.hostname}?`)) return
  try { await $fetch(`/api/sites/domains/${domain.id}`, { method: 'DELETE' }); await refresh() }
  catch (cause: any) { feedback.value = cause?.data?.statusMessage || cause?.statusMessage || 'No se pudo desconectar el dominio.' }
}
async function copyValue(key: string, value: string) {
  await navigator.clipboard.writeText(value); copied.value = key
  window.setTimeout(() => { if (copied.value === key) copied.value = '' }, 1400)
}
function previewUrl(siteId: string, path = '/') { return `/site-preview/${siteId}${path === '/' ? '' : path}` }
</script>

<template>
  <section class="manager">
    <header class="page-header">
      <div><h1>Dominios y URLs</h1><p>Conecta cada dominio con un sitio y publica páginas distintas en sus rutas.</p></div>
      <button class="primary" :disabled="!sites.length" @click="openModal"><Plus /> Conectar dominio</button>
    </header>

    <div v-if="feedback" class="feedback">{{ feedback }}</div>
    <div class="table-wrap">
      <div class="row head"><div>Sitio</div><div>Dirección</div><div>Inicio</div><div>Estado</div><div>Acciones</div></div>
      <div v-if="pending" class="state">Cargando dominios…</div>
      <div v-else-if="error" class="state error">No se pudieron cargar los dominios.</div>
      <template v-else>
        <div v-for="site in sites" :key="`system-${site.id}`" class="row data system-row">
          <div class="site"><span><Globe2 /></span><strong>{{ site.name }}</strong></div>
          <div><a class="domain-link" :href="previewUrl(site.id)" target="_blank">Vista pública <ExternalLink /></a><small>Dirección temporal de prueba</small></div>
          <div>/</div>
          <div><span class="status" :class="{ active: site.status === 'published' }"><i />{{ site.status === 'published' ? 'Publicado' : 'Sin publicar' }}</span></div>
          <div class="actions"><a :href="previewUrl(site.id)" target="_blank" title="Abrir vista pública"><ExternalLink /></a></div>
        </div>
        <div v-for="domain in domains" :key="domain.id" class="domain-block">
          <div class="row data">
            <div class="site"><span><Globe2 /></span><div><strong>{{ domain.siteName }}</strong><small v-if="domain.isPrimary">Dominio principal</small></div></div>
            <div><a class="domain-link" :href="`https://${domain.hostname}`" target="_blank">{{ domain.hostname }} <ExternalLink /></a><small>Dominio personalizado</small></div>
            <div>{{ domain.rootPageTitle || 'Ruta / del sitio' }}</div>
            <div><span class="status" :class="{ active: domain.status === 'active' }"><i />{{ domain.status === 'active' ? 'Activo' : 'Esperando DNS' }}</span></div>
            <div class="actions"><button title="Verificar DNS" :disabled="checking === domain.id" @click="verifyDomain(domain)"><RefreshCw :class="{ spin: checking === domain.id }" /></button><button title="Desconectar" @click="removeDomain(domain)"><Trash2 /></button></div>
          </div>
          <div v-if="domain.status !== 'active'" class="dns-panel"><p v-if="!domain.providerConfigured" class="provider-warning">Configura VERCEL_TOKEN y VERCEL_PROJECT_ID en el servidor antes de cambiar el DNS; así Flow podrá registrar el dominio en el proyecto y emitir su certificado.</p>
            <div><b>En GoDaddy agrega este registro</b><span>DNS → Administrar zonas → Agregar nuevo registro</span></div>
            <label>Tipo<strong>{{ domain.dns.type }}</strong></label>
            <label>Nombre<strong>{{ domain.dns.name }}</strong><button @click="copyValue(`${domain.id}-name`, domain.dns.name)"><Check v-if="copied === `${domain.id}-name`" /><Copy v-else /></button></label>
            <label>Valor<strong>{{ domain.dns.value }}</strong><button @click="copyValue(`${domain.id}-value`, domain.dns.value)"><Check v-if="copied === `${domain.id}-value`" /><Copy v-else /></button></label>
          </div>
        </div>
        <div v-if="!sites.length" class="empty"><ShieldCheck /><strong>No hay sitios configurados</strong></div>
      </template>
    </div>
    <aside class="note"><strong>Cómo se resuelven las rutas</strong><p>El dominio elige el sitio. Dentro del sitio, cada página publicada responde en su ruta: <code>/</code>, <code>/servicios</code>, <code>/contacto</code> o cualquier landing que definas.</p></aside>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop" @click.self="modalOpen = false">
        <form class="modal" @submit.prevent="createDomain">
          <header><div><h2>Conectar dominio</h2><p>Usa un dominio raíz o un subdominio administrado en GoDaddy.</p></div><button type="button" @click="modalOpen = false"><X /></button></header>
          <div class="fields">
            <label v-if="!props.siteId">Sitio<select v-model="form.siteId" required><option value="" disabled>Selecciona un sitio</option><option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option></select></label>
            <label>Dominio<input v-model="form.hostname" required placeholder="www.miempresa.com" autocomplete="off"><small>Sin https:// y sin una ruta.</small></label>
            <fieldset><legend>Tipo de dominio</legend><label class="choice"><input v-model="form.recordType" type="radio" value="subdomain"><span><b>Subdominio</b><small>Ej. www.miempresa.com o promo.miempresa.com</small></span></label><label class="choice"><input v-model="form.recordType" type="radio" value="apex"><span><b>Dominio raíz</b><small>Ej. miempresa.com</small></span></label></fieldset>
            <label>Página para la ruta /<select v-model="form.rootPageId"><option value="">Usar la página que ya tiene la ruta /</option><option v-for="page in pages" :key="page.id" :value="page.id">{{ page.title }} · {{ page.path }}</option></select></label>
            <p v-if="feedback" class="form-error">{{ feedback }}</p>
          </div>
          <footer><button type="button" class="secondary" @click="modalOpen = false">Cancelar</button><button class="primary" :disabled="saving || !form.siteId">{{ saving ? 'Conectando…' : 'Conectar dominio' }}</button></footer>
        </form>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.manager{min-height:100%;width:100%;padding:32px;background:#f5f8fa;color:#33475b}.page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.manager h1{margin:0;font-size:26px;line-height:1.15}.page-header p,.modal header p{margin:6px 0 0;color:#516f90;font-size:14px}.primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;border:0;border-radius:6px;background:#ff7a59;padding:0 16px;color:#fff;font-weight:700}.primary:hover{background:#e66e50}.primary:disabled{cursor:not-allowed;opacity:.55}.primary svg{width:16px}.feedback{margin-top:18px;border:1px solid #c9e3e8;border-radius:6px;background:#eaf3f6;padding:11px 14px;color:#16687a;font-size:12px}.table-wrap{margin-top:20px;overflow:hidden;border:1px solid #e5eaf0;border-radius:6px;background:#fff}.row{display:grid;grid-template-columns:minmax(190px,1.15fr) minmax(230px,1.35fr) minmax(140px,.8fr) 150px 96px;min-width:880px;align-items:center}.row>div{min-width:0;padding:0 16px}.head{height:40px;border-bottom:1px solid #e5eaf0;background:#f5f8fa;color:#516f90;font-size:11.5px;font-weight:700}.data{min-height:66px;border-bottom:1px solid #e5eaf0;color:#516f90;font-size:13px}.site{display:flex;align-items:center;gap:10px}.site>span{display:grid;height:34px;width:34px;flex:none;place-items:center;border-radius:4px;background:#eaf3f6;color:#0091ae}.site svg{height:16px;width:16px}.site strong{display:block;color:#33475b}.row small{display:block;margin-top:3px;color:#8da1b5;font-size:10.5px}.domain-link{display:inline-flex;max-width:100%;align-items:center;gap:5px;overflow:hidden;color:#0091ae;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.domain-link svg{width:13px;flex:none}.status{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:#fef0d2;padding:4px 9px;color:#b3720a;font-size:10.5px;font-weight:700}.status i{height:6px;width:6px;border-radius:99px;background:currentColor}.status.active{background:#ccf1de;color:#0a7a4f}.actions{display:flex;gap:5px}.actions button,.actions a{display:grid;height:30px;width:30px;place-items:center;border:0;border-radius:4px;background:transparent;color:#8da1b5}.actions button:hover,.actions a:hover{background:#edf3f7;color:#33475b}.actions svg{height:15px;width:15px}.spin{animation:spin .8s linear infinite}.domain-block:last-of-type .data{border-bottom:0}.dns-panel{display:grid;grid-template-columns:minmax(230px,1fr) 100px minmax(180px,.65fr) minmax(260px,1fr);gap:16px;align-items:center;border-bottom:1px solid #e5eaf0;background:#f8fafc;padding:14px 16px 14px 60px;font-size:11px}.provider-warning{grid-column:1/-1;margin:0;border:1px solid #f3d59a;border-radius:4px;background:#fff8e8;padding:9px 11px;color:#8a5b08;font-size:11px}.dns-panel>div b,.dns-panel>div span{display:block}.dns-panel>div span{margin-top:3px;color:#8da1b5}.dns-panel label{color:#8da1b5}.dns-panel label strong{display:inline-block;margin-top:4px;color:#33475b;font-family:"Roboto Mono",Consolas,monospace;font-size:11px}.dns-panel label button{margin-left:7px;border:0;background:transparent;color:#0091ae}.dns-panel label svg{height:13px;width:13px}.note{margin-top:20px;border:1px solid #d8e8eb;border-radius:6px;background:#eaf3f6;padding:16px 18px}.note strong{font-size:13px}.note p{margin:5px 0 0;color:#516f90;font-size:12px;line-height:1.6}.note code{border-radius:3px;background:#fff;padding:2px 4px}.state{padding:28px 16px;color:#516f90;font-size:13px}.state.error,.form-error{color:#c7391f}.empty{display:grid;min-height:220px;place-items:center;text-align:center}.empty svg{height:26px;color:#0091ae}.backdrop{position:fixed;z-index:200;inset:0;display:grid;place-items:center;background:rgba(25,49,74,.38);padding:20px}.modal{width:min(540px,100%);overflow:hidden;border:1px solid #dbe3eb;border-radius:8px;background:#fff;box-shadow:0 18px 50px rgba(25,49,74,.18)}.modal>header{display:flex;justify-content:space-between;border-bottom:1px solid #e5eaf0;padding:20px 22px}.modal h2{margin:0;font-size:19px}.modal header button{border:0;background:transparent;color:#8da1b5}.modal header svg{width:18px}.fields{display:grid;gap:17px;padding:22px}.fields>label,.fields legend{color:#33475b;font-size:12px;font-weight:700}.fields input:not([type=radio]),.fields select{display:block;width:100%;height:40px;margin-top:7px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;padding:0 11px;color:#33475b}.fields label>small{display:block;margin-top:5px;color:#8da1b5;font-weight:400}.fields fieldset{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:0;padding:0}.fields legend{margin-bottom:7px}.choice{display:flex;gap:9px;border:1px solid #dce4eb;border-radius:6px;padding:12px}.choice:has(input:checked){border-color:#0091ae;background:#f2fafb}.choice span b,.choice span small{display:block}.choice span b{font-size:12px}.choice span small{margin-top:3px;color:#8da1b5;font-size:10px}.modal footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #e5eaf0;padding:15px 22px}.secondary{min-height:40px;border:1px solid #cbd6e2;border-radius:6px;background:#fff;padding:0 16px;color:#33475b;font-weight:600}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:960px){.table-wrap{overflow-x:auto}.dns-panel{min-width:880px}}@media(max-width:640px){.manager{padding:20px 16px}.page-header{align-items:stretch;flex-direction:column}.fields fieldset{grid-template-columns:1fr}}
</style>

<script setup lang="ts">
import { BarChart3, ClipboardList, FileText, Globe2 } from '@lucide/vue'
const props = defineProps<{ siteId?: string }>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const [{ data: pageData, pending }, { data: formData }] = await Promise.all([
  useFetch<{ pages: any[] }>('/api/sites/pages', { headers }),
  useFetch<{ forms: any[] }>('/api/sites/forms', { headers })
])
const pages = computed(() => (pageData.value?.pages ?? []).filter(page => !props.siteId || page.siteId === props.siteId))
const forms = computed(() => (formData.value?.forms ?? []).filter(form => !props.siteId || form.siteId === props.siteId))
const published = computed(() => pages.value.filter(page => page.status === 'published').length)
const sites = computed(() => new Set(pages.value.map(page => page.siteId)).size)
</script>

<template>
  <section class="analytics">
    <header><div><h1>Analítica</h1><p>Rendimiento de contenido y conversiones de Flow Sites.</p></div></header>
    <div class="metrics">
      <article><span><Globe2 /></span><div><small>Sitios con contenido</small><strong>{{ sites }}</strong></div></article>
      <article><span><FileText /></span><div><small>Páginas publicadas</small><strong>{{ published }}</strong></div></article>
      <article><span><ClipboardList /></span><div><small>Formularios detectados</small><strong>{{ forms.length }}</strong></div></article>
      <article><span><BarChart3 /></span><div><small>Envíos registrados</small><strong>0</strong></div></article>
    </div>
    <section class="performance">
      <header><div><h2>Rendimiento por página</h2><p>Las visitas y conversiones aparecerán cuando el runtime público empiece a registrar eventos.</p></div></header>
      <div class="row head"><div>Página</div><div>Estado</div><div>Formularios</div><div>Vistas</div><div>Envíos</div></div>
      <div v-if="pending" class="state">Cargando métricas…</div>
      <template v-else><div v-for="page in pages" :key="page.id" class="row data"><div><strong>{{ page.title }}</strong><small>{{ page.siteName }} · {{ page.path }}</small></div><div>{{ page.status === 'published' ? 'Publicada' : 'Borrador' }}</div><div>{{ page.formCount }}</div><div>—</div><div>—</div></div></template>
      <div v-if="!pending && !pages.length" class="state">Aún no hay páginas para analizar.</div>
    </section>
  </section>
</template>

<style scoped>
.analytics{min-height:100%;width:100%;padding:32px;background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.analytics>header{min-height:54px}.analytics h1{margin:0;font-size:26px;line-height:1.15}.analytics header p{margin:6px 0 0;color:rgb(var(--brand-text-secondary));font-size:14px}.metrics{display:grid;margin-top:20px;grid-template-columns:repeat(4,1fr);gap:16px}.metrics article{display:flex;min-height:100px;align-items:flex-start;gap:12px;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-surface));padding:17px}.metrics article>span{display:grid;height:34px;width:34px;place-items:center;border-radius:4px;background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-blue))}.metrics svg{height:17px;width:17px}.metrics small{display:block;color:rgb(var(--brand-text-secondary));font-size:11.5px;font-weight:700}.metrics strong{display:block;margin-top:7px;font-size:25px}.performance{margin-top:20px;overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-surface))}.performance>header{border-bottom:1px solid rgb(var(--brand-border-light));padding:16px 18px}.performance h2{margin:0;font-size:14px}.performance header p{margin:4px 0 0;font-size:11.5px}.row{display:grid;grid-template-columns:minmax(280px,2fr) 130px 110px 100px 100px;min-width:720px;align-items:center}.row>div{padding:0 16px}.head{height:40px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary));font-size:11.5px;font-weight:700}.data{min-height:60px;border-bottom:1px solid rgb(var(--brand-border-light));color:rgb(var(--brand-text-secondary));font-size:13px}.data:last-child{border-bottom:0}.data strong{display:block;color:rgb(var(--brand-text));font-size:13px}.data small{display:block;margin-top:3px;color:rgb(var(--brand-sites-muted));font-size:11px}.state{padding:28px 16px;color:rgb(var(--brand-sites-muted));font-size:13px}@media(max-width:1000px){.metrics{grid-template-columns:repeat(2,1fr)}.performance{overflow-x:auto}}@media(max-width:640px){.analytics{padding:20px 16px}.metrics{grid-template-columns:1fr}}
</style>

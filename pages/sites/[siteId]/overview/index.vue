<script setup lang="ts">
import { ClipboardList, FileText, Globe2, History, Plus } from '@lucide/vue'
definePageMeta({ layout: 'default', fullBleed: true })
const route = useRoute()
const siteId = String(route.params.siteId)
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const [{ data: site, error }, { data: forms }, { data: publications }] = await Promise.all([
  useFetch<any>('/api/sites/' + siteId, { headers }),
  useFetch<{ forms: any[] }>('/api/sites/' + siteId + '/forms', { headers }),
  useFetch<{ publications: any[] }>('/api/sites/' + siteId + '/publications', { headers })
])
const pages = computed(() => site.value?.pages ?? [])
const published = computed(() => pages.value.filter((page: any) => page.status === 'published').length)
const lastPublication = computed(() => publications.value?.publications?.find(item => item.status === 'published'))
function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin publicar'
}
</script>

<template>
  <div class="min-h-full w-full bg-brand-bg p-8 text-brand-text">
    <div v-if="error" class="border border-red-200 bg-red-50 p-4 text-sm text-red-700">No se pudo cargar el sitio.</div>
    <template v-else-if="site">
      <header class="flex min-h-16 items-start justify-between gap-5">
        <div><NuxtLink to="/sites" class="text-xs font-semibold text-brand-blue">Todos los sitios</NuxtLink><h1 class="mt-1 text-[26px] font-bold leading-tight">{{ site.name }}</h1><p class="mt-1 font-mono text-xs text-brand-text-muted">{{ site.slug }}.flow.site</p></div>
        <NuxtLink :to="'/sites/' + siteId + '/pages'" class="inline-flex h-9 items-center gap-2 rounded bg-brand-orange px-4 text-[13px] font-bold text-white"><Plus class="h-4 w-4" />Nueva página</NuxtLink>
      </header>

      <section class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <NuxtLink :to="'/sites/' + siteId + '/pages'" class="metric"><span><FileText /></span><div><small>Páginas</small><strong>{{ pages.length }}</strong><p>{{ published }} publicadas</p></div></NuxtLink>
        <NuxtLink :to="'/sites/' + siteId + '/forms'" class="metric"><span><ClipboardList /></span><div><small>Formularios</small><strong>{{ forms?.forms?.length ?? 0 }}</strong><p>Detectados</p></div></NuxtLink>
        <NuxtLink :to="'/sites/' + siteId + '/domains'" class="metric"><span><Globe2 /></span><div><small>Dominio</small><strong class="compact">{{ site.slug }}.flow.site</strong><p>{{ site.status === 'published' ? 'Activo' : 'Provisional' }}</p></div></NuxtLink>
        <NuxtLink :to="'/sites/' + siteId + '/publications'" class="metric"><span><History /></span><div><small>Última publicación</small><strong class="compact">{{ formatDate(lastPublication?.updatedAt) }}</strong><p>Ver historial</p></div></NuxtLink>
      </section>

      <section class="mt-5 overflow-hidden rounded-md border border-brand-border-light bg-white">
        <header class="flex items-center justify-between border-b border-brand-border-light px-5 py-4"><div><h2 class="text-sm font-bold">Contenido reciente</h2><p class="mt-1 text-xs text-brand-text-muted">Últimas páginas modificadas.</p></div><NuxtLink :to="'/sites/' + siteId + '/pages'" class="text-xs font-semibold text-brand-blue">Ver todas</NuxtLink></header>
        <NuxtLink v-for="page in pages.slice(0, 8)" :key="page.id" :to="'/sites/' + siteId + '/pages/' + page.id" class="grid min-h-[58px] grid-cols-[34px_1fr_100px] items-center gap-3 border-b border-brand-border-light px-5 last:border-b-0 hover:bg-brand-bg">
          <span class="grid h-[30px] w-[30px] place-items-center rounded bg-brand-blue-bg text-brand-blue"><FileText class="h-4 w-4" /></span>
          <span class="min-w-0"><strong class="block truncate text-[13px]">{{ page.title }}</strong><small class="block truncate text-[11px] text-brand-text-muted">{{ page.path }}</small></span>
          <em class="justify-self-start rounded-full px-2 py-1 text-[10px] font-bold not-italic" :class="page.status === 'published' ? 'bg-brand-success-bg text-brand-success-text' : 'bg-slate-100 text-brand-text-secondary'">{{ page.status === 'published' ? 'Publicada' : 'Borrador' }}</em>
        </NuxtLink>
        <div v-if="!pages.length" class="p-12 text-center text-sm text-brand-text-muted">Este sitio aún no tiene páginas.</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.metric{display:flex;min-height:116px;gap:13px;border:1px solid #e5eaf0;border-radius:6px;background:#fff;padding:18px;color:#33475b;text-decoration:none}.metric>span{display:grid;height:34px;width:34px;flex:0 0 34px;place-items:center;border-radius:4px;background:#eaf3f6;color:#0091ae}.metric svg{height:17px;width:17px}.metric>div{display:flex;min-width:0;flex:1;flex-direction:column}.metric small{color:#516f90;font-size:11.5px;font-weight:700}.metric strong{margin-top:5px;font-size:26px;line-height:1}.metric strong.compact{overflow:hidden;margin-top:9px;font-family:"Roboto Mono",Consolas,monospace;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.metric p{margin:auto 0 0;color:#8da1b5;font-size:11.5px}
</style>

<script setup lang="ts">
import { History, RotateCcw } from '@lucide/vue'

definePageMeta({ layout: 'default', darkReady: true, fullBleed: true })

const route = useRoute()
const siteId = String(route.params.siteId)
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const [{ data: site }, { data, pending, error, refresh }] = await Promise.all([
  useFetch<any>('/api/sites/' + siteId, { headers }),
  useFetch<{ publications: any[] }>('/api/sites/' + siteId + '/publications', { headers })
])

const search = ref('')
const publications = computed(() => data.value?.publications ?? [])
const filteredPublications = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return publications.value
  return publications.value.filter(item =>
    String(item.pageTitle ?? '').toLowerCase().includes(term)
    || String(item.pagePath ?? '').toLowerCase().includes(term)
    || statusLabel(String(item.status)).toLowerCase().includes(term)
  )
})

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
function statusLabel(value: string) {
  if (value === 'published') return 'Publicada'
  if (value === 'superseded') return 'Anterior'
  return 'Borrador'
}
</script>

<template>
  <div class="min-h-full w-full bg-brand-bg p-8 text-brand-text">
    <ListPageHeader
      v-model:search="search"
      title="Publicaciones"
      description="Historial de versiones publicadas y borradores del sitio."
      :breadcrumb="site?.name ? site.name + ' / Publicaciones' : 'Publicaciones'"
      :count="publications.length"
      count-noun="publicación"
      count-noun-plural="publicaciones"
      search-placeholder="Buscar publicaciones..."
      :refreshing="pending"
      @refresh="refresh"
    />

    <section class="mt-5 overflow-hidden rounded-md border border-brand-border-light bg-brand-surface">
      <div class="grid h-10 grid-cols-[minmax(260px,2fr)_80px_120px_180px_46px] items-center border-b border-brand-border-light bg-brand-bg text-[11.5px] font-bold text-brand-text-secondary"><div class="px-4">Página</div><div class="px-4">Versión</div><div class="px-4">Estado</div><div class="px-4">Fecha</div><div /></div>
      <div v-if="pending" class="p-7 text-sm text-brand-sites-muted">Cargando historial…</div>
      <div v-else-if="error" class="p-7 text-sm text-brand-designer-error-action">No se pudo cargar el historial.</div>
      <template v-else-if="filteredPublications.length">
        <div v-for="item in filteredPublications" :key="item.id" class="grid min-h-[60px] grid-cols-[minmax(260px,2fr)_80px_120px_180px_46px] items-center border-b border-brand-border-light text-[13px] text-brand-text-secondary last:border-b-0">
          <div class="px-4"><strong class="block text-brand-text">{{ item.pageTitle }}</strong><small class="text-brand-sites-muted">{{ item.pagePath }}</small></div>
          <div class="px-4">v{{ item.version }}</div>
          <div class="px-4"><span class="rounded-full px-2 py-1 text-[10.5px] font-bold" :class="item.status === 'published' ? 'bg-brand-success-bg text-brand-success-text' : item.status === 'superseded' ? 'bg-brand-blue-bg text-brand-blue' : 'bg-brand-sites-draft-bg text-brand-text-secondary'">{{ statusLabel(item.status) }}</span></div>
          <div class="px-4">{{ formatDate(item.updatedAt) }}</div>
          <div class="grid place-items-center"><NuxtLink :to="'/sites/' + siteId + '/pages/' + item.pageId" class="grid h-8 w-8 place-items-center rounded text-brand-sites-muted hover:bg-brand-bg" aria-label="Abrir versión"><RotateCcw class="h-4 w-4" /></NuxtLink></div>
        </div>
      </template>
      <div v-else class="grid min-h-[280px] place-items-center text-center"><div><History class="mx-auto h-7 w-7 text-brand-blue" /><strong class="mt-3 block text-sm">{{ publications.length ? 'No hay coincidencias' : 'Aún no hay publicaciones' }}</strong><p class="mt-1 text-xs text-brand-sites-muted">{{ publications.length ? 'Prueba con otra búsqueda.' : 'Publica una página para iniciar el historial.' }}</p></div></div>
    </section>
  </div>
</template>

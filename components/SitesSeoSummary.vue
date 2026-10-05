<script setup lang="ts">
import type { SiteSeoAudit } from '~/utils/siteSeoAudit'
const props = defineProps<{ siteId: string }>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, error, pending, refresh } = await useFetch<{ pages: Array<SiteSeoAudit & { id: string; title: string }> }>(`/api/sites/${props.siteId}/seo-audit`, { headers })
</script>
<template>
  <details class="mb-5 rounded border border-brand-border-light bg-brand-surface p-4 text-brand-text">
    <summary class="cursor-pointer font-semibold">SEO del sitio · {{ data?.pages.length ?? 0 }} páginas</summary>
    <p class="mt-2 text-xs text-brand-text-secondary">Estado del contenido guardado. Completar los puntos técnicos no garantiza una posición en Google.</p>
    <p v-if="pending" role="status" class="mt-3 text-sm">Analizando…</p>
    <button v-else-if="error" type="button" class="mt-3 text-sm text-brand-blue underline" @click="refresh()">No se pudo cargar. Reintentar</button>
    <ul v-else class="mt-3 divide-y divide-brand-border-light text-sm">
      <li v-for="page in data?.pages" :key="page.id" class="flex flex-wrap justify-between gap-2 py-3"><NuxtLink :to="`/sites/${siteId}/pages/${page.id}`" class="text-brand-blue underline">{{ page.title }}</NuxtLink><span>✓ {{ page.ready }} de {{ page.total }} listos · {{ page.items.filter(item => item.state === 'falta').length }} pendientes</span></li>
    </ul>
  </details>
</template>

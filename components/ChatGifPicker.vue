<script setup lang="ts">
import { LoaderCircle, Search, X } from '@lucide/vue'

interface GifResult { id: string; title: string; url: string; width: number; height: number }
const emit = defineEmits<{ select: [gif: GifResult]; close: [] }>()
const query = ref('')
const results = ref<GifResult[]>([])
const loading = ref(false)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

async function search() {
  const term = query.value.trim()
  if (!term) { results.value = []; return }
  loading.value = true; error.value = ''
  try { results.value = (await $fetch<{ data: GifResult[] }>('/api/chat/gifs', { query: { q: term } })).data }
  catch (err: any) { error.value = err?.data?.statusMessage || 'No se pudieron cargar los GIFs' }
  finally { loading.value = false }
}
function onInput() { if (timer) clearTimeout(timer); timer = setTimeout(() => void search(), 350) }
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <div class="absolute bottom-full left-0 z-40 mb-2 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-lg border border-brand-border-light bg-white shadow-[0_8px_24px_#33475B22]">
    <header class="flex items-center justify-between border-b border-brand-border-light px-3 py-2.5"><span class="text-xs font-bold text-brand-text">Buscar GIF</span><button type="button" aria-label="Cerrar GIFs" @click="emit('close')"><X class="h-4 w-4 text-brand-text-muted" /></button></header>
    <div class="border-b border-brand-border-light p-2"><div class="flex h-9 items-center gap-2 rounded border border-brand-border px-2"><Search class="h-3.5 w-3.5 text-brand-text-muted" /><input v-model="query" autofocus class="min-w-0 flex-1 text-xs outline-none" placeholder="Busca una reacción..." @input="onInput" @keydown.enter.prevent="search" /></div></div>
    <div class="max-h-64 overflow-y-auto p-2"><div v-if="loading" class="flex justify-center py-8"><LoaderCircle class="h-5 w-5 animate-spin text-brand-blue" /></div><p v-else-if="error" class="px-2 py-6 text-center text-xs text-brand-error-text">{{ error }}</p><p v-else-if="query && !results.length" class="px-2 py-6 text-center text-xs text-brand-text-muted">No encontramos GIFs.</p><div v-else class="grid grid-cols-3 gap-1.5"><button v-for="gif in results" :key="gif.id" type="button" class="h-20 overflow-hidden rounded bg-brand-bg hover:ring-2 hover:ring-brand-blue" :title="gif.title" @click="emit('select', gif)"><img :src="gif.url" :alt="gif.title" class="h-full w-full object-cover" loading="lazy" /></button></div></div>
    <p class="border-t border-brand-border-light px-3 py-1.5 text-[9px] text-brand-text-muted">Powered by GIPHY · contenido con clasificación G</p>
  </div>
</template>

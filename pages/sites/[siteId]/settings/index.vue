<script setup lang="ts">
import { Check, Globe2, Save, Settings2 } from '@lucide/vue'

definePageMeta({ layout: 'default', darkReady: true })
interface Site { id: string; name: string; slug: string; locale: string; status: string }
const route = useRoute()
const siteId = route.params.siteId as string
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data: site, error, refresh } = await useFetch<Site>(() => `/api/sites/${siteId}`, { headers })
const form = reactive({ name: '', slug: '', locale: 'es-MX' })
const saving = ref(false)
const saved = ref(false)
const toast = useToast()
const siteEndpoint: string = '/api/sites/' + siteId
watch(site, value => { if (value) Object.assign(form, { name: value.name, slug: value.slug, locale: value.locale }) }, { immediate: true })
async function save() {
  saving.value = true; saved.value = false
  try { await $fetch(siteEndpoint, { method: 'PUT', body: form }); await refresh(); saved.value = true; toast.updated('Sitio actualizado', 'La configuración quedó guardada.') }
  catch (err: any) { toast.error('No se pudo guardar', err?.data?.statusMessage) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-5 py-7 lg:px-8">
    <header class="border-b border-brand-border-light pb-6"><p class="text-xs font-bold uppercase tracking-[.14em] text-brand-orange">{{ site?.name || 'Sites' }}</p><h1 class="mt-1 text-3xl font-bold text-brand-text">Configuración</h1><p class="mt-2 text-sm text-brand-text-secondary">Define la identidad interna y la dirección base del sitio.</p></header>
    <div v-if="error" class="mt-6 rounded-lg border border-brand-designer-error-border bg-brand-designer-error-bg px-5 py-4 text-sm text-brand-designer-error-action">No se pudo cargar la configuración.</div>
    <form v-else class="mt-7 overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface" @submit.prevent="save">
      <div class="flex items-start gap-3 border-b border-brand-border-light px-6 py-5"><span class="grid h-10 w-10 place-items-center rounded-md bg-brand-blue-bg text-brand-blue"><Settings2 class="h-5 w-5" /></span><div><h2 class="font-bold text-brand-text">Información general</h2><p class="mt-1 text-xs text-brand-sites-muted">Estos datos no cambian el contenido de las páginas.</p></div></div>
      <div class="grid gap-5 px-6 py-6 sm:grid-cols-2"><label class="text-sm font-semibold text-brand-text sm:col-span-2">Nombre del sitio<input v-model="form.name" required maxlength="120" class="mt-2 w-full rounded border border-brand-control-border bg-brand-surface px-3 py-2.5 font-normal outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue" /></label><label class="text-sm font-semibold text-brand-text">Slug<input v-model="form.slug" required class="mt-2 w-full rounded border border-brand-control-border bg-brand-surface px-3 py-2.5 font-normal outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue" /><span class="mt-1.5 block text-xs font-normal text-brand-sites-muted">Minúsculas, números y guiones.</span></label><label class="text-sm font-semibold text-brand-text">Idioma<select v-model="form.locale" class="mt-2 w-full rounded border border-brand-control-border bg-brand-surface px-3 py-2.5 font-normal outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue"><option value="es-MX">Español (México)</option><option value="es-ES">Español (España)</option><option value="en-US">English (United States)</option></select></label><div class="rounded-md border border-brand-border-light bg-brand-bg p-4 sm:col-span-2"><div class="flex items-center gap-2 text-sm font-semibold text-brand-text"><Globe2 class="h-4 w-4 text-brand-blue" />Dirección provisional</div><p class="mt-2 text-xs text-brand-sites-muted">{{ form.slug || 'mi-sitio' }}.sites.flow.local</p></div></div>
      <footer class="flex items-center justify-end gap-3 border-t border-brand-border-light bg-brand-bg/60 px-6 py-4"><span v-if="saved" class="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold text-brand-sites-saved"><Check class="h-3.5 w-3.5" />Cambios guardados</span><button :disabled="saving" class="inline-flex items-center gap-2 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg disabled:opacity-60"><Save class="h-4 w-4" />{{ saving ? 'Guardando…' : 'Guardar cambios' }}</button></footer>
    </form>
  </div>
</template>

<style scoped>
input,select{color-scheme:inherit}
</style>

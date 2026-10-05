<script setup lang="ts">
import type { SiteSeo } from '~/utils/siteSeo'
import type { SiteSeoAudit } from '~/utils/siteSeoAudit'
const props = defineProps<{ modelValue: SiteSeo; siteId: string; pageTitle: string; pagePath: string; saving: boolean; audit?: SiteSeoAudit; auditError?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SiteSeo]; save: [] }>()
const fields = [
  { key: 'title', id: 'seo-title', label: 'Título en buscadores', max: 70 },
  { key: 'description', id: 'seo-description', label: 'Descripción en buscadores', max: 180 },
  { key: 'ogTitle', id: 'seo-ogTitle', label: 'Título al compartir', max: 70 },
  { key: 'ogDescription', id: 'seo-ogDescription', label: 'Descripción al compartir', max: 180 }
] as const
function change(key: keyof SiteSeo, value: string | boolean) {
  const next = { ...props.modelValue }
  if (value === '') delete next[key]
  else Object.assign(next, { [key]: value })
  emit('update:modelValue', next)
}
interface Asset { id: string; fileName: string; mimeType: string; publicUrl: string }
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data: assetData, error: assetError } = await useFetch<{ assets: Asset[] }>(`/api/sites/${props.siteId}/assets`, { headers })
const assets = computed(() => assetData.value?.assets.filter(asset => ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(asset.mimeType)) ?? [])
const image = computed(() => assets.value.find(asset => asset.id === props.modelValue.ogImageAssetId))
const searchTitle = computed(() => props.modelValue.title || props.pageTitle)
const searchDescription = computed(() => props.modelValue.description || '')
</script>
<template>
  <section class="seo-panel" aria-labelledby="seo-heading">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-light pb-4"><div><h2 id="seo-heading" class="text-lg font-bold">SEO y compartir</h2><p class="mt-1 text-xs text-brand-text-secondary">Los campos vacíos respetan las etiquetas de tu HTML. Guarda y publica para aplicar los cambios.</p></div><button type="button" :disabled="saving" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg disabled:opacity-60" @click="emit('save')">{{ saving ? 'Guardando…' : 'Guardar borrador' }}</button></header>
    <div class="grid min-w-0 gap-8 py-5 lg:grid-cols-2">
      <div class="grid min-w-0 gap-5">
        <label v-for="field in fields" :key="field.key" :for="field.id" class="text-sm font-semibold">{{ field.label }}<input :id="field.id" :value="modelValue[field.key] ?? ''" :maxlength="field.max" :aria-describedby="`${field.id}-count`" class="seo-input" @input="change(field.key, ($event.target as HTMLInputElement).value)"><span :id="`${field.id}-count`" class="mt-1 block text-xs font-normal text-brand-text-secondary">{{ modelValue[field.key]?.length ?? 0 }} / {{ field.max }} caracteres</span></label>
        <label for="seo-image" class="text-sm font-semibold">Imagen social<select id="seo-image" :value="modelValue.ogImageAssetId ?? ''" class="seo-input" @change="change('ogImageAssetId', ($event.target as HTMLSelectElement).value)"><option value="">Respetar el HTML de la página</option><option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.fileName }}</option></select><span v-if="image" class="mt-1 block text-xs font-normal text-brand-text-secondary">Texto alternativo: {{ image.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') }}</span><span v-if="assetError" role="alert" class="block text-xs text-brand-error-text">No se pudieron cargar las imágenes.</span></label>
        <label for="seo-twitter" class="text-sm font-semibold">Tarjeta de Twitter<select id="seo-twitter" :value="modelValue.twitterCard ?? ''" class="seo-input" @change="change('twitterCard', ($event.target as HTMLSelectElement).value)"><option value="">Automática / HTML del autor</option><option value="summary">Resumen</option><option value="summary_large_image">Imagen grande</option></select></label>
        <label for="seo-canonical" class="text-sm font-semibold">Ruta canónica opcional<input id="seo-canonical" :value="modelValue.canonicalPath ?? ''" maxlength="220" placeholder="/servicios" aria-describedby="seo-canonical-help" class="seo-input" @input="change('canonicalPath', ($event.target as HTMLInputElement).value)"><span id="seo-canonical-help" class="mt-1 block text-xs font-normal text-brand-text-secondary">Solo una ruta de este sitio. Flow calcula el dominio principal.</span></label>
        <label class="flex items-center gap-2 text-sm"><input id="seo-noindex" type="checkbox" :checked="modelValue.noindex === true" @change="change('noindex', ($event.target as HTMLInputElement).checked)">No mostrar esta página en buscadores (noindex)</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" :checked="modelValue.nofollow === true" @change="change('nofollow', ($event.target as HTMLInputElement).checked)">No seguir los enlaces de esta página (nofollow)</label>
      </div>
      <div class="min-w-0 space-y-6">
        <div><h3 class="mb-2 text-sm font-semibold">Vista previa de búsqueda</h3><div class="rounded border border-brand-border-light p-4"><p class="break-all text-xs text-brand-text-secondary">Dominio principal · {{ pagePath }}</p><p class="mt-2 break-words text-lg text-brand-blue">{{ searchTitle }}</p><p class="mt-1 break-words text-sm text-brand-text-secondary">{{ searchDescription || 'Añade una descripción para explicar el contenido.' }}</p></div></div>
        <div><h3 class="mb-2 text-sm font-semibold">Vista previa al compartir</h3><div class="overflow-hidden rounded border border-brand-border-light"><img v-if="image" :src="image.publicUrl" :alt="image.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')" class="aspect-[1.91] w-full object-cover"><div class="p-4"><p class="break-words font-semibold">{{ modelValue.ogTitle || searchTitle }}</p><p class="mt-1 break-words text-sm text-brand-text-secondary">{{ modelValue.ogDescription || searchDescription }}</p></div></div></div>
        <ul class="space-y-1 text-xs text-brand-warning-text" role="status"><li v-if="!searchDescription">△ Falta una descripción en el panel; revisa también el HTML.</li><li v-if="searchTitle.length > 60">△ El título podría cortarse en los resultados.</li><li v-if="modelValue.noindex">△ Google no mostrará esta página.</li></ul>
        <SitesSeoChecklist :audit="audit" :error="auditError" />
      </div>
    </div>
  </section>
</template>
<style scoped>
.seo-panel{min-height:0;flex:1;overflow:auto;background:rgb(var(--brand-surface));color:rgb(var(--brand-text));padding:24px}.seo-input{display:block;width:100%;min-width:0;margin-top:8px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:10px;color:rgb(var(--brand-text));font-weight:400;color-scheme:inherit}.seo-panel :is(input,select,button,a,summary):focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:2px}@media(max-width:720px){.seo-panel{padding:16px;flex:none;overflow:visible}}
</style>

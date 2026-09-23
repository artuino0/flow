<script setup lang="ts">
import { Check, Copy, ImagePlus, LoaderCircle } from '@lucide/vue'

const props = defineProps<{ siteId: string }>()
interface Asset { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string; publicUrl: string }
const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const copied = ref<string | null>(null)
const errorMessage = ref('')
const toast = useToast()
const { data, refresh } = await useFetch<{ assets: Asset[] }>(() => `/api/sites/${props.siteId}/assets`)

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
async function copyUrl(asset: Asset) {
  await navigator.clipboard.writeText(asset.publicUrl)
  copied.value = asset.id
  window.setTimeout(() => { if (copied.value === asset.id) copied.value = null }, 1600)
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || uploading.value) return
  uploading.value = true
  errorMessage.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    const asset = await $fetch<Asset>(`/api/sites/${props.siteId}/assets`, { method: 'POST', body })
    await refresh()
    await copyUrl(asset)
    toast.success('Asset cargado', 'La URL se copió para pegarla en tu HTML o CSS.')
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || 'No se pudo subir el archivo.'
  } finally {
    uploading.value = false
    if (input.value) input.value.value = ''
  }
}
</script>

<template>
  <section class="asset-library">
    <div class="asset-heading"><div><strong>Assets del sitio</strong><p>Imágenes y fuentes públicas.</p></div><button type="button" :disabled="uploading" @click="input?.click()"><LoaderCircle v-if="uploading" class="spin" /><ImagePlus v-else />{{ uploading ? 'Subiendo' : 'Subir' }}</button></div>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,font/woff,font/woff2,application/font-woff,application/font-woff2" class="hidden" @change="upload" />
    <p v-if="errorMessage" class="asset-error">{{ errorMessage }}</p>
    <p v-else-if="!data?.assets.length" class="asset-empty">Sube un archivo y pega su URL en <code>src</code>, <code>href</code> o <code>url()</code>.</p>
    <ul v-else class="asset-list"><li v-for="asset in data.assets" :key="asset.id"><span class="asset-thumb"><img v-if="asset.mimeType.startsWith('image/')" :src="asset.publicUrl" alt="" /></span><span class="asset-info"><strong :title="asset.fileName">{{ asset.fileName }}</strong><small>{{ formatSize(asset.sizeBytes) }}</small></span><button type="button" :aria-label="`Copiar URL de ${asset.fileName}`" @click="copyUrl(asset)"><Check v-if="copied === asset.id" /><Copy v-else /></button></li></ul>
  </section>
</template>

<style scoped>
.asset-library{margin-top:18px;border-top:1px solid #e5eaf0;padding-top:15px}.asset-heading{display:flex;align-items:start;justify-content:space-between;gap:8px}.asset-heading strong{font-size:11px}.asset-heading p{margin:3px 0 0;color:#8da1b5;font-size:10px;line-height:1.4}.asset-heading button{display:flex;height:27px;align-items:center;gap:4px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;padding:0 7px;color:#516f90;font-size:10px;font-weight:700}.asset-heading button:hover{border-color:#91c8d3;color:#007f98}.asset-heading button:disabled{opacity:.65}.asset-heading svg{height:12px;width:12px}.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.asset-empty,.asset-error{margin:10px 0 0;color:#8da1b5;font-size:10px;line-height:1.5}.asset-error{color:#c7391f}.asset-empty code{color:#516f90}.asset-list{display:grid;gap:6px;margin:10px 0 0;padding:0;list-style:none}.asset-list li{display:flex;min-width:0;align-items:center;gap:7px}.asset-thumb{display:grid;height:27px;width:27px;flex:0 0 27px;place-items:center;overflow:hidden;border:1px solid #e5eaf0;border-radius:4px;background:#f5f8fa}.asset-thumb img{height:100%;width:100%;object-fit:cover}.asset-info{display:flex;min-width:0;flex:1;flex-direction:column;gap:1px}.asset-info strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.asset-info small{color:#8da1b5;font-size:9px}.asset-list button{display:grid;height:25px;width:25px;place-items:center;border:0;border-radius:4px;background:transparent;color:#7c98b6}.asset-list button:hover{background:#edf3f7;color:#007f98}.asset-list svg{height:12px;width:12px}
</style>

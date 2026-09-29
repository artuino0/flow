<script setup lang="ts">
import { FileText } from '@lucide/vue'
import { formatFileSize } from '~/utils/fieldValueFormat'

const props = withDefaults(defineProps<{
  fileId: string
  compact?: boolean
}>(), { compact: false })

interface FileMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

const meta = ref<FileMeta | null>(null)
const loading = ref(true)
const unavailable = ref(false)
let requestVersion = 0
const mounted = ref(false)

async function loadMeta(id: string) {
  const version = ++requestVersion
  meta.value = null
  unavailable.value = false
  if (!id) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await $fetch<FileMeta>(`/api/files/${encodeURIComponent(id)}/meta`)
    if (version === requestVersion) meta.value = result
  } catch {
    if (version === requestVersion) unavailable.value = true
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

onMounted(() => {
  mounted.value = true
  void loadMeta(props.fileId)
})
watch(() => props.fileId, (id) => {
  if (mounted.value) void loadMeta(id)
})

const fileUrl = computed(() => meta.value ? `/api/files/${encodeURIComponent(meta.value.id)}` : '')
const isImage = computed(() => Boolean(meta.value?.mimeType.startsWith('image/')))
</script>

<template>
  <span v-if="loading" class="text-xs font-normal text-brand-text-muted" aria-live="polite">Cargando archivo…</span>
  <span v-else-if="unavailable || !meta" class="text-xs font-normal text-brand-text-muted">Archivo no disponible</span>
  <span v-else-if="isImage" class="inline-flex min-w-0 flex-col items-start gap-1 align-middle">
    <a
      :href="fileUrl"
      target="_blank"
      rel="noopener"
      class="block overflow-hidden rounded border border-brand-border-light bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
      :class="compact ? 'h-12 w-[72px]' : 'h-[108px] w-[160px]'"
      :aria-label="`Abrir imagen ${meta.fileName} en tamaño completo`"
      @click.stop
    >
      <img :src="fileUrl" :alt="meta.fileName" class="h-full w-full object-cover" loading="lazy">
    </a>
    <span class="max-w-[220px] truncate text-[11px] font-normal text-brand-text-secondary" :title="`${meta.fileName} · ${formatFileSize(meta.sizeBytes)}`">{{ meta.fileName }} · {{ formatFileSize(meta.sizeBytes) }}</span>
  </span>
  <span v-else class="inline-flex min-w-0 items-center gap-2 align-middle" :class="compact ? 'max-w-[220px]' : 'max-w-full'">
    <FileText class="h-5 w-5 shrink-0 text-brand-text-muted" :stroke-width="1.75" aria-hidden="true" />
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-xs font-semibold text-brand-text" :title="meta.fileName">{{ meta.fileName }}</span>
      <span class="text-[11px] font-normal text-brand-text-muted">{{ formatFileSize(meta.sizeBytes) }}</span>
    </span>
    <a :href="fileUrl" target="_blank" rel="noopener" class="shrink-0 rounded border border-brand-border-light px-2 py-1 text-xs font-semibold text-brand-blue hover:bg-brand-bg" :aria-label="`Ver o descargar ${meta.fileName}`" @click.stop>Ver / descargar</a>
  </span>
</template>

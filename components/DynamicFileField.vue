<script setup lang="ts">
// HU-ERD-78: campo tipo archivo/adjunto - sube un archivo via
// POST /api/files (multipart/form-data), guarda en customData[field.name]
// SOLO el id devuelto (mismo patron que 'relation', ver DynamicRelationField.vue),
// y muestra nombre/tamaño del archivo ya subido (metadata resuelta via
// GET /api/files/:id/meta, separado del binario) con link de descarga y
// boton para quitarlo.
//
// Diseno: sin mock en el .pen para este campo (revisado antes de construir,
// [[pencil-antes-de-frontend]]: ningun Screen menciona "archivo"/"adjunto"/
// "upload") - se construyo siguiendo el mismo lenguaje visual del resto del
// Form Builder (mismo criterio que DynamicRelationField.vue en su momento).
import { ref, computed, watch } from 'vue'
import { FileUp, Paperclip, X } from '@lucide/vue'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

const props = defineProps<{
  field: EntityFieldMeta
  modelValue: unknown
  entityId: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

interface FileMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

const fileMeta = ref<FileMeta | null>(null)
const loadingMeta = ref(false)
const uploading = ref(false)
const error = ref<string | null>(null)

const currentFileId = computed(() => (typeof props.modelValue === 'string' && props.modelValue ? props.modelValue : null))

async function loadMeta(id: string) {
  loadingMeta.value = true
  error.value = null
  try {
    fileMeta.value = await $fetch<FileMeta>(`/api/files/${id}/meta`)
  } catch {
    // Un id guardado que ya no resuelve (archivo borrado, o de un modulo sin
    // permiso) no debe romper el formulario - se muestra vacio, como si no
    // hubiera archivo, y una nueva subida lo reemplaza.
    fileMeta.value = null
  } finally {
    loadingMeta.value = false
  }
}

watch(
  currentFileId,
  (id) => {
    if (id) void loadMeta(id)
    else fileMeta.value = null
  },
  { immediate: true }
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // permite volver a elegir el mismo archivo despues de "Quitar"
  if (!file) return

  error.value = null
  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    const result = await $fetch<FileMeta>('/api/files', {
      method: 'POST',
      query: { entityId: props.entityId },
      body: formData
    })
    fileMeta.value = result
    emit('update:modelValue', result.id)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'No se pudo subir el archivo'
  } finally {
    uploading.value = false
  }
}

function clearFile() {
  fileMeta.value = null
  error.value = null
  emit('update:modelValue', null)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <p v-if="loadingMeta" class="text-sm text-brand-text-muted">Cargando...</p>

    <div v-else-if="fileMeta" class="flex items-center justify-between gap-2 rounded border border-brand-border-light px-3 py-2">
      <a
        :href="`/api/files/${fileMeta.id}`"
        target="_blank"
        rel="noopener"
        class="flex min-w-0 items-center gap-2 text-sm font-semibold text-brand-blue hover:underline"
      >
        <Paperclip class="h-4 w-4 shrink-0" :stroke-width="1.75" />
        <span class="truncate">{{ fileMeta.fileName }}</span>
        <span class="shrink-0 font-normal text-brand-text-muted">({{ formatSize(fileMeta.sizeBytes) }})</span>
      </a>
      <button v-if="!disabled" type="button" class="shrink-0 text-brand-text-muted hover:text-brand-text" @click="clearFile">
        <X class="h-4 w-4" :stroke-width="1.75" />
      </button>
    </div>

    <label
      v-else
      class="flex w-fit cursor-pointer items-center gap-1.5 rounded border border-dashed border-brand-border px-3 py-2 text-sm font-semibold text-brand-text-secondary hover:bg-brand-bg"
      :class="{ 'pointer-events-none opacity-60': disabled || uploading }"
    >
      <FileUp class="h-4 w-4" :stroke-width="1.75" />
      {{ uploading ? 'Subiendo...' : 'Subir archivo' }}
      <input type="file" class="hidden" :disabled="disabled || uploading" @change="onFileChange" />
    </label>

    <p v-if="error" class="text-xs text-brand-error-text">{{ error }}</p>
  </div>
</template>

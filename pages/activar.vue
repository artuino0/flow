<script setup lang="ts">
import { Check, CircleAlert, Copy, FileKey2, ShieldCheck, Upload } from '@lucide/vue'

definePageMeta({ layout: false })
useHead({ title: 'Activar instalación · Flow' })

type LicenseStatus = { required: boolean; activated: boolean; reason?: string; requestCode?: string; customer?: string; expiresAt?: string }
const { data: status, refresh } = await useFetch<LicenseStatus>('/api/license/status')
const route = useRoute()
const redirect = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/login'
})
const licenseText = ref('')
const fileName = ref('')
const errorMessage = ref('')
const copied = ref(false)
const loading = ref(false)

async function copyRequest() {
  if (!status.value?.requestCode) return
  try {
    await navigator.clipboard.writeText(status.value.requestCode)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    errorMessage.value = 'No se pudo copiar. Selecciona el código y cópialo manualmente.'
  }
}

async function selectFile(event: Event) {
  errorMessage.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 32_000) {
    errorMessage.value = 'El archivo de licencia es demasiado grande.'
    return
  }
  fileName.value = file.name
  licenseText.value = await file.text()
}

async function activate() {
  if (!licenseText.value || loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/license/activate', { method: 'POST', body: { license: licenseText.value } })
    await refresh()
    await navigateTo(redirect.value)
  } catch (error: unknown) {
    const failure = error as { data?: { statusMessage?: string } }
    errorMessage.value = failure.data?.statusMessage || 'No se pudo activar la instalación.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-brand-bg px-4 py-12">
    <div class="w-full max-w-[500px] overflow-hidden rounded-lg border border-brand-border-light bg-white shadow-sm">
      <div class="border-b border-brand-border-light px-7 py-6">
        <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-brand-blue-bg text-brand-blue">
          <ShieldCheck class="h-6 w-6" :stroke-width="1.75" />
        </div>
        <h1 class="text-xl font-bold text-brand-text">{{ status?.activated ? 'Renovar licencia' : 'Activar Flow' }}</h1>
        <p class="mt-1 text-sm text-brand-text-secondary">{{ status?.activated ? 'Esta instalación está activa. Puedes cargar una licencia nueva antes del vencimiento.' : 'Esta instalación necesita una licencia para continuar.' }}</p>
      </div>

      <div class="space-y-6 px-7 py-6">
        <div v-if="status?.activated" class="rounded bg-brand-blue-bg px-3 py-2.5 text-[13px] text-brand-text-secondary">
          Licencia de <strong>{{ status.customer }}</strong> · vence el {{ status.expiresAt?.slice(0, 10) }}
        </div>
        <div v-if="status?.reason" class="flex items-start gap-2 rounded bg-brand-blue-bg px-3 py-2.5 text-[13px] text-brand-text-secondary">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" :stroke-width="1.75" />
          <span>{{ status.reason }}</span>
        </div>

        <section>
          <div class="flex items-center gap-2 text-sm font-semibold text-brand-text">
            <span class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue-bg text-xs text-brand-blue">1</span>
            Envía el código de esta instalación
          </div>
          <p class="mt-2 text-[13px] text-brand-text-secondary">Compártelo con quien emite las licencias. No contiene datos de tus usuarios ni registros.</p>
          <div v-if="status?.requestCode" class="mt-3 flex items-stretch gap-2">
            <textarea :value="status.requestCode" readonly rows="2" aria-label="Código de solicitud" class="min-w-0 flex-1 resize-none rounded border border-brand-border bg-brand-bg px-3 py-2 font-mono text-xs text-brand-text focus:outline-none" />
            <button type="button" class="flex shrink-0 items-center gap-1.5 rounded border border-brand-border px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="copyRequest">
              <Check v-if="copied" class="h-4 w-4" /><Copy v-else class="h-4 w-4" />
              {{ copied ? 'Copiado' : 'Copiar' }}
            </button>
          </div>
        </section>

        <section class="border-t border-brand-border-light pt-5">
          <div class="flex items-center gap-2 text-sm font-semibold text-brand-text">
            <span class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue-bg text-xs text-brand-blue">2</span>
            Carga el archivo de licencia
          </div>
          <p class="mt-2 text-[13px] text-brand-text-secondary">Al recibirlo, selecciónalo aquí. No hace falta reinstalar la aplicación.</p>
          <label class="mt-3 flex cursor-pointer items-center gap-3 rounded border border-dashed border-brand-border px-4 py-3 hover:border-brand-blue hover:bg-brand-bg">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-brand-blue-bg text-brand-blue"><FileKey2 class="h-5 w-5" :stroke-width="1.75" /></span>
            <span class="min-w-0 flex-1 truncate text-[13px] text-brand-text">{{ fileName || 'Seleccionar archivo .license' }}</span>
            <Upload class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            <input type="file" accept=".license,.json,application/json" class="sr-only" @change="selectFile" />
          </label>
        </section>

        <p v-if="errorMessage" role="alert" class="rounded bg-brand-error-bg px-3 py-2.5 text-[13px] text-brand-error-text">{{ errorMessage }}</p>
        <button type="button" :disabled="!licenseText || loading" class="w-full rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60" @click="activate">
          {{ loading ? 'Guardando...' : status?.activated ? 'Renovar licencia' : 'Activar instalación' }}
        </button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ChevronDown, Mail, Send, ShieldCheck, RotateCcw, Trash2 } from '@lucide/vue'

interface EmailSettings {
  source: 'database' | 'environment'
  customConfigured: boolean
  configured: boolean
  provider: string
  host: string
  port: number
  security: string
  username: string
  fromEmail: string
  fromName: string
  replyTo: string
  passwordConfigured: boolean
  apiKeyConfigured: boolean
}

const emit = defineEmits<{ dirty: [boolean] }>()
const baseline = ref('')
const toast = useToast()
const open = ref(false)
const saving = ref(false)
const testing = ref(false)
const sending = ref(false)
const deleting = ref(false)
const error = ref('')
const showTestModal = ref(false)
const testTo = ref('')
const { data: settings, pending, refresh } = await useFetch<EmailSettings>('/api/settings/email', { key: 'email-settings', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })

const form = reactive({ provider: 'smtp', host: '', port: 587, security: 'tls', username: '', password: '', fromEmail: '', fromName: 'Flow', replyTo: '' })
const custom = ref(false)

function hydrate(value?: EmailSettings | null) {
  if (!value) return
  custom.value = value.source === 'database'
  form.provider = value.provider || 'smtp'
  form.host = value.host || ''
  form.port = value.port || 587
  form.security = value.security || 'tls'
  form.username = value.username || ''
  form.password = ''
  form.fromEmail = value.fromEmail || ''
  form.fromName = value.fromName || 'Flow'
  form.replyTo = value.replyTo || ''
  baseline.value = JSON.stringify({ custom: custom.value, ...form })
}
watch(settings, hydrate, { immediate: true })

function startCustom() {
  custom.value = true
  if (!settings.value?.customConfigured) form.password = ''
  open.value = true
}

async function save() {
  error.value = ''
  if (!form.password && !settings.value?.passwordConfigured) { error.value = 'La contraseña SMTP es requerida'; return }
  saving.value = true
  try {
    await $fetch('/api/settings/email', { method: 'PUT', body: { ...form, port: Number(form.port), password: form.password || undefined } })
    await refresh()
    toast.updated('Correo saliente guardado', 'La configuración personalizada quedó activa.')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'No se pudo guardar la configuración'
    toast.error('No se pudo guardar la configuración', error.value)
  } finally { saving.value = false }
}

async function testConnection() {
  error.value = ''; testing.value = true
  try { await $fetch('/api/settings/email/test-connection', { method: 'POST' }); toast.success('Conexión exitosa', 'El servidor SMTP respondió correctamente.') }
  catch (err: any) { error.value = err?.data?.statusMessage || 'No se pudo conectar con el servidor SMTP'; toast.error('Conexión fallida', error.value) }
  finally { testing.value = false }
}

async function sendTest() {
  error.value = ''; sending.value = true
  try { await $fetch('/api/settings/email/test-send', { method: 'POST', body: { to: testTo.value } }); showTestModal.value = false; toast.success('Envío de prueba exitoso', `Se envió el correo a ${testTo.value}.`) }
  catch (err: any) { error.value = err?.data?.statusMessage || 'No se pudo enviar el correo de prueba'; toast.error('Envío fallido', error.value) }
  finally { sending.value = false }
}

async function restoreEnvironment() {
  deleting.value = true
  try { await $fetch('/api/settings/email', { method: 'DELETE' }); await refresh(); hydrate(settings.value); toast.updated('Configuración restaurada', 'Flow usará las variables de entorno.') }
  catch (err: any) { error.value = err?.data?.statusMessage || 'No se pudo restaurar la configuración' }
  finally { deleting.value = false }
}
watch(() => JSON.stringify({ custom: custom.value, ...form }), value => emit('dirty', Boolean(baseline.value && value !== baseline.value)))
onBeforeUnmount(() => emit('dirty', false))
</script>

<template>
  <section class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <button type="button" class="flex w-full items-center justify-between gap-4 p-5 text-left" :aria-expanded="open" @click="open = !open">
      <span class="flex min-w-0 items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded bg-brand-blue-bg"><Mail class="h-4 w-4 text-brand-blue" :stroke-width="1.8" /></span><span class="min-w-0"><span class="block text-[15px] font-bold text-brand-text">Correo saliente</span><span class="block truncate text-[13px] text-brand-text-muted">Configura el servicio para invitaciones, notificaciones y automatizaciones</span></span></span>
      <span class="flex shrink-0 items-center gap-3"><span v-if="pending" class="text-xs text-brand-text-muted">Cargando...</span><span v-else class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="settings?.source === 'database' ? 'bg-brand-success-bg text-brand-success-text' : settings?.configured ? 'bg-brand-blue-bg text-brand-blue' : 'bg-brand-warning-bg text-brand-warning-text'">{{ settings?.source === 'database' ? 'Personalizada' : settings?.configured ? 'Usando entorno' : 'Incompleta' }}</span><ChevronDown class="h-4 w-4 text-brand-text-muted transition-transform" :class="{ 'rotate-180': open }" /></span>
    </button>

    <div v-if="open" class="border-t border-brand-border-light p-5">
      <div class="flex flex-col gap-4">
        <div class="rounded border border-brand-border-light bg-brand-bg p-4">
          <div class="flex items-start justify-between gap-4"><div><h3 class="text-[13px] font-bold text-brand-text">Origen de la configuración</h3><p class="mt-1 text-xs text-brand-text-muted">La configuración guardada tiene prioridad sobre las variables de entorno.</p></div><span class="rounded-full bg-brand-blue-bg px-2.5 py-1 text-xs font-semibold text-brand-blue">{{ settings?.source === 'database' ? 'Base de datos' : 'Variables de entorno' }}</span></div>
          <p v-if="settings?.source === 'environment'" class="mt-3 text-xs text-brand-text-secondary">No hay una configuración personalizada. Flow está usando el respaldo del servidor.</p>
          <button v-if="!custom" type="button" class="mt-3 rounded border border-brand-border px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-surface" @click="startCustom">Configurar valores personalizados</button>
          <button v-else type="button" class="mt-3 flex items-center gap-1.5 rounded border border-brand-border px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-surface" :disabled="deleting" @click="restoreEnvironment"><RotateCcw class="h-3.5 w-3.5" />Restaurar valores del entorno</button>
        </div>

        <div v-if="custom" class="flex flex-col gap-4">
          <div class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Proveedor<select v-model="form.provider" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal"><option value="smtp">SMTP personalizado</option></select></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Seguridad<select v-model="form.security" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal"><option value="tls">TLS</option><option value="ssl">SSL</option><option value="none">Sin cifrado</option></select></label></div>
          <div class="grid gap-4 sm:grid-cols-[1fr_140px]"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Host SMTP<input v-model="form.host" type="text" placeholder="smtp.ejemplo.com" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Puerto<input v-model.number="form.port" type="number" min="1" max="65535" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label></div>
          <div class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Usuario<input v-model="form.username" type="text" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Contraseña<input v-model="form.password" type="password" :placeholder="settings?.passwordConfigured ? '•••••••• (sin cambios)' : 'Contraseña SMTP'" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label></div>
          <div class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo remitente<input v-model="form.fromEmail" type="email" placeholder="no-reply@empresa.com" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Nombre del remitente<input v-model="form.fromName" type="text" placeholder="Flow" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label></div>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo de respuesta <span class="text-xs font-normal text-brand-text-muted">Opcional</span><input v-model="form.replyTo" type="email" placeholder="soporte@empresa.com" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label>
          <p class="flex items-center gap-1.5 text-xs text-brand-text-muted"><ShieldCheck class="h-3.5 w-3.5 text-brand-success-text" />Las credenciales se almacenan cifradas y nunca se muestran completas.</p>
          <p v-if="error" class="rounded border border-brand-error-border bg-brand-error-bg px-3 py-2 text-xs text-brand-error-text">{{ error }}</p>
          <div class="flex flex-wrap justify-end gap-2 border-t border-brand-border-light pt-4"><button type="button" class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text" :disabled="testing" @click="testConnection"><Send class="h-3.5 w-3.5" />{{ testing ? 'Probando...' : 'Probar conexión' }}</button><button type="button" class="rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text" @click="showTestModal = true">Enviar correo de prueba</button><button type="button" class="rounded bg-brand-orange px-4 py-2 text-xs font-semibold text-white" :disabled="saving" @click="save">{{ saving ? 'Guardando...' : 'Guardar configuración' }}</button></div>
        </div>
      </div>
    </div>
  </section>

  <div v-if="showTestModal" class="fixed inset-0 z-50 flex items-center justify-center bg-[#1D293980] p-4"><div class="w-full max-w-md rounded-lg border border-brand-border-light bg-brand-surface shadow-xl"><div class="flex items-center justify-between border-b border-brand-border-light p-5"><h2 class="text-base font-bold text-brand-text">Enviar correo de prueba</h2><button type="button" class="text-brand-text-muted" @click="showTestModal = false">×</button></div><form class="flex flex-col gap-4 p-5" @submit.prevent="sendTest"><p class="text-sm text-brand-text-secondary">Se enviará un mensaje usando la configuración activa.</p><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo destinatario<input v-model="testTo" required type="email" placeholder="tu@correo.com" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><div class="flex justify-end gap-2"><button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text" @click="showTestModal = false">Cancelar</button><button type="submit" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white" :disabled="sending">{{ sending ? 'Enviando...' : 'Enviar prueba' }}</button></div></form></div></div>
</template>

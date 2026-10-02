<script setup lang="ts">
import { ChevronDown, Copy, Mail, RefreshCw, Send, ShieldCheck, RotateCcw, TriangleAlert } from '@lucide/vue'

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
  /** La plataforma tiene Amazon SES habilitado: la organización puede registrar su dominio. */
  sesAvailable?: boolean
  ses?: {
    sendingDomain: string
    domainStatus: 'pending' | 'verified' | 'failed'
    sendingStatus: 'enabled' | 'paused' | null
    dnsRecords: Array<{ type: string; name: string; value: string; purpose: string }>
  } | null
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

const form = reactive({ sesDomain: '', provider: 'smtp', host: '', port: 587, security: 'tls', username: '', password: '', fromEmail: '', fromName: 'Flow', replyTo: '' })
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
  form.sesDomain = value.ses?.sendingDomain || ''
  baseline.value = JSON.stringify({ custom: custom.value, ...form })
}
watch(settings, hydrate, { immediate: true })

function startCustom() {
  custom.value = true
  if (!settings.value?.customConfigured) form.password = ''
  open.value = true
}

const refreshing = ref(false)
const domainStatusLabel = { pending: 'Pendiente de verificar', verified: 'Verificado', failed: 'Falló la verificación' } as const

async function saveSes() {
  error.value = ''
  saving.value = true
  try {
    await $fetch('/api/settings/email/ses', { method: 'POST', body: { domain: form.sesDomain, fromEmail: form.fromEmail, fromName: form.fromName, replyTo: form.replyTo } })
    await refresh()
    toast.success('Dominio registrado', 'Publica los registros DNS y pulsa "Verificar ahora".')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'No se pudo registrar el dominio'
    toast.error('No se pudo registrar el dominio', error.value)
  } finally { saving.value = false }
}

async function refreshSes() {
  error.value = ''
  refreshing.value = true
  try {
    const result = await $fetch<{ domainStatus: string; sendingStatus: string | null }>('/api/settings/email/ses/refresh', { method: 'POST' })
    await refresh()
    if (result.domainStatus === 'verified') toast.success('Dominio verificado', result.sendingStatus === 'paused' ? 'Amazon SES tiene pausado el envío de esta organización.' : 'Ya puedes enviar correos desde tu dominio.')
    else toast.updated('Aún sin verificar', 'Los registros DNS pueden tardar en propagarse. Intenta de nuevo en unos minutos.')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'No se pudo consultar el estado'
    toast.error('No se pudo verificar', error.value)
  } finally { refreshing.value = false }
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success('Copiado', 'El valor se copió al portapapeles.') } catch { toast.error('No se pudo copiar', 'Selecciona el texto y cópialo manualmente.') }
}

async function save() {
  if (form.provider === 'ses') return saveSes()
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
  <section class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725)]">
    <button type="button" class="flex w-full items-center justify-between gap-4 p-5 text-left" :aria-expanded="open" @click="open = !open">
      <span class="flex min-w-0 items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded bg-brand-blue-bg"><Mail class="h-4 w-4 text-brand-blue" :stroke-width="1.8" /></span><span class="min-w-0"><span class="block text-[15px] font-bold text-brand-text">Correo saliente</span><span class="block truncate text-[13px] text-brand-text-muted">Configura el servicio para invitaciones, notificaciones y automatizaciones</span></span></span>
      <span class="flex shrink-0 items-center gap-3"><span v-if="pending" class="text-xs text-brand-text-muted">Cargando...</span><span v-else class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="settings?.source === 'database' ? 'bg-brand-success-bg text-brand-success-text' : settings?.configured ? 'bg-brand-blue-bg text-brand-blue' : 'bg-brand-warning-bg text-brand-warning-text'">{{ settings?.source === 'database' ? 'Personalizada' : settings?.configured ? 'Usando entorno' : 'Incompleta' }}</span><ChevronDown class="h-4 w-4 text-brand-text-muted transition-transform" :class="{ 'rotate-180': open }" /></span>
    </button>

    <div v-if="open" class="border-t border-brand-border-light p-5">
      <div class="flex flex-col gap-4">
        <div class="rounded border border-brand-border-light bg-brand-bg p-4">
          <div class="flex items-start justify-between gap-4"><div><h3 class="text-[13px] font-bold text-brand-text">Origen de la configuración</h3><p class="mt-1 text-xs text-brand-text-muted">La configuración guardada tiene prioridad sobre las variables de entorno.</p></div><span class="rounded-full bg-brand-blue-bg px-2.5 py-1 text-xs font-semibold text-brand-blue">{{ settings?.source === 'database' ? 'Base de datos' : 'Variables de entorno' }}</span></div>
          <p v-if="settings?.source === 'environment'" class="mt-3 text-xs text-brand-text-secondary">No hay una configuración personalizada. Flow está usando el respaldo del servidor.</p>
          <button v-if="!custom" type="button" class="mt-3 rounded border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-surface" @click="startCustom">Configurar valores personalizados</button>
          <button v-else type="button" class="mt-3 flex items-center gap-1.5 rounded border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-surface" :disabled="deleting" @click="restoreEnvironment"><RotateCcw class="h-3.5 w-3.5" />Restaurar valores del entorno</button>
        </div>

        <div v-if="custom" class="flex flex-col gap-4">
          <div class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Proveedor<select v-model="form.provider" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal"><option value="smtp">SMTP personalizado</option><option v-if="settings?.sesAvailable || form.provider === 'ses'" value="ses">Amazon SES · dominio propio</option></select></label><label v-if="form.provider === 'smtp'" class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Seguridad<select v-model="form.security" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal"><option value="tls">TLS</option><option value="ssl">SSL</option><option value="none">Sin cifrado</option></select></label></div>
          <div v-if="form.provider === 'smtp'" class="grid gap-4 sm:grid-cols-[1fr_140px]"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Host SMTP<input v-model="form.host" type="text" placeholder="smtp.ejemplo.com" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Puerto<input v-model.number="form.port" type="number" min="1" max="65535" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label></div>
          <div v-if="form.provider === 'smtp'" class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Usuario<input v-model="form.username" type="text" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Contraseña<input v-model="form.password" type="password" :placeholder="settings?.passwordConfigured ? '•••••••• (sin cambios)' : 'Contraseña SMTP'" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label></div>
          <div v-if="form.provider === 'ses'" class="flex flex-col gap-3">
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Dominio de tu empresa<input v-model="form.sesDomain" type="text" placeholder="empresa.com" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /><span class="text-xs font-normal text-brand-text-muted">Los correos saldrán desde este dominio. Amazon SES mide su reputación por separado de otras organizaciones.</span></label>
            <div v-if="settings?.ses" class="flex flex-col gap-3 rounded border border-brand-border-light bg-brand-bg p-4" data-testid="ses-status">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2"><span class="text-[13px] font-bold text-brand-text">{{ settings.ses.sendingDomain }}</span><span class="rounded-full px-2.5 py-0.5 text-xs font-semibold" :class="settings.ses.domainStatus === 'verified' ? 'bg-brand-success-bg text-brand-success-text' : settings.ses.domainStatus === 'failed' ? 'bg-brand-error-bg text-brand-error-text' : 'bg-brand-warning-bg text-brand-warning-text'">{{ domainStatusLabel[settings.ses.domainStatus] }}</span></div>
                <button type="button" class="flex items-center gap-1.5 rounded border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-surface" :disabled="refreshing" @click="refreshSes"><RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': refreshing }" />{{ refreshing ? 'Verificando...' : 'Verificar ahora' }}</button>
              </div>
              <p v-if="settings.ses.sendingStatus === 'paused'" class="flex items-start gap-1.5 rounded border border-brand-error-border bg-brand-error-bg px-3 py-2 text-xs text-brand-error-text"><TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />Amazon SES pausó el envío de esta organización por su reputación (rebotes o quejas). Revisa tus listas de correo y contacta a soporte para reactivarlo.</p>
              <template v-if="settings.ses.domainStatus !== 'verified'">
                <p class="text-xs text-brand-text-secondary">Publica estos registros DNS en tu proveedor de dominio (puede tardar de minutos a 72 horas en propagarse):</p>
                <div class="overflow-x-auto rounded border border-brand-border-light bg-brand-surface"><table class="min-w-full text-xs"><thead class="bg-brand-bg text-left text-brand-text-secondary"><tr><th class="px-3 py-2">Tipo</th><th class="px-3 py-2">Nombre</th><th class="px-3 py-2">Valor</th><th class="w-8" /></tr></thead><tbody class="divide-y divide-brand-border-light"><tr v-for="record in settings.ses.dnsRecords" :key="record.name"><td class="px-3 py-2 font-semibold">{{ record.type }}<span class="block font-normal text-brand-text-muted">{{ record.purpose }}</span></td><td class="break-all px-3 py-2 font-mono">{{ record.name }}</td><td class="break-all px-3 py-2 font-mono">{{ record.value }}</td><td class="px-2"><button type="button" title="Copiar valor" class="rounded p-1 text-brand-text-muted hover:bg-brand-bg hover:text-brand-text" @click="copyText(record.value)"><Copy class="h-3.5 w-3.5" /></button></td></tr></tbody></table></div>
              </template>
              <p v-else class="text-xs text-brand-success-text">Tu dominio está verificado. Los correos de Flow saldrán desde {{ form.fromEmail || 'tu dominio' }}.</p>
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo remitente<input v-model="form.fromEmail" type="email" placeholder="no-reply@empresa.com" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Nombre del remitente<input v-model="form.fromName" type="text" placeholder="Flow" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label></div>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo de respuesta <span class="text-xs font-normal text-brand-text-muted">Opcional</span><input v-model="form.replyTo" type="email" placeholder="soporte@empresa.com" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label>
          <p v-if="form.provider === 'smtp'" class="flex items-center gap-1.5 text-xs text-brand-text-muted"><ShieldCheck class="h-3.5 w-3.5 text-brand-success-text" />Las credenciales se almacenan cifradas y nunca se muestran completas.</p>
          <p v-if="error" class="rounded border border-brand-error-border bg-brand-error-bg px-3 py-2 text-xs text-brand-error-text">{{ error }}</p>
          <div class="flex flex-wrap justify-end gap-2 border-t border-brand-border-light pt-4"><button type="button" class="flex items-center gap-1.5 rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text" :disabled="testing" @click="testConnection"><Send class="h-3.5 w-3.5" />{{ testing ? 'Probando...' : 'Probar conexión' }}</button><button type="button" class="rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text" @click="showTestModal = true">Enviar correo de prueba</button><button type="button" class="rounded bg-brand-orange px-4 py-2 text-xs font-semibold text-brand-primary-fg" :disabled="saving" @click="save">{{ saving ? 'Guardando...' : form.provider === 'ses' ? (settings?.ses ? 'Actualizar dominio' : 'Registrar dominio') : 'Guardar configuración' }}</button></div>
        </div>
      </div>
    </div>
  </section>

  <div v-if="showTestModal" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-settings-overlay/[0.5019607843] p-4"><div class="w-full max-w-md rounded-lg border border-brand-border-light bg-brand-surface shadow-xl"><div class="flex items-center justify-between border-b border-brand-border-light p-5"><h2 class="text-base font-bold text-brand-text">Enviar correo de prueba</h2><button type="button" class="text-brand-text-muted" @click="showTestModal = false">×</button></div><form class="flex flex-col gap-4 p-5" @submit.prevent="sendTest"><p class="text-sm text-brand-text-secondary">Se enviará un mensaje usando la configuración activa.</p><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo destinatario<input v-model="testTo" required type="email" placeholder="tu@correo.com" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal" /></label><div class="flex justify-end gap-2"><button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text" @click="showTestModal = false">Cancelar</button><button type="submit" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg" :disabled="sending">{{ sending ? 'Enviando...' : 'Enviar prueba' }}</button></div></form></div></div>
</template>

<style scoped>
input, textarea, select { color-scheme: inherit; }
</style>

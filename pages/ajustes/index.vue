<script setup lang="ts">
import { ImageUp, Landmark, ReceiptText, RefreshCw, Trash2 } from '@lucide/vue'

definePageMeta({ layout: 'default', darkReady: true })

interface TenantResponse {
  id: string
  name: string
  defaultCurrency: string
  timezone: string
  country: string
  fiscalData: Record<string, unknown>
  hasLogo: boolean
  email: string | null
  phone: string | null
  address: string | null
  idleTimeoutMinutes: number
  idleWarningMinutes: number
}

const toast = useToast()
const { confirm: confirmAction } = useConfirm()
const { data: isAdmin } = await useIsAdmin()
const route = useRoute()
const router = useRouter()
const { fetchMe } = useAuth()
const section = ref(String(route.query.section || (isAdmin.value ? 'organizacion' : 'perfil')))
const settingsHeader = computed(() => ({
  perfil: { title: 'Mi perfil', description: 'Administra tus datos personales y preferencias de acceso.' },
  agenda: { title: 'Agenda', description: 'Configura horarios, bloqueos y disponibilidad.' },
  'mi-horario': { title: 'Mi horario', description: 'Administra tus horas de atención y ausencias.' },
  seguridad: { title: 'Seguridad y sesiones', description: 'Protege tu cuenta y revisa las sesiones activas.' },
  plan: { title: 'Plan y consumo', description: 'Administra tu suscripción, límites y uso de recursos.' },
  organizacion: { title: 'Organización', description: 'Configura los datos generales y fiscales de tu empresa.' },
  identidad: { title: 'Identidad visual', description: 'Personaliza la imagen de tu organización en Flow.' },
  regional: { title: 'Preferencias regionales', description: 'Define la zona horaria, moneda y formatos de tu organización.' },
  facturacion: { title: 'Facturación', description: 'Configura el timbrado fiscal y la relación con tus módulos.' },
  integraciones: { title: 'API e integraciones', description: 'Conecta los servicios que usa tu organización.' },
  grupos: { title: 'Grupos de notificación', description: 'Organiza a las personas que reciben avisos del sistema.' }
}[section.value] || { title: 'Ajustes', description: 'Configura tu organización y las preferencias de trabajo.' }))

async function refreshBilling() {
  await Promise.all([refreshNuxtData('billing-overview'), refreshNuxtData('billing-plans')])
}
const allowed = computed(() => isAdmin.value || ['perfil', 'seguridad', 'agenda', 'mi-horario'].includes(section.value))
watch(() => route.query.section, value => {
  section.value = typeof value === 'string' ? value : (isAdmin.value ? 'organizacion' : 'perfil')
})
function selectSection(id: string) {
  if (id === section.value) return
  if (hasChanges.value) { pendingSection.value = id; return }
  section.value = id
  router.replace({ query: { ...route.query, section: id } })
}function discardAndNavigate() { onDiscard(); childDirty.value = false; const id = pendingSection.value; pendingSection.value = ''; selectSection(id) }


const {
  data: tenant,
  pending,
  error,
  refresh
} = await useFetch<TenantResponse>('/api/tenant', {
  key: 'tenant-settings',
  immediate: Boolean(isAdmin.value),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'MXN - Peso mexicano' },
  { value: 'USD', label: 'USD - Dólar estadounidense' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'ARS', label: 'ARS - Peso argentino' },
  { value: 'COP', label: 'COP - Peso colombiano' },
  { value: 'PEN', label: 'PEN - Sol peruano' },
  { value: 'CLP', label: 'CLP - Peso chileno' },
  { value: 'GTQ', label: 'GTQ - Quetzal guatemalteco' },
  { value: 'BRL', label: 'BRL - Real brasileño' }
]
const TIMEZONE_OPTIONS = [
  { value: 'America/Mexico_City', label: 'Ciudad de México' },
  { value: 'America/Bogota', label: 'Bogotá' },
  { value: 'America/Lima', label: 'Lima' },
  { value: 'America/Santiago', label: 'Santiago' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { value: 'America/Guatemala', label: 'Guatemala' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'America/New_York', label: 'Nueva York' },
  { value: 'UTC', label: 'UTC' }
]

const name = ref('')
const email = ref('')
const phone = ref('')
const address = ref('')
const country = ref('MX')
const idleTimeoutMinutes = ref(30)
const idleWarningMinutes = ref(2)
const timeoutChoice = ref('30')
const snapshot = ref('')
function serialized() { return JSON.stringify({ name: name.value, email: email.value, phone: phone.value, address: address.value, country: country.value, defaultCurrency: defaultCurrency.value, timezone: timezone.value, fiscal: fiscal.value, idleTimeoutMinutes: idleTimeoutMinutes.value, idleWarningMinutes: idleWarningMinutes.value }) }
watch(timeoutChoice, value => { if (value !== 'custom') idleTimeoutMinutes.value = Number(value) })
onBeforeRouteLeave(async () => !hasChanges.value || await confirmAction({ title: 'Cambios sin guardar', message: 'Tienes cambios sin guardar. ¿Quieres descartarlos?', confirmLabel: 'Descartar cambios' }))
function warnBeforeUnload(event: BeforeUnloadEvent) { if (hasChanges.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', warnBeforeUnload))
const regionalPreview = computed(() => {
  try { return { date: new Intl.DateTimeFormat('es-MX', { timeZone: timezone.value, dateStyle: 'long' }).format(new Date('2026-09-13T18:30:00Z')), time: new Intl.DateTimeFormat('es-MX', { timeZone: timezone.value, timeStyle: 'short' }).format(new Date('2026-09-13T18:30:00Z')), amount: new Intl.NumberFormat('es-MX', { style: 'currency', currency: defaultCurrency.value }).format(12500.5) } }
  catch { return { date: '—', time: '—', amount: '—' } }
})
const defaultCurrency = ref('MXN')
const timezone = ref('America/Mexico_City')

interface MxFiscalForm {
  razonSocial: string
  rfc: string
  regimenFiscal: string
  codigoPostal: string
  calle: string
  numeroExterior: string
  numeroInterior: string
  colonia: string
  municipio: string
  estado: string
}
function emptyFiscalForm(): MxFiscalForm {
  return { razonSocial: '', rfc: '', regimenFiscal: '', codigoPostal: '', calle: '', numeroExterior: '', numeroInterior: '', colonia: '', municipio: '', estado: '' }
}
const fiscal = ref<MxFiscalForm>(emptyFiscalForm())

function hydrateForm(t: TenantResponse) {
  name.value = t.name
  email.value = t.email || ''
  phone.value = t.phone || ''
  address.value = t.address || ''
  country.value = t.country
  idleTimeoutMinutes.value = t.idleTimeoutMinutes ?? 30
  idleWarningMinutes.value = t.idleWarningMinutes ?? 2
  timeoutChoice.value = [5,15,30,60,120].includes(idleTimeoutMinutes.value) ? String(idleTimeoutMinutes.value) : 'custom'
  defaultCurrency.value = t.defaultCurrency
  timezone.value = t.timezone
  const fd = t.fiscalData ?? {}
  fiscal.value = {
    razonSocial: (fd.razonSocial as string) ?? '',
    rfc: (fd.rfc as string) ?? '',
    regimenFiscal: (fd.regimenFiscal as string) ?? '',
    codigoPostal: (fd.codigoPostal as string) ?? '',
    calle: (fd.calle as string) ?? '',
    numeroExterior: (fd.numeroExterior as string) ?? '',
    numeroInterior: (fd.numeroInterior as string) ?? '',
    colonia: (fd.colonia as string) ?? '',
    municipio: (fd.municipio as string) ?? '',
    estado: (fd.estado as string) ?? ''
  }
  snapshot.value = serialized()
}
watch(tenant, (t) => t && hydrateForm(t), { immediate: true })
const dirty = computed(() => snapshot.value !== '' && serialized() !== snapshot.value)
const pendingSection = ref('')
const childDirty = ref(false)
const hasChanges = computed(() => dirty.value || childDirty.value)
const { setDirty: setGlobalDirty, setSaveHandler, setDiscardHandler } = useSettingsDirty()
watch(hasChanges, setGlobalDirty, { immediate: true })
onMounted(() => { setSaveHandler(onSave); setDiscardHandler(() => { onDiscard(); childDirty.value = false }) })
onUnmounted(() => { setGlobalDirty(false); setSaveHandler(null); setDiscardHandler(null) })

const isMx = computed(() => country.value === 'MX')

const saving = ref(false)
const saveError = ref('')

async function onSave() {
  saveError.value = ''
  if (!name.value.trim()) {
    saveError.value = 'Escribe el nombre de la organización.'
    return
  }
  saving.value = true
  try {
    if (idleWarningMinutes.value >= idleTimeoutMinutes.value) throw new Error('El aviso debe ser anterior al cierre de sesión.')
    const body: Record<string, unknown> = { name: name.value.trim(), email: email.value.trim() || null, phone: phone.value.trim() || null, address: address.value.trim() || null, country: country.value, defaultCurrency: defaultCurrency.value, timezone: timezone.value, idleTimeoutMinutes: idleTimeoutMinutes.value, idleWarningMinutes: idleWarningMinutes.value }
    if (isMx.value) {
      // Vacío -> null (nullable().optional() en tenantUpdateSchema) en vez de
      // '' - el regex de RFC/código postal se aplica solo cuando el valor es
      // un string no vacío, así que '' rompería la validación de un campo
      // que el usuario dejó sin completar a propósito.
      body.fiscalData = Object.fromEntries(Object.entries(fiscal.value).map(([k, v]) => {
        const normalized = k === 'rfc' ? v.trim().toUpperCase() : v.trim()
        return [k, normalized === '' ? null : normalized]
      }))
    }
    await $fetch('/api/tenant', { method: 'PUT', body })
    await refresh()
    await fetchMe()
    toast.updated('Configuración guardada', 'Los datos de la organización se actualizaron.')
  } catch (err: any) {
    const message = err?.data?.statusMessage
    saveError.value = typeof message === 'string' ? message : (err?.message || 'No se pudo guardar la configuración')
    toast.error('No se pudo guardar la configuración', saveError.value)
  } finally {
    saving.value = false
  }
}

function onDiscard() {
  if (tenant.value) hydrateForm(tenant.value)
  saveError.value = ''
}

// --- Logo ------------------------------------------------------------
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const logoInput = ref<HTMLInputElement | null>(null)
const logoVersion = ref(0)
const uploadingLogo = ref(false)
const logoError = ref('')
const logoSrc = computed(() => (tenant.value?.hasLogo ? `/api/tenant/logo?v=${logoVersion.value}` : null))

function pickLogo() {
  logoInput.value?.click()
}
async function onLogoSelected(event: Event) {
  logoError.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    logoError.value = 'El logo debe ser PNG, JPEG, WEBP o SVG.'
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    logoError.value = 'El logo no puede superar los 2 MB.'
    return
  }
  uploadingLogo.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    await $fetch('/api/tenant/logo', { method: 'POST', body: formData })
    logoVersion.value++
    await refresh()
    toast.updated('Logo actualizado', 'El logo se usa en el encabezado de los reportes imprimibles.')
  } catch (err: any) {
    logoError.value = err?.data?.statusMessage || 'No se pudo subir el logo'
    toast.error('No se pudo subir el logo', logoError.value)
  } finally {
    uploadingLogo.value = false
    if (logoInput.value) logoInput.value.value = ''
  }
}
async function removeLogo() {
  logoError.value = ''
  uploadingLogo.value = true
  try {
    await $fetch('/api/tenant/logo', { method: 'DELETE' })
    logoVersion.value++
    await refresh()
    toast.success('Logo eliminado', 'Los correos utilizarán el logo de Flow.')
  } catch (err: any) {
    logoError.value = err?.data?.statusMessage || 'No se pudo quitar el logo'
    toast.error('No se pudo quitar el logo', logoError.value)
  } finally {
    uploadingLogo.value = false
  }
}

// --- Facturación (PAC) -------------------------------------------------
// Fase B de DOCS/HU_Timbrado_CFDI_PAC.md. Sección admin solo-MX; los datos se
// guardan al acto (botones propios, como el logo), fuera del sistema dirty de
// las otras secciones: la API key y el CSD son write-only y no tiene sentido
// "descartar cambios" de un secreto ya enviado.
interface PacSummary {
  provider: string
  sandbox: boolean
  hasApiKey: boolean
  hasCsd: boolean
  csdCerFileName: string | null
  csdKeyFileName: string | null
  csdValidUntil: string | null
  lastTestAt: string | null
  lastTestOk: boolean | null
}
const pac = ref<PacSummary | null>(null)
const pacLoading = ref(false)
const pacError = ref('')
const pacProvider = ref<'facturapi' | 'lab'>('facturapi')
const pacApiKey = ref('')
const pacSandbox = ref('true')
const pacCsdPassword = ref('')
const pacCerFile = ref<File | null>(null)
const pacKeyFile = ref<File | null>(null)
const pacCerInput = ref<HTMLInputElement | null>(null)
const pacKeyInput = ref<HTMLInputElement | null>(null)
const pacSaving = ref(false)
const pacTesting = ref(false)
const pacUploadingCsd = ref(false)

async function loadPac() {
  pacLoading.value = true
  pacError.value = ''
  try {
    pac.value = await $fetch<PacSummary>('/api/tenant/pac')
    pacSandbox.value = String(pac.value.sandbox)
    pacProvider.value = pac.value.provider === 'lab' ? 'lab' : 'facturapi'
  } catch (err: any) {
    pac.value = null
    pacError.value = err?.data?.statusMessage || 'No se pudo cargar la configuración de facturación'
  } finally {
    pacLoading.value = false
  }
}
watch(section, (s) => { if (s === 'facturacion' && !pac.value && !pacLoading.value) loadPac() }, { immediate: true })

async function savePac() {
  pacSaving.value = true
  pacError.value = ''
  try {
    const body: Record<string, unknown> = { provider: pacProvider.value }
    if (pacProvider.value === 'facturapi') {
      body.sandbox = pacSandbox.value === 'true'
      if (pacApiKey.value.trim()) body.apiKey = pacApiKey.value.trim()
    }
    pac.value = await $fetch<PacSummary>('/api/tenant/pac', { method: 'PUT', body })
    pacApiKey.value = ''
    toast.updated('Configuración guardada', pacProvider.value === 'lab' ? 'El laboratorio local quedó activo: puedes timbrar documentos de prueba sin PAC.' : 'Los datos del proveedor de timbrado se actualizaron.')
  } catch (err: any) {
    pacError.value = err?.data?.statusMessage || 'No se pudo guardar la configuración del PAC'
    toast.error('No se pudo guardar', pacError.value)
  } finally {
    pacSaving.value = false
  }
}

function onPacCerSelected(event: Event) { pacCerFile.value = (event.target as HTMLInputElement).files?.[0] ?? null }
function onPacKeySelected(event: Event) { pacKeyFile.value = (event.target as HTMLInputElement).files?.[0] ?? null }

async function uploadCsd() {
  pacError.value = ''
  if (!pacCerFile.value || !pacKeyFile.value) { pacError.value = 'Selecciona el certificado (.cer) y la llave privada (.key).'; return }
  if (!pacCsdPassword.value.trim()) { pacError.value = 'Escribe la contraseña de la llave privada.'; return }
  pacUploadingCsd.value = true
  try {
    const formData = new FormData()
    formData.append('cer', pacCerFile.value)
    formData.append('key', pacKeyFile.value)
    formData.append('password', pacCsdPassword.value.trim())
    await $fetch('/api/tenant/pac/csd', { method: 'POST', body: formData })
    pacCsdPassword.value = ''
    pacCerFile.value = null
    pacKeyFile.value = null
    if (pacCerInput.value) pacCerInput.value.value = ''
    if (pacKeyInput.value) pacKeyInput.value.value = ''
    await loadPac()
    toast.updated('Certificado cargado', 'El CSD se usará para sellar los CFDI de la organización.')
  } catch (err: any) {
    pacError.value = err?.data?.statusMessage || 'No se pudo subir el certificado'
    toast.error('No se pudo subir el certificado', pacError.value)
  } finally {
    pacUploadingCsd.value = false
  }
}

async function removeCsd() {
  pacError.value = ''
  pacUploadingCsd.value = true
  try {
    await $fetch('/api/tenant/pac/csd', { method: 'DELETE' })
    await loadPac()
    toast.success('Certificado eliminado', 'Podrás subir un CSD nuevo cuando lo necesites.')
  } catch (err: any) {
    pacError.value = err?.data?.statusMessage || 'No se pudo quitar el certificado'
    toast.error('No se pudo quitar el certificado', pacError.value)
  } finally {
    pacUploadingCsd.value = false
  }
}

async function testPac() {
  pacTesting.value = true
  pacError.value = ''
  try {
    const result = await $fetch<{ ok: boolean; message: string }>('/api/tenant/pac/test', { method: 'POST' })
    await loadPac()
    if (result.ok) toast.success('Conexión correcta', result.message)
    else toast.error('Falló la conexión', result.message)
  } catch (err: any) {
    pacError.value = err?.data?.statusMessage || 'No se pudo probar la conexión'
    toast.error('No se pudo probar la conexión', pacError.value)
  } finally {
    pacTesting.value = false
  }
}
</script>


<template>
  <div class="settings-page" :class="{ 'agenda-settings-page': section === 'agenda' || section === 'mi-horario' }">
    <ListPageHeader
      :title="settingsHeader.title"
      :description="settingsHeader.description"
      breadcrumb="Configuración"
      :show-toolbar="false"
    >
      <template v-if="section === 'plan'" #title-help><ModuleTourHelpButton help-id="settings:plan" /></template>
      <template v-if="section === 'plan'" #actions>
        <button data-tour="settings-plan-refresh" type="button" class="settings-button inline-flex items-center gap-1.5" @click="refreshBilling">
          <RefreshCw class="h-3.5 w-3.5" :stroke-width="1.75" />
          Actualizar
        </button>
      </template>
    </ListPageHeader>
    <div class="min-w-0 space-y-5">

        <section v-if="!allowed" class="settings-card"><h2>Acceso restringido</h2><p>Los ajustes de empresa solo están disponibles para administradores.</p><button class="settings-button mt-4" @click="selectSection('perfil')">Ir a mi perfil</button></section>
        <SettingsAgenda v-else-if="section === 'agenda' || section === 'mi-horario'" :own-only="section === 'mi-horario'" @dirty="childDirty = $event" />
        <template v-else-if="section === 'perfil'"><SettingsProfile mode="profile" @dirty="childDirty = $event" @security="selectSection('seguridad')" /><SettingsSessions /><SettingsApiKeys personal /></template>
        <template v-else-if="section === 'seguridad'">
          <form v-if="isAdmin && tenant" class="settings-card" @submit.prevent="onSave">
            <h2>Cierre de sesión por inactividad</h2><p>Protege la información de tu organización cerrando las sesiones cuando no se utiliza el sistema</p>
            <div class="settings-grid mt-6">
              <ReportOptionSelect class="settings-select" label="Cerrar sesión después de" v-model="timeoutChoice" :options="[...[5,15,30,60,120].map(n => ({ value: String(n), label: n + ' minutos' })), { value: 'custom', label: 'Personalizado' }]" />
              <ReportOptionSelect class="settings-select" label="Avisar antes del cierre" :model-value="String(idleWarningMinutes)" @update:model-value="idleWarningMinutes = Number($event)" :options="[1,2,5,10].map(n => ({ value: String(n), label: n + (n === 1 ? ' minuto' : ' minutos') }))" />
              <label v-if="timeoutChoice === 'custom'" class="settings-field">Cantidad de minutos<input v-model.number="idleTimeoutMinutes" type="number" min="5" max="1440" required /><span class="text-xs font-normal text-brand-text-muted">Entre 5 y 1440 minutos.</span></label>
            </div>
            <div class="mt-5 rounded bg-brand-blue-bg p-3 text-xs text-brand-blue">Se mostrará un aviso tras {{ Math.max(0,idleTimeoutMinutes-idleWarningMinutes) }} minutos sin actividad y la sesión se cerrará al llegar a {{ idleTimeoutMinutes }} minutos.</div>
            <p class="mt-3 text-xs">Esta política se aplica a los usuarios de esta organización.</p>
          </form>
          <SettingsProfile mode="security" @dirty="childDirty = $event" /><SettingsSessions />
        </template>
        <template v-else-if="isAdmin">
          <p v-if="pending" role="status" class="text-sm text-brand-text-muted">Cargando ajustes…</p>
          <div v-else-if="error" role="alert" class="settings-card"><p>No se pudo cargar la configuración.</p><button class="settings-button mt-3" @click="refresh()">Reintentar</button></div>
          <template v-else-if="tenant">
            <form v-if="section === 'organizacion'" class="overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface" @submit.prevent="onSave">
              <div class="settings-card border-0"><h2>Información general</h2><p>Datos básicos de tu organización, visibles para tu equipo</p>
                <div class="settings-grid mt-6">
                  <label class="settings-field sm:col-span-2">Nombre de la organización<input v-model="name" required /></label>
                  <label class="settings-field">Correo de contacto<input v-model="email" type="email" /></label>
                  <label class="settings-field">Teléfono<input v-model="phone" type="tel" /></label>
                  <ReportOptionSelect class="settings-select" label="País" v-model="country" :options="[{value:'MX',label:'México'},{value:'US',label:'Estados Unidos'},{value:'CO',label:'Colombia'},{value:'AR',label:'Argentina'},{value:'PE',label:'Perú'},{value:'CL',label:'Chile'},{value:'GT',label:'Guatemala'},{value:'BR',label:'Brasil'},{value:'ES',label:'España'}]" />
                  <label class="settings-field sm:col-span-2">Dirección<textarea v-model="address" rows="2" maxlength="1000" /></label>
                </div>
              </div>
        <template v-if="isMx">
          <div class="flex items-center gap-2 border-t border-brand-border-light p-5 pb-0">
            <Landmark class="h-[17px] w-[17px] text-brand-blue" :stroke-width="1.75" />
            <h2 class="text-[15px] font-bold text-brand-text">Datos fiscales</h2>
          </div>
          <p class="px-5 pb-0 pt-0.5 text-[13px] text-brand-text-muted">Se usan como emisor en el encabezado de los reportes imprimibles</p>

          <div class="flex flex-col gap-4 p-5"><label class="settings-field">Razón social<input v-model="fiscal.razonSocial" maxlength="250" /></label>
            <div class="flex gap-4">
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalRfc" class="text-[13px] font-semibold text-brand-text">RFC</label>
                <input id="fiscalRfc" v-model="fiscal.rfc" type="text" placeholder="AAA010101AAA" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm uppercase text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" @input="fiscal.rfc = fiscal.rfc.toUpperCase()" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalRegimen" class="text-[13px] font-semibold text-brand-text">Régimen fiscal</label>
                <input id="fiscalRegimen" v-model="fiscal.regimenFiscal" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-[2] flex-col gap-1.5">
                <label for="fiscalCalle" class="text-[13px] font-semibold text-brand-text">Calle</label>
                <input id="fiscalCalle" v-model="fiscal.calle" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalNumExt" class="text-[13px] font-semibold text-brand-text">N.º exterior</label>
                <input id="fiscalNumExt" v-model="fiscal.numeroExterior" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalNumInt" class="text-[13px] font-semibold text-brand-text">N.º interior</label>
                <input id="fiscalNumInt" v-model="fiscal.numeroInterior" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalColonia" class="text-[13px] font-semibold text-brand-text">Colonia</label>
                <input id="fiscalColonia" v-model="fiscal.colonia" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalCp" class="text-[13px] font-semibold text-brand-text">Código postal</label>
                <input id="fiscalCp" v-model="fiscal.codigoPostal" type="text" inputmode="numeric" maxlength="5" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalMunicipio" class="text-[13px] font-semibold text-brand-text">Municipio</label>
                <input id="fiscalMunicipio" v-model="fiscal.municipio" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalEstado" class="text-[13px] font-semibold text-brand-text">Estado</label>
                <input id="fiscalEstado" v-model="fiscal.estado" type="text" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>
          </div>
        </template>


            </form>
            <template v-else-if="section === 'identidad'">
              <section class="settings-card"><h2>Logo de la organización</h2><p class="mb-6">Se utiliza en reportes y correos enviados por tu organización</p>          <div class="flex items-center gap-4">
            <div class="theme-light flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-brand-border-light bg-brand-bg">
              <img v-if="logoSrc" :src="logoSrc" alt="Logo de la organización" class="h-full w-full object-contain" />
              <span v-else class="text-[10px] text-brand-text-muted">LOGO</span>
            </div>
            <div class="flex flex-1 flex-col gap-1.5">
              <span class="text-[13px] font-semibold text-brand-text">Logo</span>
              <p class="text-xs text-brand-text-muted">Aparece en el encabezado de los reportes imprimibles. PNG, JPEG, WEBP o SVG, hasta 2 MB.</p>
              <p v-if="logoError" class="text-xs text-brand-error-text">{{ logoError }}</p>
              <div class="flex gap-2">
                <button
                  type="button"
                  :disabled="uploadingLogo"
                  class="rounded border border-brand-border px-3 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-60"
                  @click="pickLogo"
                >
                  <span class="flex items-center gap-1.5"><ImageUp class="h-3.5 w-3.5" :stroke-width="1.75" />{{ tenant?.hasLogo ? 'Cambiar' : 'Subir logo' }}</span>
                </button>
                <button
                  v-if="tenant?.hasLogo"
                  type="button"
                  :disabled="uploadingLogo"
                  class="rounded border border-brand-border px-3 py-1.5 text-xs font-semibold text-brand-text-secondary hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-60"
                  @click="removeLogo"
                >
                  <span class="flex items-center gap-1.5"><Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />Quitar</span>
                </button>
              </div>
              <input ref="logoInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" @change="onLogoSelected" />
            </div>
          </div>

<p class="mt-4 text-xs">El logo se guarda al subirlo o quitarlo.</p></section>
              <div class="settings-grid">
                <section class="settings-card"><h2>Vista previa en reportes</h2><div class="theme-light mt-4 rounded border border-brand-border-light bg-brand-surface p-5"><img v-if="logoSrc" :src="logoSrc" alt="Logo en reportes" class="mb-3 h-10 max-w-40 object-contain" /><strong class="text-sm">{{ tenant.name }}</strong><hr class="my-3 border-brand-border-light" /><p class="text-xs">Reporte operativo</p><div class="mt-3 h-12 rounded bg-brand-bg" /></div></section>
                <section class="settings-card"><h2>Vista previa en correos</h2><div class="theme-light mt-4 rounded border border-brand-border-light bg-brand-surface p-5"><img v-if="logoSrc" :src="logoSrc" alt="Logo en correos" class="mb-3 h-10 max-w-40 object-contain" /><strong v-else class="text-brand-blue">Flow</strong><h3 class="mt-4 text-sm font-semibold">Notificación de {{ tenant.name }}</h3><p class="mt-2 text-xs">Aquí aparecerá el contenido de tu correo.</p><span class="mt-4 inline-block rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-brand-primary-fg">Ver detalle</span></div></section>
              </div>
            </template>
            <section v-else-if="section === 'regional'" class="settings-card"><h2>Zona horaria y moneda</h2><p>Define cómo se muestran las fechas y los importes de tu organización</p><div class="settings-grid mt-6"><ReportOptionSelect class="settings-select" label="Zona horaria" v-model="timezone" :options="TIMEZONE_OPTIONS" /><ReportOptionSelect class="settings-select" label="Moneda por defecto" v-model="defaultCurrency" :options="CURRENCY_OPTIONS" /></div><div class="mt-6 rounded bg-brand-bg p-4"><h3 class="mb-3 text-sm font-semibold">Vista previa</h3><dl class="grid gap-4 text-sm sm:grid-cols-3"><div><dt class="text-xs text-brand-text-muted">Fecha</dt><dd class="mt-1">{{ regionalPreview.date }}</dd></div><div><dt class="text-xs text-brand-text-muted">Hora</dt><dd class="mt-1">{{ regionalPreview.time }}</dd></div><div><dt class="text-xs text-brand-text-muted">Importe</dt><dd class="mt-1">{{ regionalPreview.amount }}</dd></div></dl></div></section>
            <SettingsBillingSummary v-else-if="section === 'plan'" />
            <template v-else-if="section === 'facturacion'">
              <section class="settings-card">
                <h2>Facturación electrónica (PAC)</h2>
                <p>Conecta tu Proveedor Autorizado de Certificación para timbrar CFDI 4.0 desde Flow</p>
                <p v-if="pacLoading" role="status" class="mt-6 text-sm text-brand-text-muted">Cargando configuración…</p>
                <div v-else-if="!pac && pacError" role="alert" class="mt-4 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ pacError }}</div>
                <template v-else-if="pac">
                  <div class="settings-grid mt-6">
                    <label class="settings-field">Proveedor
                      <select v-model="pacProvider" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue">
                        <option value="facturapi">Facturapi (PAC real)</option>
                        <option value="lab">Laboratorio local Flow (sin PAC, gratis)</option>
                      </select>
                    </label>
                    <ReportOptionSelect v-if="pacProvider === 'facturapi'" class="settings-select" label="Modo" v-model="pacSandbox" :options="[{ value: 'true', label: 'Pruebas (sandbox)' }, { value: 'false', label: 'Producción' }]" />
                    <label v-if="pacProvider === 'facturapi'" class="settings-field sm:col-span-2">API key de Facturapi
                      <input v-model="pacApiKey" type="password" autocomplete="off" :placeholder="pac.hasApiKey ? 'Guardada — escribe una nueva para reemplazarla' : 'Pega tu API key de Facturapi'" />
                      <span class="text-xs font-normal text-brand-text-muted">Se guarda cifrada y nunca vuelve a mostrarse.</span>
                    </label>
                    <div v-else class="rounded bg-brand-blue-bg p-3 text-xs text-brand-blue sm:col-span-2">
                      El laboratorio local simula el timbrado completo (UUID, XML con estructura CFDI 4.0 y PDF descargables) sin ningún servicio externo ni registro. Los documentos quedan marcados como SIMULADOS y no tienen valor fiscal. Solo funciona en modo pruebas.
                    </div>
                  </div>
                  <div class="mt-5 flex flex-wrap items-center gap-3">
                    <button type="button" class="settings-primary" :disabled="pacSaving" @click="savePac">Guardar cambios</button>
                    <button type="button" class="settings-button" :disabled="pacTesting || (pac.provider !== 'lab' && !pac.hasApiKey)" @click="testPac">Probar conexión</button>
                    <span v-if="pac.lastTestAt" class="text-xs" :class="pac.lastTestOk ? 'text-brand-success-text' : 'text-brand-error-text'">
                      Última prueba {{ new Date(pac.lastTestAt).toLocaleString('es-MX') }} — {{ pac.lastTestOk ? 'correcta' : 'fallida' }}
                    </span>
                  </div>

                  <div v-if="pacProvider === 'facturapi'" class="mt-8 border-t border-brand-border-light pt-6">
                    <div class="flex items-center gap-2">
                      <Landmark class="h-[17px] w-[17px] text-brand-blue" :stroke-width="1.75" />
                      <h2>Certificado de sello digital (CSD)</h2>
                    </div>
                    <p class="mt-1 text-[13px] text-brand-text-secondary">Archivos .cer y .key emitidos por el SAT, con la contraseña de la llave privada</p>
                    <div v-if="pac.hasCsd" class="mt-4 rounded border border-brand-border-light bg-brand-bg p-4 text-sm">
                      <p><strong>{{ pac.csdCerFileName }}</strong> · <strong>{{ pac.csdKeyFileName }}</strong></p>
                      <p v-if="pac.csdValidUntil" class="mt-1 text-xs text-brand-text-muted">Vigente hasta el {{ new Date(pac.csdValidUntil).toLocaleDateString('es-MX') }}</p>
                      <p v-else class="mt-1 text-xs text-brand-text-muted">No se pudo leer la vigencia del certificado; la prueba de conexión lo valida.</p>
                      <button type="button" class="settings-button mt-3" :disabled="pacUploadingCsd" @click="removeCsd"><span class="flex items-center gap-1.5"><Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />Quitar certificado</span></button>
                    </div>
                    <div class="mt-4 grid gap-4 sm:grid-cols-2">
                      <label class="settings-field">Certificado (.cer)
                        <input ref="pacCerInput" type="file" accept=".cer" @change="onPacCerSelected" />
                        <span v-if="pacCerFile" class="text-xs font-normal text-brand-text-muted">{{ pacCerFile.name }}</span>
                      </label>
                      <label class="settings-field">Llave privada (.key)
                        <input ref="pacKeyInput" type="file" accept=".key" @change="onPacKeySelected" />
                        <span v-if="pacKeyFile" class="text-xs font-normal text-brand-text-muted">{{ pacKeyFile.name }}</span>
                      </label>
                      <label class="settings-field sm:col-span-2">Contraseña de la llave privada
                        <input v-model="pacCsdPassword" type="password" autocomplete="off" />
                      </label>
                    </div>
                    <div class="mt-4">
                      <button type="button" class="settings-primary" :disabled="pacUploadingCsd || !pacCerFile || !pacKeyFile || !pacCsdPassword.trim()" @click="uploadCsd">{{ pac.hasCsd ? 'Reemplazar certificado' : 'Subir certificado' }}</button>
                    </div>
                    <p v-if="pacError && pac" role="alert" class="mt-3 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ pacError }}</p>
                  </div>
                </template>
              </section>
              <SettingsFiscalModuleMapping @dirty="childDirty = $event" />
            </template>
            <template v-else-if="section === 'integraciones'"><section class="settings-card"><h2>Integraciones globales</h2><p>Configura los servicios compartidos por tu organización</p></section><SettingsEmailAccordion @dirty="childDirty = $event" /><SettingsApiKeys /></template>
            <SettingsNotificationGroups v-else-if="section === 'grupos'" />
          </template>
        </template>
        <p v-if="saveError" role="alert" class="rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ saveError }}</p>
      </div>
    <SettingsConfirmDialog v-if="pendingSection" title="Cambios sin guardar" confirm-label="Descartar cambios" cancel-label="Seguir editando" @cancel="pendingSection = ''" @confirm="discardAndNavigate">Si cambias de sección, se perderán los cambios pendientes.</SettingsConfirmDialog>
  </div>
</template>
<style scoped>
input, textarea, select { color-scheme: inherit; }

.settings-page { --list-page-gutter-x: 32px; --list-page-gutter-y: 32px; @apply flex min-h-[calc(100vh-120px)] flex-col gap-6 pb-20 text-brand-text; }
.agenda-settings-page { margin:-32px; padding:0 28px 28px; --list-page-gutter-x:28px; --list-page-gutter-y:0px; gap:28px; }
.agenda-settings-page :deep(.list-page-heading) { height:113px; }
@media(max-width:720px) { .agenda-settings-page { padding:0 16px 16px; --list-page-gutter-x:16px; gap:16px; } .agenda-settings-page :deep(.list-page-heading) { height:auto; min-height:90px; padding:14px 16px; } }
.settings-layout { @apply grid items-start gap-6 lg:grid-cols-[224px_minmax(0,1fr)]; }
.settings-nav { @apply flex gap-1 overflow-x-auto lg:sticky lg:top-5 lg:flex-col; }
.settings-nav button { @apply flex shrink-0 items-center gap-2.5 rounded px-3 py-3 text-left text-[13px] text-brand-text-secondary hover:bg-brand-blue-bg; }
.settings-nav button.selected { @apply bg-brand-blue-bg font-semibold text-brand-blue; }
.settings-card { @apply rounded-lg border border-brand-border-light bg-brand-surface p-6; }
.settings-card h2 { @apply text-[15px] font-bold; }
.settings-card p { @apply mt-1 text-[13px] text-brand-text-secondary; }
.settings-grid { @apply grid gap-5 sm:grid-cols-2; }
.settings-field { @apply flex flex-col gap-2 text-[13px] font-semibold; }
.settings-field input,.settings-field select,.settings-field textarea { @apply w-full rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue; }
.settings-button { @apply rounded border border-brand-border bg-brand-surface px-4 py-2 text-[13px] font-semibold hover:bg-brand-bg disabled:opacity-50; }
.settings-primary { @apply rounded bg-brand-orange px-4 py-2 text-[13px] font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:opacity-50; }
.settings-select { @apply flex-col items-stretch gap-2; }
.settings-select :deep(.report-option-label) { @apply text-[13px] text-brand-text; }
.settings-select :deep(.report-option-trigger) { @apply min-h-10 w-full font-normal; }
.settings-select :deep(.report-option-menu) { @apply max-h-64 overflow-y-auto; }
</style>

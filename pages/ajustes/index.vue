<script setup lang="ts">
// ERD-62 (Configuración General) - reemplaza el placeholder de "Ajustes"
// (pages/ajustes/index.vue original, 0.33.1) a pedido directo del usuario
// (2026-09-07: "creo que debemos de trabajar en los ajustes para cargar el
// logo y los datos de la empresa emisora del reporte").
//
// Fiel a Screen/Configuración General (`yLMnH` en el .pen), revisado con las
// herramientas de Pencil antes de construir (regla pencil-antes-de-frontend):
// Breadcrumbs "Inicio / Configuración", título "Configuración general" +
// subtítulo "Datos generales de tu organización", Card "Organización" con
// Nombre de la organización (Field/Text) + Moneda por defecto/Zona horaria
// (dos selects en fila) + botones Cancelar/Guardar cambios al pie.
//
// El mock NO incluye logo ni datos fiscales - esta entrega los agrega
// (mismo criterio ya usado para el sidebar colapsable, 0.79.2: cuando el
// mock no cubre lo que el usuario pide, se construye siguiendo el lenguaje
// visual del resto de la pantalla, documentado como extensión). Backend:
// GET/PUT /api/tenant (HU-ERD-61, ya existía) + POST/GET/DELETE
// /api/tenant/logo (nuevos, ver server/utils/tenantLogo.ts). Los datos
// fiscales se muestran como el formulario estructurado de México
// (mxFiscalDataSchema, server/utils/tenantFiscal.ts) porque es el único país
// con catálogo definido hoy - mismo límite ya documentado ahí ("por ahora
// solo se valida el caso Mexico").
import { Building2, ImageUp, Landmark, Trash2 } from '@lucide/vue'

definePageMeta({ layout: 'default' })

interface TenantResponse {
  id: string
  name: string
  defaultCurrency: string
  timezone: string
  country: string
  fiscalData: Record<string, unknown>
  hasLogo: boolean
}

const toast = useToast()

const {
  data: tenant,
  pending,
  error,
  refresh
} = await useFetch<TenantResponse>('/api/tenant', {
  key: 'tenant-settings',
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
const defaultCurrency = ref('MXN')
const timezone = ref('America/Mexico_City')

interface MxFiscalForm {
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
  return { rfc: '', regimenFiscal: '', codigoPostal: '', calle: '', numeroExterior: '', numeroInterior: '', colonia: '', municipio: '', estado: '' }
}
const fiscal = ref<MxFiscalForm>(emptyFiscalForm())

function hydrateForm(t: TenantResponse) {
  name.value = t.name
  defaultCurrency.value = t.defaultCurrency
  timezone.value = t.timezone
  const fd = t.fiscalData ?? {}
  fiscal.value = {
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
}
watch(tenant, (t) => t && hydrateForm(t), { immediate: true })

const isMx = computed(() => (tenant.value?.country ?? 'MX') === 'MX')

const saving = ref(false)
const saveError = ref('')

async function onSave() {
  saveError.value = ''
  if (!name.value.trim()) {
    saveError.value = 'Ponele un nombre a la organización.'
    return
  }
  saving.value = true
  try {
    const body: Record<string, unknown> = { name: name.value.trim(), defaultCurrency: defaultCurrency.value, timezone: timezone.value }
    if (isMx.value) {
      // Vacío -> null (nullable().optional() en tenantUpdateSchema) en vez de
      // '' - el regex de RFC/código postal se aplica solo cuando el valor es
      // un string no vacío, así que '' rompería la validación de un campo
      // que el usuario dejó sin completar a propósito.
      body.fiscalData = Object.fromEntries(Object.entries(fiscal.value).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]))
    }
    await $fetch('/api/tenant', { method: 'PUT', body })
    await refresh()
    toast.updated('Configuración guardada', 'Los datos de la organización se actualizaron.')
  } catch (err: any) {
    const message = err?.data?.statusMessage
    saveError.value = typeof message === 'string' ? message : 'No se pudo guardar la configuración'
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
    toast.success('Logo eliminado', 'El encabezado de los reportes vuelve a mostrar el espacio en blanco.')
  } catch (err: any) {
    logoError.value = err?.data?.statusMessage || 'No se pudo quitar el logo'
    toast.error('No se pudo quitar el logo', logoError.value)
  } finally {
    uploadingLogo.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <span class="text-brand-text-muted">/</span>
      <span class="font-bold text-brand-text">Configuración</span>
    </div>

    <div class="flex flex-col gap-0.5">
      <h1 class="text-[22px] font-bold text-brand-text">Configuración general</h1>
      <p class="text-sm text-brand-text-secondary">Datos generales de tu organización</p>
    </div>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="error" class="text-sm text-brand-error-text">No se pudo cargar la configuración de la organización.</p>

    <div v-else class="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <div class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
        <div class="flex flex-col gap-0.5 p-5">
          <div class="flex items-center gap-2">
            <Building2 class="h-[17px] w-[17px] text-brand-blue" :stroke-width="1.75" />
            <h2 class="text-[15px] font-bold text-brand-text">Organización</h2>
          </div>
          <p class="text-[13px] text-brand-text-muted">Estos datos se usan en toda la plataforma</p>
        </div>

        <div class="flex flex-col gap-4 p-5 pt-0">
          <p v-if="saveError" class="text-sm text-brand-error-text">{{ saveError }}</p>

          <div class="flex items-center gap-4">
            <div class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-brand-border-light bg-brand-bg">
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

          <div class="flex flex-col gap-1.5">
            <label for="tenantName" class="text-[13px] font-semibold text-brand-text">Nombre de la organización</label>
            <input
              id="tenantName"
              v-model="name"
              type="text"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>

          <div class="flex gap-4">
            <div class="flex flex-1 flex-col gap-1.5">
              <label for="tenantCurrency" class="text-[13px] font-semibold text-brand-text">Moneda por defecto</label>
              <select
                id="tenantCurrency"
                v-model="defaultCurrency"
                class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              >
                <option v-for="opt in CURRENCY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div class="flex flex-1 flex-col gap-1.5">
              <label for="tenantTimezone" class="text-[13px] font-semibold text-brand-text">Zona horaria</label>
              <select
                id="tenantTimezone"
                v-model="timezone"
                class="w-full rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              >
                <option v-for="opt in TIMEZONE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Datos fiscales - no está en el mock (yLMnH solo dibuja
        Organización/Moneda/Zona horaria); agregado a pedido del usuario
        ("los datos de la empresa emisora del reporte") siguiendo el mismo
        Card + Field/Text del resto de la pantalla. Solo México tiene
        catálogo hoy (mxFiscalDataSchema) - ver el comentario grande arriba. -->
        <template v-if="isMx">
          <div class="flex items-center gap-2 border-t border-brand-border-light p-5 pb-0">
            <Landmark class="h-[17px] w-[17px] text-brand-blue" :stroke-width="1.75" />
            <h2 class="text-[15px] font-bold text-brand-text">Datos fiscales</h2>
          </div>
          <p class="px-5 pb-0 pt-0.5 text-[13px] text-brand-text-muted">Se usan como emisor en el encabezado de los reportes imprimibles</p>

          <div class="flex flex-col gap-4 p-5">
            <div class="flex gap-4">
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalRfc" class="text-[13px] font-semibold text-brand-text">RFC</label>
                <input id="fiscalRfc" v-model="fiscal.rfc" type="text" placeholder="AAA010101AAA" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm uppercase text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalRegimen" class="text-[13px] font-semibold text-brand-text">Régimen fiscal</label>
                <input id="fiscalRegimen" v-model="fiscal.regimenFiscal" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-[2] flex-col gap-1.5">
                <label for="fiscalCalle" class="text-[13px] font-semibold text-brand-text">Calle</label>
                <input id="fiscalCalle" v-model="fiscal.calle" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalNumExt" class="text-[13px] font-semibold text-brand-text">N.º exterior</label>
                <input id="fiscalNumExt" v-model="fiscal.numeroExterior" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalNumInt" class="text-[13px] font-semibold text-brand-text">N.º interior</label>
                <input id="fiscalNumInt" v-model="fiscal.numeroInterior" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalColonia" class="text-[13px] font-semibold text-brand-text">Colonia</label>
                <input id="fiscalColonia" v-model="fiscal.colonia" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalCp" class="text-[13px] font-semibold text-brand-text">Código postal</label>
                <input id="fiscalCp" v-model="fiscal.codigoPostal" type="text" inputmode="numeric" maxlength="5" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>

            <div class="flex gap-4">
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalMunicipio" class="text-[13px] font-semibold text-brand-text">Municipio</label>
                <input id="fiscalMunicipio" v-model="fiscal.municipio" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
              <div class="flex flex-1 flex-col gap-1.5">
                <label for="fiscalEstado" class="text-[13px] font-semibold text-brand-text">Estado</label>
                <input id="fiscalEstado" v-model="fiscal.estado" type="text" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
              </div>
            </div>
          </div>
        </template>

        <div class="flex justify-end gap-3 border-t border-brand-border-light p-5">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="onDiscard">Cancelar</button>
          <button
            type="button"
            :disabled="saving"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSave"
          >
            {{ saving ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

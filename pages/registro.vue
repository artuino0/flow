<script setup lang="ts">
// HU-ERD-197: registro de cinco pasos, OTP antes de la organización, fiel al
// diseño real (Screen/Registro Paso 1-4 del .pen, revisado por completo con
// mcp__pencil__execute antes de escribir este archivo, pencil-antes-de-frontend
// - nodos gQM6L/OQNF9/D6C1Ul/uwmVR). El alta final requiere el testigo
// de correo verificado; el plan se elige después de crear la organización.
//
// "Tamaño del equipo" (paso 2) sigue siendo cosmético. El rol de cada invitado
// (paso 3) siempre es "Miembro" - el diseño muestra un selector, pero
// registerTenant() solo crea ese rol de arranque además de "Administrador",
// así que se dibuja fijo, sin dropdown funcional.
import { ArrowLeft, ArrowRight, BatteryFull, Building2, CalendarCheck, ChevronDown, CircleAlert, CircleCheck, Layers, Link2, Plus, Signal, Users, Wifi, X } from '@lucide/vue'
import { normalizeRegistrationChoice, type RegistrationChoice } from '~/utils/registrationIntent'

definePageMeta({ layout: false, darkReady: true })

// HU-ERD-35: el registro público no existe en modo "dedicated" (un solo
// cliente por deployment) - mismo gate que el backend (POST /api/auth/register
// devuelve 403 ahí). Se resuelve en runtime via GET /api/config, igual que
// pages/login.vue.
const { data: appConfig } = await useDeploymentConfig()
const accessAddress = computed(() => {
  try { return new URL(appConfig.value?.appBaseUrl || '').host }
  catch { return '' }
})
if (appConfig.value?.appMode === 'dedicated') {
  await navigateTo('/login')
}

const step = ref(1)
const visualRegistrationSteps = ['Tu cuenta', 'Verifica tu correo', 'Tu organización', 'Invita a tu equipo', 'Elegir plan']
const loading = ref(false)
const errorMessage = ref('')
const accountExists = ref(false)
const choiceError = ref('')
type PublicPlan = { key: string; name: string; description: string; monthlyPriceCents: number; annualPriceCents: number; currency: string }
const choice = ref<RegistrationChoice | null>(normalizeRegistrationChoice(useRoute().query))
const { data: publicPlans } = await useFetch<{ plans: PublicPlan[] }>('/api/public/plans')
const chosenPlan = computed(() => publicPlans.value?.plans.find(plan => plan.key === choice.value?.plan))
const chosenPrice = computed(() => chosenPlan.value ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: chosenPlan.value.currency, maximumFractionDigits: 0 }).format((choice.value?.interval === 'year' ? chosenPlan.value.annualPriceCents : chosenPlan.value.monthlyPriceCents) / 100) : '')
const loginLink = computed(() => ({ path: '/login', query: chosenPlan.value && choice.value ? { ...choice.value } : {} }))
async function changePlan() {
  if (loading.value) return
  loading.value = true
  choiceError.value = ''
  try {
    if (result.value) await $fetch('/api/billing/registration-intent', { method: 'POST', body: { clear: true } })
    else if (step.value > 1) await $fetch('/api/auth/register/intent', { method: 'POST', body: { clear: true } })
    choice.value = null
    useState<RegistrationChoice | null>('registration-landing-choice').value = null
    await navigateTo('/registro', { replace: true })
  } catch { choiceError.value = 'No se pudo cambiar el plan. Intenta de nuevo.' }
  finally { loading.value = false }
}

// Paso 1: "Tu cuenta"
const fullName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const acceptedTerms = ref(false)

const canContinueStep1 = computed(
  () =>
    fullName.value.trim().length > 0 &&
    email.value.trim().length > 0 &&
    password.value.length >= 8 &&
    password.value === confirmPassword.value &&
    acceptedTerms.value
)

// Paso 2: "Tu organización"
const organizationName = ref('')
const slug = ref('')
const slugEditedManually = ref(false)
const teamSizeOptions = [
  { value: 'solo', label: 'Solo yo' },
  { value: '2-10', label: '2–10' },
  { value: '11-50', label: '11–50' },
  { value: '50+', label: '50+' }
]
const teamSize = ref('2-10')

function slugify(name: string): string {
  // Mismo criterio que server/utils/registration.ts (slugify) - se
  // duplica intencionalmente en el cliente para dar el feedback visual "en
  // vivo" del diseño sin esperar un roundtrip; el servidor es la fuente de
  // verdad real (vuelve a normalizar y valida contra TENANT_SLUG_PATTERN).
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

watch(organizationName, (val) => {
  if (!slugEditedManually.value) {
    slug.value = slugify(val)
  }
})

function onSlugInput() {
  slugEditedManually.value = true
  slug.value = slugify(slug.value)
}

const slugChecking = ref(false)
const slugAvailable = ref<boolean | null>(null)
const slugReason = ref<string | null>(null)
let slugCheckTimer: ReturnType<typeof setTimeout> | undefined

watch(slug, (val) => {
  slugAvailable.value = null
  slugReason.value = null
  if (slugCheckTimer) clearTimeout(slugCheckTimer)
  if (!val) return
  slugCheckTimer = setTimeout(async () => {
    slugChecking.value = true
    try {
      const result = await $fetch<{ available: boolean; reason?: string }>('/api/tenants/check-slug', { query: { slug: val } })
      slugAvailable.value = result.available
      slugReason.value = result.reason ?? null
    } catch {
      slugAvailable.value = null
    } finally {
      slugChecking.value = false
    }
  }, 400)
})

const canContinueStep2 = computed(() => organizationName.value.trim().length > 0 && slug.value.length > 0 && slugAvailable.value !== false)

// Paso 3: "Invita a tu equipo"
const invitees = ref<{ email: string }[]>([{ email: '' }])

function addInvitee() {
  invitees.value.push({ email: '' })
}

function removeInvitee(index: number) {
  invitees.value.splice(index, 1)
}

// Paso 4: confirmar correo antes de elegir plan.
const result = ref<{ tenantName: string; slug: string; invitationsSent: number } | null>(null)

async function onSubmit() {
  if (loading.value) return
  errorMessage.value = ''
  accountExists.value = false
  loading.value = true
  try {
    const cleanInvitees = invitees.value
      .map((i) => i.email.trim())
      .filter(Boolean)
      .map((inviteeEmail) => ({ email: inviteeEmail }))

    const response = await $fetch<{ ok: boolean; tenantId: string; tenantName: string; slug: string; invitationsSent: number }>('/api/auth/register', {
      method: 'POST',
      body: {
        organizationName: organizationName.value.trim(),
        slug: slug.value,
        invitees: cleanInvitees.length ? cleanInvitees : undefined
      }
    })

    result.value = { tenantName: response.tenantName, slug: response.slug, invitationsSent: response.invitationsSent }
    step.value = 5
    sessionStorage.removeItem('flow-registration-draft')
    await useAuth().fetchMe()
    await navigateTo('/elegir-plan')
  } catch (err: unknown) {
    const failure = err as { data?: { statusMessage?: string; message?: string; statusCode?: number }; statusCode?: number }
    errorMessage.value = failure.data?.statusMessage || failure.data?.message || 'No pudimos confirmar la respuesta. Reintenta con los mismos datos para continuar tu registro.'
    accountExists.value = failure.statusCode === 409
    if ((failure.statusCode || failure.data?.statusCode) === 401) {
      emailConfirmed.value = false; code.value = ''; step.value = 2
      otpMessage.value = 'La autorización venció. Solicita un código nuevo para continuar.'
    }
  } finally {
    loading.value = false
  }
}

const code = ref('')
const emailConfirmed = ref(false)
const newEmail = ref('')
const changing = ref(false)
const seconds = ref(0)
const delivery = ref('queued')
const otpMessage = ref('')
const busyAction = ref<'verify' | 'resend' | 'change-email' | null>(null)
let countdown: ReturnType<typeof setInterval> | undefined
let statusPoll: ReturnType<typeof setInterval> | undefined
async function startRegistration() {
  if (loading.value || !canContinueStep1.value) return
  loading.value = true; errorMessage.value = ''
  try {
    const status = await $fetch<{ retryAfter: number; delivery: string }>('/api/auth/register/start', { method: 'POST', body: {
      fullName: fullName.value.trim(), email: email.value.trim(), password: password.value, registrationChoice: chosenPlan.value ? choice.value : undefined
    } })
    email.value = email.value.trim().toLowerCase()
    password.value = ''; confirmPassword.value = ''
    seconds.value = status.retryAfter; delivery.value = status.delivery; step.value = 2
  } catch (error: unknown) { showFailure(error) }
  finally { loading.value = false }
}
function showFailure(error: unknown) {
  const failure = error as { data?: { statusMessage?: string } }
  errorMessage.value = failure.data?.statusMessage || 'No pudimos confirmar la respuesta. Intenta de nuevo.'
}
async function otpAction(action: 'verify' | 'resend' | 'change-email') {
  if (loading.value) return
  loading.value = true; busyAction.value = action; errorMessage.value = ''; otpMessage.value = ''
  try {
    if (action === 'verify') {
      if (!emailConfirmed.value) await $fetch('/api/auth/register/verify', { method: 'POST', body: { code: code.value } })
      emailConfirmed.value = true; code.value = ''; step.value = 3
    } else {
      const response = await $fetch<{ email: string; retryAfter: number; delivery: string }>(`/api/auth/register/${action === 'resend' ? 'resend' : 'change-email'}`, { method: 'POST', body: action === 'change-email' ? { email: newEmail.value } : {} })
      email.value = response.email; seconds.value = response.retryAfter; delivery.value = response.delivery
      emailConfirmed.value = false
      code.value = ''; changing.value = false; otpMessage.value = 'El nuevo código está pendiente de envío.'
    }
  } catch (error: unknown) { showFailure(error) }
  finally { loading.value = false; busyAction.value = null }
}
const verifyCode = () => otpAction('verify')
const resendCode = () => otpAction('resend')
const changeEmail = () => otpAction('change-email')
onMounted(async () => {
  countdown = setInterval(() => { if (seconds.value > 0) seconds.value-- }, 1000)
  statusPoll = setInterval(async () => {
    if (loading.value || step.value < 2 || step.value > 4) return
    try {
      const status = await $fetch<{ pending: boolean; verified?: boolean; delivery?: string }>('/api/auth/register/status')
      if (status.pending && status.delivery) delivery.value = status.delivery
      if (emailConfirmed.value && !status.verified) {
        emailConfirmed.value = false; step.value = 2
        otpMessage.value = 'La autorización venció. Solicita un código nuevo para continuar.'
      }
    } catch (error: unknown) { showFailure(error) }
  }, 15000)
  try {
    const status = await $fetch<{ pending: boolean; verified?: boolean; email?: string; fullName?: string; registrationChoice?: unknown; retryAfter?: number; delivery?: string }>('/api/auth/register/status')
    if (!status.pending) { sessionStorage.removeItem('flow-registration-draft'); return }
    email.value = status.email || ''; fullName.value = status.fullName || ''
    choice.value = normalizeRegistrationChoice(status.registrationChoice)
    seconds.value = status.retryAfter || 0; delivery.value = status.delivery || 'queued'
    step.value = status.verified ? 3 : 2
    emailConfirmed.value = Boolean(status.verified)
    const draft = JSON.parse(sessionStorage.getItem('flow-registration-draft') || 'null')
    if (draft?.email === email.value && status.verified) {
      organizationName.value = typeof draft.organizationName === 'string' ? draft.organizationName : ''
      slugEditedManually.value = true; slug.value = typeof draft.slug === 'string' ? draft.slug : ''
      invitees.value = Array.isArray(draft.invitees) ? draft.invitees.slice(0, 20).filter((value: unknown) => typeof value === 'string').map((email: string) => ({ email })) : [{ email: '' }]
      teamSize.value = draft.teamSize || '2-10'; step.value = draft.step === 4 ? 4 : 3
    }
  } catch (error: unknown) {
    showFailure(error)
  }
})
watch([step, organizationName, slug, teamSize, invitees], () => {
  if (import.meta.client && step.value >= 3 && step.value <= 4) sessionStorage.setItem('flow-registration-draft', JSON.stringify({ email: email.value, step: step.value, organizationName: organizationName.value, slug: slug.value, teamSize: teamSize.value, invitees: invitees.value.map(item => item.email) }))
}, { deep: true })
onBeforeUnmount(() => { if (countdown) clearInterval(countdown); if (statusPoll) clearInterval(statusPoll); if (slugCheckTimer) clearTimeout(slugCheckTimer) })

const brandText = computed(() => {
  switch (step.value) {
    case 1:
      return 'Crea tu organización y empieza a modelar tus entidades en minutos, sin escribir código.'
    case 2:
      return 'Verifica tu correo para continuar con tu organización.'
    case 3:
      return 'Cada organización vive en su propio espacio, con su URL, sus datos y sus usuarios.'
    case 4:
      return 'Colabora con tu equipo: cada persona ve solo lo que su rol le permite.'
    default:
      return 'Confirma tu correo, elige un plan y comienza con 30 días de prueba.'
  }
})
</script>

<template>
  <div class="access-page flex min-h-screen flex-col font-sans lg:flex-row">
    <div class="fixed right-4 top-4 z-50"><ThemeSelector touch-target /></div>
    <div class="access-brand flex w-full shrink-0 flex-col rounded-b-[28px] text-brand-tooltip-fg lg:hidden">
      <div class="flex h-[54px] w-full items-center justify-between px-6">
        <span class="text-[15px] font-semibold">9:41</span>
        <div class="flex items-center gap-1.5" aria-hidden="true">
          <Signal class="h-4 w-4" :stroke-width="2" />
          <Wifi class="h-4 w-4" :stroke-width="2" />
          <BatteryFull class="h-4 w-4" :stroke-width="2" />
        </div>
      </div>
      <div class="flex items-center gap-3 px-5 pb-6 pt-1">
        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-switch-thumb/15">
          <img src="/brand/isotipo-white.png" alt="Flow" class="h-8 w-8 object-contain" />
        </div>
        <span class="text-[22px] font-bold">Flow</span>
      </div>
    </div>
    <div
      class="hidden w-[560px] shrink-0 flex-col justify-center gap-5 access-brand px-16 lg:flex"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-[14px] bg-brand-switch-thumb/15">
        <img src="/brand/isotipo-white.png" alt="Flow" class="h-9 w-9 object-contain" />
      </div>
      <h1 class="text-[28px] font-bold text-brand-tooltip-fg">Flow</h1>
      <p class="w-[340px] text-[15px] text-brand-access-description">{{ brandText }}</p>
    </div>

    <div class="flex flex-1 flex-col items-center justify-center gap-6 bg-brand-surface px-5 py-7 pb-8 lg:px-4 lg:py-10">
      <NuxtLink v-if="accountExists" :to="loginLink" class="w-full max-w-[380px] text-sm font-semibold text-brand-blue underline">{{ chosenPlan ? 'Inicia sesión para continuar con el plan elegido' : 'Inicia sesión para continuar' }}</NuxtLink>
      <RegistrationChosenPlan v-if="chosenPlan" :chosen-plan="chosenPlan" :chosen-price="chosenPrice" :choice-error="choiceError" :choice="choice" :loading="loading" class="w-full max-w-[380px]" @change="changePlan" />
      <!-- Paso 1: Tu cuenta -->
      <div v-if="step === 1" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col gap-2">
          <RegistrationStepIndicator :steps="visualRegistrationSteps" :current-step="1" />
        </div>

        <div>
          <h2 class="text-2xl font-bold text-brand-text">Crea tu cuenta</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Empieza con tus datos personales. Después configuramos tu organización.</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="fullName" class="text-[13px] font-semibold text-brand-text">Nombre completo</label>
          <input
            id="fullName"
            v-model="fullName"
            type="text"
            required
            placeholder="Artur Ramírez"
            class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-sites-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="email" class="text-[13px] font-semibold text-brand-text">Correo electrónico</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="username"
            placeholder="arturosistemas94@gmail.com"
            class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-sites-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label for="password" class="text-[13px] font-semibold text-brand-text">Contraseña</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              autocomplete="new-password"
              class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="confirmPassword" class="text-[13px] font-semibold text-brand-text">Confirmar</label>
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              type="password"
              required
              autocomplete="new-password"
              class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
        </div>
        <p class="-mt-3 text-xs text-brand-sites-muted">Al menos 8 caracteres, con letras y números.</p>

        <label class="flex cursor-pointer items-start gap-2">
          <input v-model="acceptedTerms" type="checkbox" class="mt-0.5 h-4 w-4 rounded-[3px] border-brand-control-border accent-brand-orange focus:ring-brand-orange" />
          <span class="text-sm text-brand-text">Acepto los Términos y Condiciones y la Política de Privacidad</span>
        </label>

        <button
          type="button"
          :disabled="loading || !canContinueStep1"
          class="flex w-full items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="startRegistration"
        >
          Continuar <ArrowRight class="h-4 w-4" :stroke-width="2" />
        </button>

        <p class="text-center text-[13px] text-brand-sites-muted">
          ¿Ya tienes cuenta? <NuxtLink :to="loginLink" class="font-semibold text-brand-blue hover:underline">Iniciar sesión</NuxtLink>
        </p>
      </div>

      <!-- Paso 2: Tu organización -->
      <div v-else-if="step === 2" class="flex w-full max-w-[380px] flex-col gap-5">
        <RegistrationStepIndicator :steps="visualRegistrationSteps" :current-step="2" />
        <RegistrationOtpStep :email="email" :code="code" :new-email="newEmail" :changing="changing" :busy="loading" :busy-action="busyAction" :seconds="seconds" :message="otpMessage" :error="errorMessage" :delivery="delivery" :invitation-failures="0" :verified="emailConfirmed" provisional
          @update:code="code = $event.replace(/\D/g, '').slice(0, 6)" @update:new-email="newEmail = $event" @confirm-code="verifyCode" @resend-code="resendCode" @start-email-change="changing = true; newEmail = email" @change-email="changeEmail" @cancel-email-change="changing = false" />
        <button type="button" :disabled="loading" class="flex items-center justify-center gap-2 rounded border border-brand-control-border px-4 py-[9px] text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:opacity-60" @click="changing = true; newEmail = email"><ArrowLeft class="h-4 w-4" :stroke-width="2" /> Atrás</button>
      </div>

      <div v-else-if="step === 3" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col gap-2">
          <RegistrationStepIndicator :steps="visualRegistrationSteps" :current-step="3" />
        </div>
        <div>
          <h2 class="text-2xl font-bold text-brand-text">Crea tu organización</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Este será el espacio de trabajo de tu equipo, con sus propios datos.</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="organizationName" class="text-[13px] font-semibold text-brand-text">Nombre de la organización</label>
          <input
            id="organizationName"
            v-model="organizationName"
            type="text"
            required
            placeholder="Acme Corp"
            class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-sites-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="slug" class="text-[13px] font-semibold text-brand-text">Identificador de tu organización</label>
          <div
            class="flex items-center gap-2 rounded border px-3 py-[9px]"
            :class="slugAvailable === false ? 'border-brand-error-text' : slugAvailable === true ? 'border-brand-success-text' : 'border-brand-control-border'"
          >
            <input
              id="slug"
              v-model="slug"
              type="text"
              required
              placeholder="acme"
              aria-describedby="slug-help"
              class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-brand-text placeholder:text-brand-sites-muted focus:outline-none focus:ring-0"
              @input="onSlugInput"
            />
            <CircleCheck v-if="slugAvailable === true" class="h-4 w-4 shrink-0 text-brand-success-text" :stroke-width="2" />
          </div>
          <p id="slug-help" class="text-xs text-brand-text-secondary">Un nombre corto y único, en minúsculas. Lo usarás para identificar tu organización.</p>
          <p v-if="slugChecking" role="status" class="text-xs text-brand-text-secondary">Comprobando disponibilidad…</p>
          <p v-if="slugAvailable === true" class="flex items-center gap-1 text-xs font-medium text-brand-success-text">
            <CircleCheck class="h-3.5 w-3.5" :stroke-width="2" /> Disponible
          </p>
          <p v-else-if="slugAvailable === false && slugReason === 'formato'" role="alert" class="text-xs font-medium text-brand-error-text">Usa solo letras minúsculas, números y guiones; empieza y termina con una letra o número.</p>
          <p v-else-if="slugAvailable === false" role="alert" class="text-xs font-medium text-brand-error-text">Ese identificador ya está en uso, prueba con otro.</p>
        </div>

        <!-- Cosmetico: no hay ningun campo/backend detras (ver el comentario
             largo al inicio del archivo). -->
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] font-semibold text-brand-text">Tamaño del equipo</label>
          <div class="flex gap-2">
            <button
              v-for="opt in teamSizeOptions"
              :key="opt.value"
              type="button"
              class="flex-1 rounded border px-2 py-2 text-[13px] font-semibold"
              :class="teamSize === opt.value ? 'border-brand-blue bg-brand-blue-bg text-brand-blue' : 'border-brand-control-border text-brand-text-secondary'"
              @click="teamSize = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <div class="flex gap-3">
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-2 rounded border border-brand-control-border px-4 py-[9px] text-sm font-semibold text-brand-text hover:bg-brand-surface"
            @click="step = 2"
          >
            <ArrowLeft class="h-4 w-4" :stroke-width="2" /> Atrás
          </button>
          <button
            type="button"
            :disabled="!canContinueStep2"
            class="flex flex-1 items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="step = 4"
          >
            Continuar <ArrowRight class="h-4 w-4" :stroke-width="2" />
          </button>
        </div>
      </div>

      <!-- Paso 3: Invita a tu equipo -->
      <div v-else-if="step === 4" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col gap-2">
          <RegistrationStepIndicator :steps="visualRegistrationSteps" :current-step="4" />
        </div>
        <div>
          <h2 class="text-2xl font-bold text-brand-text">Invita a tu equipo</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Puedes invitar ahora o hacerlo después desde Usuarios.</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <div v-for="(invitee, idx) in invitees" :key="idx" class="flex items-center gap-2">
            <input
              v-model="invitee.email"
              type="email"
              placeholder="maria.lopez@acme.com"
              class="min-w-0 flex-1 rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-sites-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
            <!-- Cosmetico: siempre "Miembro" (ver el comentario largo al inicio del archivo). -->
            <span class="flex shrink-0 items-center gap-1 rounded border border-brand-control-border px-2.5 py-[9px] text-[13px] text-brand-text-secondary">
              Miembro <ChevronDown class="h-3.5 w-3.5" :stroke-width="2" />
            </span>
            <button type="button" class="shrink-0 rounded p-1.5 text-brand-sites-muted hover:bg-brand-surface" @click="removeInvitee(idx)">
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </div>
        </div>

        <button type="button" class="flex w-full items-center justify-center gap-1.5 rounded border border-brand-control-border bg-brand-surface px-3.5 py-[9px] text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-surface" @click="addInvitee">
          <Plus class="h-3.5 w-3.5" :stroke-width="2.5" /> Agregar otro correo
        </button>

        <div class="flex gap-3">
          <button
            type="button"
            :disabled="loading"
            class="flex flex-1 items-center justify-center gap-2 rounded border border-brand-control-border px-4 py-[9px] text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-60"
            @click="step = 3"
          >
            <ArrowLeft class="h-4 w-4" :stroke-width="2" /> Atrás
          </button>
          <button
            type="button"
            :disabled="loading"
            class="flex flex-1 items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSubmit"
          >
            {{ loading ? 'Creando...' : 'Continuar' }} <ArrowRight v-if="!loading" class="h-4 w-4" :stroke-width="2" />
          </button>
        </div>

        <button type="button" :disabled="loading" class="text-center text-[13px] text-brand-sites-muted hover:underline disabled:cursor-not-allowed" @click="onSubmit">
          Omitir por ahora
        </button>
      </div>

      <!-- Paso 4: Confirmación de correo -->
      <div v-else-if="step === 5 && result" class="flex w-full max-w-[380px] flex-col gap-5">
        <RegistrationStepIndicator :steps="visualRegistrationSteps" :current-step="5" />
        <div class="flex flex-col items-center gap-[14px] text-center">
          <div class="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-brand-success-bg">
            <CircleCheck class="h-7 w-7 text-brand-success-text" :stroke-width="1.75" />
          </div>
          <h2 class="text-[22px] font-bold text-brand-text">Tu organización está creada</h2>
          <p class="text-sm text-brand-text-secondary">Tu correo está verificado. Elige un plan para activar el acceso.</p>
        </div>

        <div class="w-full rounded bg-brand-bg px-[14px] py-1">
          <div class="flex items-center gap-2.5 border-b border-brand-border-light py-2.5">
            <Building2 class="h-[15px] w-[15px] shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">Organización</span>
            <span class="text-[13px] font-semibold text-brand-text">{{ result.tenantName }}</span>
          </div>
          <div class="flex items-center gap-2.5 border-b border-brand-border-light py-2.5">
            <Link2 class="h-[15px] w-[15px] shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">Identificador</span>
            <span class="text-[13px] font-semibold text-brand-text">{{ result.slug }}</span>
          </div>
          <div class="flex items-center gap-2.5 border-b border-brand-border-light py-2.5">
            <Link2 class="h-[15px] w-[15px] shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">Acceso</span>
            <span class="break-all text-[13px] font-semibold text-brand-text">{{ accessAddress }}</span>
          </div>
          <div class="flex items-center gap-2.5 py-2.5">
            <Users class="h-[15px] w-[15px] shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">Equipo</span>
            <span class="text-[13px] font-semibold text-brand-text">{{ result.invitationsSent }} invitaciones pendientes de envío</span>
          </div>
        </div>

        <NuxtLink
          to="/elegir-plan"
          class="flex w-full items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover"
        >
          Elegir plan <ArrowRight class="h-4 w-4" :stroke-width="2" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

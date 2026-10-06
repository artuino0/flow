<script setup lang="ts">
// HU multi-organizacion (2026-09-04): "Registro" - wizard de 4 pasos fiel al
// diseño real (Screen/Registro Paso 1-4 del .pen, revisado por completo con
// mcp__pencil__execute antes de escribir este archivo, pencil-antes-de-frontend
// - nodos gQM6L/OQNF9/D6C1Ul/uwmVR). El cuarto paso espera la verificación
// del correo; el plan se elige después de seguir el enlace recibido.
//
// "Tamaño del equipo" (paso 2) sigue siendo cosmético. El rol de cada invitado
// (paso 3) siempre es "Miembro" - el diseño muestra un selector, pero
// registerTenant() solo crea ese rol de arranque además de "Administrador",
// así que se dibuja fijo, sin dropdown funcional.
import { ArrowLeft, ArrowRight, Building2, Check, ChevronDown, CircleAlert, CircleCheck, Layers, Link2, Plus, Users, X } from '@lucide/vue'
import { normalizeRegistrationChoice, type RegistrationChoice } from '~/utils/registrationIntent'

definePageMeta({ layout: false, darkReady: true })

// HU-ERD-35: el registro público no existe en modo "dedicated" (un solo
// cliente por deployment) - mismo gate que el backend (POST /api/auth/register
// devuelve 403 ahí). Se resuelve en runtime via GET /api/config, igual que
// pages/login.vue.
const { data: appConfig } = await useDeploymentConfig()
if (appConfig.value?.appMode === 'dedicated') {
  await navigateTo('/login')
}

const step = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const accountExists = ref(false)
const choiceError = ref('')
type PublicPlan = { key: string; name: string; description: string; monthlyPriceCents: number; annualPriceCents: number; currency: string }
const choice = ref<RegistrationChoice | null>(normalizeRegistrationChoice(useRoute().query))
const { data: publicPlans } = choice.value ? await useFetch<{ plans: PublicPlan[] }>('/api/public/plans') : { data: ref<{ plans: PublicPlan[] } | null>(null) }
const chosenPlan = computed(() => publicPlans.value?.plans.find(plan => plan.key === choice.value?.plan))
const chosenPrice = computed(() => chosenPlan.value ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: chosenPlan.value.currency, maximumFractionDigits: 0 }).format((choice.value?.interval === 'year' ? chosenPlan.value.annualPriceCents : chosenPlan.value.monthlyPriceCents) / 100) : '')
const loginLink = computed(() => ({ path: '/login', query: chosenPlan.value && choice.value ? { ...choice.value } : {} }))
async function changePlan() {
  if (loading.value) return
  loading.value = true
  choiceError.value = ''
  try {
    if (result.value) await $fetch('/api/billing/registration-intent', { method: 'POST', body: { clear: true } })
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
let slugCheckTimer: ReturnType<typeof setTimeout> | undefined

watch(slug, (val) => {
  slugAvailable.value = null
  if (slugCheckTimer) clearTimeout(slugCheckTimer)
  if (!val) return
  slugCheckTimer = setTimeout(async () => {
    slugChecking.value = true
    try {
      const result = await $fetch<{ available: boolean; reason?: string }>('/api/tenants/check-slug', { query: { slug: val } })
      slugAvailable.value = result.available
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
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        password: password.value,
        organizationName: organizationName.value.trim(),
        slug: slug.value,
        invitees: cleanInvitees.length ? cleanInvitees : undefined,
        registrationChoice: chosenPlan.value ? choice.value : undefined
      }
    })

    result.value = { tenantName: response.tenantName, slug: response.slug, invitationsSent: response.invitationsSent }
    step.value = 4
    await navigateTo('/confirmar-correo')
  } catch (err: unknown) {
    const failure = err as { data?: { statusMessage?: string; message?: string }; statusCode?: number }
    errorMessage.value = failure.data?.statusMessage || failure.data?.message || 'No pudimos confirmar la respuesta. Reintenta con los mismos datos para continuar tu registro.'
    accountExists.value = failure.statusCode === 409
  } finally {
    loading.value = false
  }
}

const brandText = computed(() => {
  switch (step.value) {
    case 1:
      return 'Crea tu organización y empieza a modelar tus entidades en minutos, sin escribir código.'
    case 2:
      return 'Cada organización vive en su propio espacio, con su URL, sus datos y sus usuarios.'
    case 3:
      return 'Colabora con tu equipo: cada persona ve solo lo que su rol le permite.'
    default:
      return 'Confirma tu correo, elige un plan y comienza con 30 días de prueba.'
  }
})
</script>

<template>
  <div class="access-page flex min-h-screen font-sans">
    <div
      class="hidden w-[560px] shrink-0 flex-col justify-center gap-5 access-brand px-16 lg:flex"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-[14px] bg-brand-switch-thumb/15">
        <img src="/brand/isotipo-white.png" alt="Flow" class="h-9 w-9 object-contain" />
      </div>
      <h1 class="text-[28px] font-bold text-brand-tooltip-fg">Flow</h1>
      <p class="w-[340px] text-[15px] text-brand-access-description">{{ brandText }}</p>
    </div>

    <div class="flex flex-1 flex-col items-center justify-center gap-6 bg-brand-surface px-4 py-10">
      <div class="flex w-full max-w-[380px] justify-end"><ThemeSelector /></div>
      <section v-if="chosenPlan" aria-label="Plan elegido" class="w-full max-w-[380px] rounded border border-brand-control-border bg-brand-blue-bg px-4 py-3 text-sm text-brand-text">
        <p>Plan elegido: <strong>{{ chosenPlan.name }}</strong> · {{ chosenPrice }} MXN {{ choice?.interval === 'year' ? 'al año' : 'al mes' }} · 30 días de prueba</p>
        <button type="button" :disabled="loading" class="mt-2 font-semibold text-brand-blue underline focus-visible:outline focus-visible:outline-brand-blue disabled:opacity-50" @click="changePlan">Cambiar plan</button>
        <p v-if="choiceError" role="alert" class="mt-2 text-brand-error-text">{{ choiceError }}</p>
      </section>
      <NuxtLink v-if="accountExists" :to="loginLink" class="w-full max-w-[380px] text-sm font-semibold text-brand-blue underline">{{ chosenPlan ? 'Inicia sesión para continuar con el plan elegido' : 'Inicia sesión para continuar' }}</NuxtLink>
      <!-- Paso 1: Tu cuenta -->
      <div v-if="step === 1" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <template v-for="n in 5" :key="n">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                :class="n < step ? 'bg-brand-success-text text-brand-primary-fg' : n === step ? 'bg-brand-orange text-brand-primary-fg' : 'border border-brand-control-border text-brand-sites-muted'"
              >
                <Check v-if="n < step" class="h-3.5 w-3.5" :stroke-width="2.5" />
                <span v-else>{{ n }}</span>
              </div>
              <div v-if="n < 5" class="h-px flex-1 bg-brand-border" />
            </template>
          </div>
          <p class="text-xs font-semibold text-brand-sites-muted">Paso 1 de 5</p>
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

        <div class="grid grid-cols-2 gap-3">
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
          <input v-model="acceptedTerms" type="checkbox" class="mt-0.5 h-[18px] w-[18px] rounded-[3px] border-brand-control-border text-brand-orange focus:ring-brand-orange" />
          <span class="text-sm text-brand-text">Acepto los Términos y Condiciones y la Política de Privacidad</span>
        </label>

        <button
          type="button"
          :disabled="!canContinueStep1"
          class="flex w-full items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="step = 2"
        >
          Continuar <ArrowRight class="h-4 w-4" :stroke-width="2" />
        </button>

        <p class="text-center text-[13px] text-brand-sites-muted">
          ¿Ya tienes cuenta? <NuxtLink :to="loginLink" class="font-semibold text-brand-blue hover:underline">Iniciar sesión</NuxtLink>
        </p>
      </div>

      <!-- Paso 2: Tu organización -->
      <div v-else-if="step === 2" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <template v-for="n in 5" :key="n">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                :class="n < step ? 'bg-brand-success-text text-brand-primary-fg' : n === step ? 'bg-brand-orange text-brand-primary-fg' : 'border border-brand-control-border text-brand-sites-muted'"
              >
                <Check v-if="n < step" class="h-3.5 w-3.5" :stroke-width="2.5" />
                <span v-else>{{ n }}</span>
              </div>
              <div v-if="n < 5" class="h-px flex-1 bg-brand-border" />
            </template>
          </div>
          <p class="text-xs font-semibold text-brand-sites-muted">Paso 2 de 5</p>
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
          <label for="slug" class="text-[13px] font-semibold text-brand-text">Subdominio de tu organización</label>
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
              class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-brand-text placeholder:text-brand-sites-muted focus:outline-none focus:ring-0"
              @input="onSlugInput"
            />
            <span class="shrink-0 text-sm text-brand-sites-muted">.erpdinamico.com</span>
            <CircleCheck v-if="slugAvailable === true" class="h-4 w-4 shrink-0 text-brand-success-text" :stroke-width="2" />
          </div>
          <p v-if="slugAvailable === true" class="flex items-center gap-1 text-xs font-medium text-brand-success-text">
            <CircleCheck class="h-3.5 w-3.5" :stroke-width="2" /> Disponible — tu equipo entrará por {{ slug }}.erpdinamico.com
          </p>
          <p v-else-if="slugAvailable === false" class="text-xs font-medium text-brand-error-text">Ese subdominio ya está en uso, prueba con otro.</p>
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
            @click="step = 1"
          >
            <ArrowLeft class="h-4 w-4" :stroke-width="2" /> Atrás
          </button>
          <button
            type="button"
            :disabled="!canContinueStep2"
            class="flex flex-1 items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="step = 3"
          >
            Continuar <ArrowRight class="h-4 w-4" :stroke-width="2" />
          </button>
        </div>
      </div>

      <!-- Paso 3: Invita a tu equipo -->
      <div v-else-if="step === 3" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <template v-for="n in 5" :key="n">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                :class="n < step ? 'bg-brand-success-text text-brand-primary-fg' : n === step ? 'bg-brand-orange text-brand-primary-fg' : 'border border-brand-control-border text-brand-sites-muted'"
              >
                <Check v-if="n < step" class="h-3.5 w-3.5" :stroke-width="2.5" />
                <span v-else>{{ n }}</span>
              </div>
              <div v-if="n < 5" class="h-px flex-1 bg-brand-border" />
            </template>
          </div>
          <p class="text-xs font-semibold text-brand-sites-muted">Paso 3 de 5</p>
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

        <button type="button" class="flex items-center gap-1.5 self-start text-[13px] font-semibold text-brand-blue hover:underline" @click="addInvitee">
          <Plus class="h-3.5 w-3.5" :stroke-width="2.5" /> Agregar otro correo
        </button>

        <div class="flex gap-3">
          <button
            type="button"
            :disabled="loading"
            class="flex flex-1 items-center justify-center gap-2 rounded border border-brand-control-border px-4 py-[9px] text-sm font-semibold text-brand-text hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-60"
            @click="step = 2"
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
      <div v-else-if="step === 4 && result" class="flex w-full max-w-[380px] flex-col gap-5">
        <div class="flex flex-col items-center gap-3 text-center">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-brand-success-bg">
            <CircleCheck class="h-6 w-6 text-brand-success-text" :stroke-width="1.75" />
          </div>
          <h2 class="text-2xl font-bold text-brand-text">Confirma tu correo</h2>
          <p class="text-sm text-brand-text-secondary">Tu organización está creada. Solicitamos el envío de un código a {{ email }} para continuar.</p>
        </div>

        <div class="rounded bg-brand-surface">
          <div class="flex items-center gap-3 border-b border-brand-control-border px-4 py-3">
            <Building2 class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">Organización</span>
            <span class="text-sm font-semibold text-brand-text">{{ result.tenantName }}</span>
          </div>
          <div class="flex items-center gap-3 border-b border-brand-control-border px-4 py-3">
            <Link2 class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">URL</span>
            <span class="text-sm font-semibold text-brand-text">{{ result.slug }}.erpdinamico.com</span>
          </div>
          <div class="flex items-center gap-3 border-b border-brand-control-border px-4 py-3">
            <Users class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1 text-[13px] text-brand-text-secondary">Equipo</span>
            <span class="text-sm font-semibold text-brand-text">{{ result.invitationsSent }} invitaciones pendientes de envío</span>
          </div>
        </div>

        <NuxtLink
          to="/confirmar-correo"
          class="flex w-full items-center justify-center gap-2 rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover"
        >
          Ver estado de mi correo <ArrowRight class="h-4 w-4" :stroke-width="2" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

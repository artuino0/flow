<script setup lang="ts">
// HU-ERD-22 (backend/estado) + diseno aplicado desde ERPDinamico.pen
// (Screen/Login), estilo definido en las variables del archivo Pencil.
import { Check, ChevronDown, CircleAlert, ShieldCheck } from '@lucide/vue'
import type { OrganizationOption } from '~/composables/useAuth'
import { IDLE_RETURN_KEY, postLoginRoute, type IdleReturn } from '~/utils/returnToRoute'

definePageMeta({ layout: false })

const { login, loginWithTotp, selectOrganization, user } = useAuth()
const route = useRoute()

// HU multi-organizacion (2026-09-04): "la organizacion en el login no debe
// pedirse a fuerza en el primer paso... siempre y cuando tuviera mas de una
// organizacion el correo" (pedido explicito del usuario) - el campo
// "Organizacion" que este formulario tenia antes (placeholder tipo slug, ver
// versiones previas de este archivo) se elimina por completo. El login pide
// solo correo y contraseña; si la persona pertenece a mas de una
// organización, un paso nuevo ("Elegir organización") lo resuelve DESPUES de
// validar la identidad - ver el step 'org-select' mas abajo.
//
// GET /api/config (no useRuntimeConfig() - ver composables/useDeploymentConfig.ts)
// porque necesita reflejar el APP_MODE real del server en runtime, no el que
// habia al buildear. Se usa solo para el link "Crear cuenta" (el registro
// publico no existe en modo "dedicated", HU-ERD-35).
const { data: appConfig } = await useDeploymentConfig()
const isDedicated = computed(() => appConfig.value?.appMode === 'dedicated')

const email = ref('')
const password = ref('')
const remember = ref(false)
const errorMessage = ref('')
const loading = ref(false)

// HU-ERD-83 (parte 2): si el usuario tiene 2FA activo, login() no abre
// sesion todavia - devuelve un tempToken y hay que pedir el codigo de la app
// autenticadora antes de terminar.
//
// HU multi-organizacion (2026-09-04): tanto login() como loginWithTotp()
// pueden devolver requiresOrgSelection en vez de abrir sesion directamente -
// step 'org-select' pide con cual de las organizaciones de la persona
// continuar (pendingToken + organizations, ver composables/useAuth.ts).
//
// `?reason=inactividad` lo agrega layouts/default.vue al redirigir tras
// cerrar sesion por el modal de inactividad (composables/useIdleTimeout.ts) -
// solo informativo.
const step = ref<'password' | 'totp' | 'org-select'>('password')
const pendingTempToken = ref('')
const totpCode = ref('')
const pendingOrgToken = ref('')
const organizations = ref<OrganizationOption[]>([])
const inactivityNotice = route.query.reason === 'inactividad'
function finishLogin() {
  let saved: IdleReturn | null = null
  if (import.meta.client) {
    try { saved = JSON.parse(sessionStorage.getItem(IDLE_RETURN_KEY) || 'null') as IdleReturn | null } catch { saved = null }
    sessionStorage.removeItem(IDLE_RETURN_KEY)
  }
  return navigateTo(postLoginRoute(route.query.redirect, saved, user.value, inactivityNotice))
}

// HU multi-organizacion (2026-09-04), pantallas reales revisadas en Pencil
// ("Screen/Login - Elige tu organización" y su variante "(Select abierto)",
// nodos J4Fni/OT9h4) - el paso de organización es un select con el mismo
// patron de interaccion que components/DynamicSelectField.vue (trigger con
// el valor elegido + chevron, dropdown con las opciones, check en la
// seleccionada) en vez de una lista de botones. El botón "Continuar" queda
// deshabilitado hasta elegir una organización.
const selectedTenantId = ref('')
const selectedOrg = computed(() => organizations.value.find((o) => o.tenantId === selectedTenantId.value) ?? null)
const orgDropdownOpen = ref(false)
let orgDropdownCloseTimer: ReturnType<typeof setTimeout> | undefined

function openOrgDropdown() {
  if (orgDropdownCloseTimer) clearTimeout(orgDropdownCloseTimer)
  orgDropdownOpen.value = true
}

function scheduleCloseOrgDropdown() {
  orgDropdownCloseTimer = setTimeout(() => {
    orgDropdownOpen.value = false
  }, 150)
}

function pickOrganization(tenantId: string) {
  selectedTenantId.value = tenantId
  orgDropdownOpen.value = false
}

async function onSubmit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const result = await login(email.value, password.value)
    if (result.requiresTotp && result.tempToken) {
      pendingTempToken.value = result.tempToken
      step.value = 'totp'
      return
    }
    if (result.requiresOrgSelection && result.pendingToken && result.organizations) {
      pendingOrgToken.value = result.pendingToken
      organizations.value = result.organizations
      step.value = 'org-select'
      return
    }
    await finishLogin()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'No se pudo iniciar sesion.'
  } finally {
    loading.value = false
  }
}

async function onSubmitTotp() {
  errorMessage.value = ''
  loading.value = true
  try {
    const result = await loginWithTotp(pendingTempToken.value, totpCode.value)
    if (result.requiresOrgSelection && result.pendingToken && result.organizations) {
      pendingOrgToken.value = result.pendingToken
      organizations.value = result.organizations
      step.value = 'org-select'
      return
    }
    await finishLogin()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'Codigo invalido.'
  } finally {
    loading.value = false
  }
}

async function onSubmitOrgSelect() {
  if (!selectedTenantId.value) return
  errorMessage.value = ''
  loading.value = true
  try {
    await selectOrganization(pendingOrgToken.value, selectedTenantId.value)
    await finishLogin()
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'No se pudo entrar a esa organización.'
  } finally {
    loading.value = false
  }
}

const brandTagline = computed(() =>
  step.value === 'org-select'
    ? 'Tu correo pertenece a más de una organización. Elige con cuál continuar.'
    : 'Configura entidades, campos y relaciones sin escribir código.'
)
</script>

<template>
  <div class="flex min-h-screen font-sans">
    <div
      class="hidden w-[560px] shrink-0 flex-col justify-center gap-5 bg-[linear-gradient(200deg,#0091AE_0%,#213343_100%)] px-16 lg:flex"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-[14px] bg-white/15">
        <img src="/brand/isotipo-white.png" alt="Flow" class="h-9 w-9 object-contain" />
      </div>
      <h1 class="text-[42px] font-bold text-white">Flow</h1>
      <p class="w-[340px] text-[15px] text-[#DCEAF0]">
        {{ brandTagline }}
      </p>
    </div>

    <div class="flex flex-1 items-center justify-center bg-brand-surface px-4">
      <form v-if="step === 'password'" class="flex w-full max-w-[380px] flex-col gap-5" @submit.prevent="onSubmit">
        <div>
          <h2 class="text-2xl font-bold text-brand-text">Iniciar sesión</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Ingresa con las credenciales de tu organización</p>
        </div>

        <div v-if="inactivityNotice" class="flex items-start gap-2 rounded bg-brand-warning-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-warning-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-warning-text">Tu sesión se cerró por inactividad.</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="email" class="text-[13px] font-semibold text-brand-text">Correo electrónico</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="username"
            placeholder="admin@acme.com"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-[13px] font-semibold text-brand-text">Contraseña</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="flex items-center justify-between">
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="remember" type="checkbox" class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange" />
            <span class="text-sm text-brand-text">Recordarme</span>
          </label>
          <NuxtLink to="/recuperar" class="text-[13px] font-semibold text-brand-blue hover:underline">
            ¿Olvidaste tu contraseña?
          </NuxtLink>
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ loading ? 'Ingresando...' : 'Iniciar sesión' }}
        </button>

        <p class="text-center text-[13px] text-brand-text-muted">
          ¿Problemas para ingresar? Contacta a tu administrador.
        </p>

        <!-- HU multi-organizacion (2026-09-04): el registro publico no existe en
             modo "dedicated" (HU-ERD-35, un solo cliente por deployment) - el link
             se oculta ahi, mismo criterio que el campo Organizacion de antes. -->
        <p v-if="!isDedicated" class="text-center text-[13px] text-brand-text-muted">
          ¿No tienes cuenta?
          <NuxtLink to="/registro" class="font-semibold text-brand-blue hover:underline">Crea tu organización</NuxtLink>
        </p>
      </form>

      <!-- HU-ERD-83 (parte 2): paso 2 del login cuando el usuario tiene 2FA activo. -->
      <form v-else-if="step === 'totp'" class="flex w-full max-w-[380px] flex-col gap-5" @submit.prevent="onSubmitTotp">
        <div>
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue-bg">
            <ShieldCheck class="h-5 w-5 text-brand-blue" :stroke-width="1.75" />
          </div>
          <h2 class="text-2xl font-bold text-brand-text">Verificación en dos pasos</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Ingresa el código de tu app autenticadora</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="totpCode" class="text-[13px] font-semibold text-brand-text">Código de 6 dígitos</label>
          <input
            id="totpCode"
            v-model="totpCode"
            type="text"
            inputmode="numeric"
            maxlength="6"
            required
            autofocus
            placeholder="000000"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-center text-lg font-semibold tracking-[0.3em] text-brand-text placeholder:tracking-normal placeholder:text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ loading ? 'Verificando...' : 'Verificar' }}
        </button>

        <button type="button" class="text-center text-[13px] font-semibold text-brand-blue hover:underline" @click="step = 'password'">
          Volver
        </button>
      </form>

      <!-- HU multi-organizacion (2026-09-04): "Screen/Login - Elige tu
           organización" (+ variante "Select abierto"), revisado en Pencil
           antes de construir (nodos J4Fni/OT9h4) - select con el mismo patron
           de interaccion que components/DynamicSelectField.vue (trigger con
           el valor elegido + chevron, dropdown con las opciones, check en la
           seleccionada), no una lista de botones. "Continuar" queda
           deshabilitado hasta elegir una organización - nunca se vuelve a
           pedir contraseña ni código TOTP en este paso. -->
      <form v-else-if="step === 'org-select'" class="flex w-full max-w-[380px] flex-col gap-5" @submit.prevent="onSubmitOrgSelect">
        <div>
          <h2 class="text-2xl font-bold text-brand-text">Elige tu organización</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Selecciona la organización con la que quieres continuar</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] font-semibold text-brand-text">Organización</label>
          <div class="relative">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-left text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              @click="orgDropdownOpen ? (orgDropdownOpen = false) : openOrgDropdown()"
              @blur="scheduleCloseOrgDropdown"
            >
              <span :class="selectedOrg ? 'text-brand-text' : 'text-brand-text-muted'">
                {{ selectedOrg ? selectedOrg.tenantName : 'Selecciona una organización' }}
              </span>
              <ChevronDown class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="2" />
            </button>

            <div v-if="orgDropdownOpen" class="absolute z-10 mt-1 w-full overflow-hidden rounded border border-brand-border-light bg-brand-surface shadow-lg">
              <button
                v-for="org in organizations"
                :key="org.tenantId"
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-text hover:bg-brand-bg"
                @mousedown.prevent="pickOrganization(org.tenantId)"
              >
                <span class="min-w-0 flex-1 truncate">{{ org.tenantName }}</span>
                <Check v-if="selectedTenantId === org.tenantId" class="h-3.5 w-3.5 shrink-0 text-brand-orange" :stroke-width="2.5" />
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          :disabled="!selectedTenantId || loading"
          class="w-full rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ loading ? 'Entrando...' : 'Continuar' }}
        </button>

        <p class="text-center text-[13px] text-brand-text-muted">
          ¿Problemas para ingresar? Contacta a tu administrador.
        </p>
      </form>
    </div>
  </div>
</template>

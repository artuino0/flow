<script setup lang="ts">
// HU-ERD-22 (backend/estado) + diseno aplicado desde ERPDinamico.pen
// (Screen/Login), estilo definido en las variables del archivo Pencil.
import { Boxes, Building2, CircleAlert, ShieldCheck } from '@lucide/vue'
import type { OrganizationOption } from '~/composables/useAuth'

definePageMeta({ layout: false })

const { login, loginWithTotp, selectOrganization } = useAuth()
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
const selectingTenantId = ref('')
const inactivityNotice = route.query.reason === 'inactividad'

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
    await navigateTo('/')
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
    await navigateTo('/')
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'Codigo invalido.'
  } finally {
    loading.value = false
  }
}

async function onSelectOrganization(tenantId: string) {
  errorMessage.value = ''
  selectingTenantId.value = tenantId
  loading.value = true
  try {
    await selectOrganization(pendingOrgToken.value, tenantId)
    await navigateTo('/')
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'No se pudo entrar a esa organización.'
  } finally {
    loading.value = false
    selectingTenantId.value = ''
  }
}
</script>

<template>
  <div class="flex min-h-screen font-sans">
    <div
      class="hidden w-[560px] shrink-0 flex-col justify-center gap-5 bg-[linear-gradient(200deg,#0091AE_0%,#213343_100%)] px-16 lg:flex"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-[14px] bg-white/15">
        <Boxes class="h-[34px] w-[34px] text-white" :stroke-width="1.75" />
      </div>
      <h1 class="text-[28px] font-bold text-white">ERP Dinámico</h1>
      <p class="w-[340px] text-[15px] text-[#DCEAF0]">
        Configurá entidades, campos y relaciones sin escribir código.
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
          <!-- Recuperacion de contraseña todavia no tiene endpoint - placeholder visual del diseno. -->
          <button type="button" class="text-[13px] font-semibold text-brand-blue hover:underline">
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ loading ? 'Ingresando...' : 'Iniciar sesión' }}
        </button>

        <p class="text-center text-[13px] text-brand-text-muted">
          ¿Problemas para ingresar? Contactá a tu administrador.
        </p>

        <!-- HU multi-organizacion (2026-09-04): el registro publico no existe en
             modo "dedicated" (HU-ERD-35, un solo cliente por deployment) - el link
             se oculta ahi, mismo criterio que el campo Organizacion de antes. -->
        <p v-if="!isDedicated" class="text-center text-[13px] text-brand-text-muted">
          ¿No tenés cuenta?
          <NuxtLink to="/registro" class="font-semibold text-brand-blue hover:underline">Creá tu organización</NuxtLink>
        </p>
      </form>

      <!-- HU-ERD-83 (parte 2): paso 2 del login cuando el usuario tiene 2FA activo. -->
      <form v-else-if="step === 'totp'" class="flex w-full max-w-[380px] flex-col gap-5" @submit.prevent="onSubmitTotp">
        <div>
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue-bg">
            <ShieldCheck class="h-5 w-5 text-brand-blue" :stroke-width="1.75" />
          </div>
          <h2 class="text-2xl font-bold text-brand-text">Verificación en dos pasos</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Ingresá el código de tu app autenticadora</p>
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

      <!-- HU multi-organizacion (2026-09-04): paso nuevo, sin diseño Pencil propio
           (se buscó en el archivo .pen - no existe un "Screen/Elegir organización" -
           ver comentario largo en el codigo del proyecto). Se construye con el mismo
           lenguaje visual que los demas pasos de este formulario (contenedor, tipografia,
           botones) en vez de inventar un estilo nuevo. -->
      <div v-else-if="step === 'org-select'" class="flex w-full max-w-[380px] flex-col gap-5">
        <div>
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue-bg">
            <Building2 class="h-5 w-5 text-brand-blue" :stroke-width="1.75" />
          </div>
          <h2 class="text-2xl font-bold text-brand-text">Elegí tu organización</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Tu correo pertenece a más de una organización</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <button
            v-for="org in organizations"
            :key="org.tenantId"
            type="button"
            :disabled="loading"
            class="flex items-center gap-3 rounded border border-brand-border px-3 py-2.5 text-left text-sm font-semibold text-brand-text hover:border-brand-blue hover:bg-brand-blue-bg disabled:cursor-not-allowed disabled:opacity-60"
            @click="onSelectOrganization(org.tenantId)"
          >
            <Building2 class="h-4 w-4 shrink-0 text-brand-text-secondary" :stroke-width="1.75" />
            <span class="flex-1">{{ org.tenantName }}</span>
            <span v-if="selectingTenantId === org.tenantId" class="text-[13px] font-normal text-brand-text-muted">Entrando...</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

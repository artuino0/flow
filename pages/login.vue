<script setup lang="ts">
// HU-ERD-22 (backend/estado) + diseno aplicado desde ERPDinamico.pen
// (Screen/Login), estilo definido en las variables del archivo Pencil.
import { Boxes, CircleAlert } from '@lucide/vue'

definePageMeta({ layout: false })

const { login } = useAuth()

// El diseno pide un campo "Organizacion" (placeholder tipo slug, ej. "acme"),
// pero el backend (server/api/auth/login.post.ts) todavia exige un tenantId
// UUID crudo - no existe una tabla de tenants con slug para resolverlo. Se
// mantiene el label del diseno pero el campo sigue funcionando como antes
// (UUID) hasta que exista esa resolucion.
//
// HU-ERD-35: en modo "dedicated" (APP_MODE) directamente no se muestra - un
// deployment de un solo cliente no tiene nada que preguntar aca. GET /api/config
// (no useRuntimeConfig() - ver composables/useDeploymentConfig.ts) porque
// necesita reflejar el APP_MODE real del server en runtime, no el que habia
// al buildear.
const { data: appConfig } = await useDeploymentConfig()
const isDedicated = computed(() => appConfig.value?.appMode === 'dedicated')

const tenantId = ref('')
const email = ref('')
const password = ref('')
const remember = ref(false)
const errorMessage = ref('')
const loading = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  loading.value = true
  try {
    await login(isDedicated.value ? undefined : tenantId.value, email.value, password.value)
    await navigateTo('/')
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'No se pudo iniciar sesion.'
  } finally {
    loading.value = false
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
      <form class="flex w-full max-w-[380px] flex-col gap-5" @submit.prevent="onSubmit">
        <div>
          <h2 class="text-2xl font-bold text-brand-text">Iniciar sesión</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Ingresa con las credenciales de tu organización</p>
        </div>

        <div v-if="errorMessage" class="flex items-start gap-2 rounded bg-brand-error-bg px-3 py-2.5">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-brand-error-text" :stroke-width="2" />
          <p class="text-[13px] font-medium text-brand-error-text">{{ errorMessage }}</p>
        </div>

        <div v-if="!isDedicated" class="flex flex-col gap-1.5">
          <label for="tenantId" class="text-[13px] font-semibold text-brand-text">Organización</label>
          <input
            id="tenantId"
            v-model="tenantId"
            type="text"
            required
            placeholder="acme"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
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
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
// HU-ERD-84: pantalla de aceptar invitacion. El .pen NO tiene un mock para
// esta pantalla (solo dibuja el modal "Invitar usuario" del lado del admin y
// el correo que se envia, Email/Invitación Usuario) - se reutiliza fielmente
// el lenguaje visual ya establecido en pages/login.vue (mismo layout partido,
// misma tarjeta con degradé, mismos estilos de input) en vez de inventar uno
// nuevo, siguiendo el mismo criterio que pages/mi-cuenta.vue.
//
// Ruta /invitacion/:token (no /aceptar-invitacion?token=) porque asi es como
// el correo real arma el enlace (Email/Invitación Usuario, nodo hOZJI:
// "app.erpdinamico.com/invitacion/8f3a2c91").
import { CircleAlert, CircleCheck } from '@lucide/vue'

definePageMeta({ layout: false, darkReady: true })

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))

const fullName = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const loading = ref(false)
const done = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  if (password.value !== confirmPassword.value) {
    errorMessage.value = 'La confirmación no coincide con la contraseña'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/users/accept-invitation', {
      method: 'POST',
      body: { token: token.value, password: password.value, fullName: fullName.value.trim() || undefined }
    })
    done.value = true
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || 'No se pudo aceptar la invitación.'
  } finally {
    loading.value = false
  }
}
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
      <p class="w-[340px] text-[15px] text-brand-access-description">
        Configura entidades, campos y relaciones sin escribir código.
      </p>
    </div>

    <div class="flex flex-1 items-center justify-center bg-brand-surface px-4">
      <div v-if="done" class="flex w-full max-w-[380px] flex-col items-center gap-4 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-brand-success-bg">
          <CircleCheck class="h-6 w-6 text-brand-success-text" :stroke-width="1.75" />
        </div>
        <h2 class="text-2xl font-bold text-brand-text">Cuenta activada</h2>
        <p class="text-sm text-brand-text-secondary">Ya puedes iniciar sesión con tu correo y la contraseña que elegiste.</p>
        <NuxtLink
          to="/login"
          class="mt-2 w-full rounded bg-brand-orange px-4 py-[9px] text-center text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover"
        >
          Ir a iniciar sesión
        </NuxtLink>
      </div>

      <form v-else class="flex w-full max-w-[380px] flex-col gap-5" @submit.prevent="onSubmit">
        <div>
          <h2 class="text-2xl font-bold text-brand-text">Aceptar invitación</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Elige tu nombre y una contraseña para activar tu cuenta</p>
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
            placeholder="María López"
            class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-sites-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

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
          <p class="text-xs text-brand-sites-muted">Al menos 8 caracteres, con letras y números.</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="confirmPassword" class="text-[13px] font-semibold text-brand-text">Confirmar contraseña</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            required
            autocomplete="new-password"
            class="w-full rounded border border-brand-control-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded bg-brand-orange px-4 py-[9px] text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ loading ? 'Activando...' : 'Activar cuenta' }}
        </button>
      </form>
    </div>
  </div>
</template>

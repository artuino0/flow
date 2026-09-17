<script setup lang="ts">
// HU-ERD-83 (parte 2): pantalla "Mi cuenta" - cambio de contraseña (endpoint
// ya existia desde la parte 1, sin UI hasta ahora) + activar/desactivar 2FA
// por TOTP. Sin mock en el .pen (revisado antes de construir -
// [[pencil-antes-de-frontend]]: el unico Screen con "cuenta" en el nombre es
// "Registro Paso 1 - Tu cuenta", que es alta de una organizacion NUEVA, no
// esto) - se construyo siguiendo el lenguaje visual general del resto de la
// app (cards con borde+sombra, inputs Field/Text, boton naranja primario).
import { UserRound, KeyRound, ShieldCheck, ShieldOff, QrCode, Copy, Check } from '@lucide/vue'

defineProps<{ mode: 'profile' | 'security' }>()
const emit = defineEmits<{ dirty: [boolean]; security: [] }>()

const { user, fetchMe } = useAuth()
if (!user.value) await fetchMe()

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts.
const toast = useToast()

const profileEditing = ref(false)
function cancelProfile() {
  profile.fullName = user.value?.fullName || ''
  profile.phone = user.value?.phone || ''
  profile.jobTitle = user.value?.jobTitle || ''
  profile.timezone = user.value?.timezone || 'America/Mexico_City'
  profileEditing.value = false
  profileError.value = ''
}
const profileSaving = ref(false)
const profileError = ref('')
const profile = reactive({ fullName: '', phone: '', jobTitle: '', timezone: '' })
watch(user, (value) => {
  if (!value) return
  profile.fullName = value.fullName || ''
  profile.phone = value.phone || ''
  profile.jobTitle = value.jobTitle || ''
  profile.timezone = value.timezone || 'America/Mexico_City'
}, { immediate: true })

async function saveProfile() {
  profileError.value = ''; profileSaving.value = true
  try {
    await $fetch('/api/auth/profile', { method: 'PUT', body: { ...profile, phone: profile.phone || null, jobTitle: profile.jobTitle || null, timezone: profile.timezone || null } })
    await fetchMe(); profileEditing.value = false
    toast.updated('Perfil actualizado', 'Tus datos personales se guardaron correctamente.')
  } catch (err: any) { profileError.value = err?.data?.statusMessage || 'No se pudo guardar el perfil'; toast.error('No se pudo guardar el perfil', profileError.value) }
  finally { profileSaving.value = false }
}

// --- Cambiar contraseña -----------------------------------------------
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const savingPassword = ref(false)

async function onChangePassword() {
  passwordError.value = ''
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'La confirmación no coincide con la contraseña nueva'
    return
  }
  savingPassword.value = true
  try {
    await $fetch('/api/auth/password', {
      method: 'PUT',
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value }
    })
    toast.updated('Contraseña actualizada', 'Tu contraseña se cambió correctamente.')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (err: any) {
    passwordError.value = err?.data?.statusMessage || 'No se pudo cambiar la contraseña'
    toast.error('No se pudo cambiar la contraseña', passwordError.value)
  } finally {
    savingPassword.value = false
  }
}

// --- 2FA (TOTP) ----------------------------------------------------------
type TotpStep = 'idle' | 'setup' | 'disabling'
const totpStep = ref<TotpStep>('idle')
const totpEnabled = computed(() => user.value?.totpEnabled ?? false)

const totpSecret = ref('')
const totpQrCodeDataUrl = ref('')
const totpVerifyCode = ref('')
const totpError = ref('')
const totpLoading = ref(false)
const secretCopied = ref(false)

async function startTotpSetup() {
  totpError.value = ''
  totpLoading.value = true
  try {
    const result = await $fetch<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>('/api/auth/totp/setup', { method: 'POST' })
    totpSecret.value = result.secret
    totpQrCodeDataUrl.value = result.qrCodeDataUrl
    totpVerifyCode.value = ''
    totpStep.value = 'setup'
  } catch (err: any) {
    totpError.value = err?.data?.statusMessage || 'No se pudo iniciar la configuración de 2FA'
  } finally {
    totpLoading.value = false
  }
}

async function confirmTotpSetup() {
  totpError.value = ''
  totpLoading.value = true
  try {
    await $fetch('/api/auth/totp/verify', { method: 'POST', body: { code: totpVerifyCode.value } })
    totpStep.value = 'idle'
    await fetchMe()
    toast.success('Verificación en dos pasos activada', 'Tu cuenta ahora está protegida con 2FA.')
  } catch (err: any) {
    totpError.value = err?.data?.statusMessage || 'Código inválido'
    toast.error('No se pudo activar la verificación en dos pasos', totpError.value)
  } finally {
    totpLoading.value = false
  }
}

function cancelTotpSetup() {
  totpStep.value = 'idle'
  totpSecret.value = ''
  totpQrCodeDataUrl.value = ''
  totpVerifyCode.value = ''
  totpError.value = ''
}

const disablePassword = ref('')

async function confirmTotpDisable() {
  totpError.value = ''
  totpLoading.value = true
  try {
    await $fetch('/api/auth/totp/disable', { method: 'POST', body: { password: disablePassword.value } })
    disablePassword.value = ''
    totpStep.value = 'idle'
    await fetchMe()
    toast.updated('Verificación en dos pasos desactivada', 'Tu cuenta ya no usa 2FA.')
  } catch (err: any) {
    totpError.value = err?.data?.statusMessage || 'No se pudo desactivar el 2FA'
    toast.error('No se pudo desactivar el 2FA', totpError.value)
  } finally {
    totpLoading.value = false
  }
}

async function copySecret() {
  try {
    await navigator.clipboard.writeText(totpSecret.value)
    secretCopied.value = true
    setTimeout(() => (secretCopied.value = false), 2000)
  } catch {
    // portapapeles no disponible (contexto no seguro, permiso denegado) - el
    // secreto ya esta visible como texto para copiar a mano.
  }
}
watch(() => [profileEditing.value && JSON.stringify(profile) !== JSON.stringify({ fullName: user.value?.fullName || '', phone: user.value?.phone || '', jobTitle: user.value?.jobTitle || '', timezone: user.value?.timezone || 'America/Mexico_City' }), currentPassword.value, newPassword.value, confirmPassword.value, totpStep.value !== 'idle'], values => emit('dirty', values.some(Boolean)), { deep: true })
onBeforeUnmount(() => emit('dirty', false))
</script>

<template>
  <div class="flex flex-col gap-5">
    

    <div v-if="mode === 'profile'" class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
      <div class="flex items-center gap-3 border-b border-brand-border-light p-5">
        <UserRound class="h-[18px] w-[18px] text-brand-blue" :stroke-width="1.75" />
        <h2 class="text-[15px] font-bold text-brand-text">Tu perfil</h2>
      </div>
      <div class="flex flex-col gap-4 p-5">
        <div class="flex items-center gap-3"><span class="flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue-bg text-lg font-semibold text-brand-blue">{{ (user?.fullName || user?.email || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase() }}</span><div><p class="text-sm font-semibold text-brand-text">{{ user?.fullName }}</p><p class="text-xs text-brand-text-muted">{{ user?.jobTitle || user?.email }}</p></div></div>
        <p v-if="profileError" class="text-sm text-brand-error-text">{{ profileError }}</p>
        <template v-if="profileEditing">
          <div class="grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Nombre completo<input v-model="profile.fullName" required class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Teléfono<input v-model="profile.phone" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Puesto o cargo<input v-model="profile.jobTitle" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Zona horaria<select v-model="profile.timezone" class="rounded border border-brand-border bg-brand-surface px-3 py-2 text-sm font-normal"><option value="America/Mexico_City">Ciudad de México</option><option value="America/Bogota">Bogotá</option><option value="America/Lima">Lima</option><option value="UTC">UTC</option></select></label></div>
          <div class="flex justify-end gap-2"><button type="button" class="rounded border border-brand-border px-3 py-2 text-sm font-semibold text-brand-text" @click="cancelProfile">Cancelar</button><button type="button" class="rounded bg-brand-orange px-3 py-2 text-sm font-semibold text-white" :disabled="profileSaving" @click="saveProfile">{{ profileSaving ? 'Guardando...' : 'Guardar cambios' }}</button></div>
        </template>
        <template v-else>
          <div class="grid gap-3 sm:grid-cols-2"><div><span class="text-[13px] font-semibold text-brand-text-muted">Nombre completo</span><p class="text-sm text-brand-text">{{ user?.fullName || 'Sin nombre' }}</p></div><div><span class="text-[13px] font-semibold text-brand-text-muted">Correo electrónico</span><p class="text-sm text-brand-text">{{ user?.email }}</p></div><div><span class="text-[13px] font-semibold text-brand-text-muted">Teléfono</span><p class="text-sm text-brand-text">{{ user?.phone || 'Sin teléfono' }}</p></div><div><span class="text-[13px] font-semibold text-brand-text-muted">Puesto o cargo</span><p class="text-sm text-brand-text">{{ user?.jobTitle || 'Sin puesto' }}</p></div></div>
          <div class="grid gap-3 sm:grid-cols-2"><div><span class="text-[13px] font-semibold text-brand-text-muted">Organización</span><p class="text-sm text-brand-text">{{ user?.tenantName }}</p></div><div><span class="text-[13px] font-semibold text-brand-text-muted">Zona horaria</span><p class="text-sm text-brand-text">{{ user?.timezone || 'Predeterminada de la organización' }}</p></div></div>
          <div class="flex justify-between gap-3"><button type="button" class="text-sm font-semibold text-brand-blue" @click="emit('security')">Cambiar contraseña</button><button type="button" class="rounded border border-brand-border px-3 py-2 text-sm font-semibold text-brand-text" @click="profileEditing = true">Editar perfil</button></div>
        </template>
      </div>
    </div>

    <div v-if="mode === 'security'" class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
      <div class="flex items-center gap-3 border-b border-brand-border-light p-5">
        <KeyRound class="h-[18px] w-[18px] text-brand-blue" :stroke-width="1.75" />
        <h2 class="text-[15px] font-bold text-brand-text">Cambiar contraseña</h2>
      </div>
      <form class="flex flex-col gap-4 p-5" @submit.prevent="onChangePassword">
        <p v-if="passwordError" class="text-sm text-brand-error-text">{{ passwordError }}</p>

        <div class="flex flex-col gap-1.5">
          <label for="currentPassword" class="text-[13px] font-semibold text-brand-text">Contraseña actual</label>
          <input
            id="currentPassword"
            v-model="currentPassword"
            type="password"
            required
            autocomplete="current-password"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="newPassword" class="text-[13px] font-semibold text-brand-text">Contraseña nueva</label>
          <input
            id="newPassword"
            v-model="newPassword"
            type="password"
            required
            autocomplete="new-password"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
          <p class="text-xs text-brand-text-muted">Al menos 8 caracteres, con letras y números.</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="confirmPassword" class="text-[13px] font-semibold text-brand-text">Confirmar contraseña nueva</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            required
            autocomplete="new-password"
            class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div class="flex justify-end">
          <button
            type="submit"
            :disabled="savingPassword"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ savingPassword ? 'Guardando...' : 'Cambiar contraseña' }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="mode === 'security'" class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
      <div class="flex items-center justify-between border-b border-brand-border-light p-5">
        <div class="flex items-center gap-3">
          <ShieldCheck class="h-[18px] w-[18px] text-brand-blue" :stroke-width="1.75" />
          <h2 class="text-[15px] font-bold text-brand-text">Autenticación en dos pasos</h2>
        </div>
        <span
          v-if="totpEnabled"
          class="rounded-full bg-brand-success-bg px-2.5 py-1 text-xs font-semibold text-brand-success-text"
        >
          Activa
        </span>
        <span v-else class="rounded-full bg-brand-bg px-2.5 py-1 text-xs font-semibold text-brand-text-muted">
          Inactiva
        </span>
      </div>

      <div class="flex flex-col gap-4 p-5">
        <p v-if="totpError" class="text-sm text-brand-error-text">{{ totpError }}</p>

        <!-- Estado: sin 2FA, sin setup en curso -->
        <template v-if="!totpEnabled && totpStep === 'idle'">
          <p class="text-sm text-brand-text-secondary">
            Agrega un segundo paso al iniciar sesión con una app autenticadora (Google Authenticator, Authy, etc.).
          </p>
          <div>
            <button
              type="button"
              :disabled="totpLoading"
              class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              @click="startTotpSetup"
            >
              {{ totpLoading ? 'Generando...' : 'Activar 2FA' }}
            </button>
          </div>
        </template>

        <!-- Estado: setup en curso -->
        <template v-else-if="!totpEnabled && totpStep === 'setup'">
          <p class="text-sm text-brand-text-secondary">Escaneá este código con tu app autenticadora:</p>
          <div class="flex items-center gap-4">
            <img v-if="totpQrCodeDataUrl" :src="totpQrCodeDataUrl" alt="Código QR para configurar 2FA" class="h-36 w-36 rounded border border-brand-border-light" />
            <div class="flex flex-1 flex-col gap-1.5">
              <span class="flex items-center gap-1.5 text-[13px] font-semibold text-brand-text-muted">
                <QrCode class="h-3.5 w-3.5" :stroke-width="1.75" />
                O cargá el código manualmente:
              </span>
              <div class="flex items-center gap-2">
                <code class="flex-1 truncate rounded border border-brand-border-light bg-brand-bg px-2.5 py-1.5 text-xs text-brand-text">{{ totpSecret }}</code>
                <button
                  type="button"
                  title="Copiar código"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg"
                  @click="copySecret"
                >
                  <Check v-if="secretCopied" class="h-4 w-4 text-brand-success-text" :stroke-width="2" />
                  <Copy v-else class="h-4 w-4" :stroke-width="1.75" />
                </button>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="totpVerifyCode" class="text-[13px] font-semibold text-brand-text">Código de 6 dígitos</label>
            <input
              id="totpVerifyCode"
              v-model="totpVerifyCode"
              type="text"
              inputmode="numeric"
              maxlength="6"
              placeholder="000000"
              class="w-full max-w-[160px] rounded border border-brand-border px-3 py-[9px] text-center text-sm font-semibold tracking-[0.3em] text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>

          <div class="flex gap-3">
            <button
              type="button"
              :disabled="totpLoading || totpVerifyCode.length !== 6"
              class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              @click="confirmTotpSetup"
            >
              {{ totpLoading ? 'Verificando...' : 'Verificar y activar' }}
            </button>
            <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="cancelTotpSetup">
              Cancelar
            </button>
          </div>
        </template>

        <!-- Estado: 2FA activo, sin pedido de desactivar -->
        <template v-else-if="totpEnabled && totpStep === 'idle'">
          <p class="text-sm text-brand-text-secondary">Tu cuenta pide un código de tu app autenticadora en cada inicio de sesión.</p>
          <div>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
              @click="totpStep = 'disabling'"
            >
              <ShieldOff class="h-4 w-4" :stroke-width="1.75" />
              Desactivar 2FA
            </button>
          </div>
        </template>

        <!-- Estado: confirmando desactivacion -->
        <template v-else-if="totpEnabled && totpStep === 'disabling'">
          <p class="text-sm text-brand-text-secondary">Ingresa tu contraseña actual para desactivar el 2FA.</p>
          <div class="flex flex-col gap-1.5">
            <label for="disablePassword" class="text-[13px] font-semibold text-brand-text">Contraseña actual</label>
            <input
              id="disablePassword"
              v-model="disablePassword"
              type="password"
              autocomplete="current-password"
              class="w-full max-w-xs rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          <div class="flex gap-3">
            <button
              type="button"
              :disabled="totpLoading || !disablePassword"
              class="rounded bg-brand-error-text px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              @click="confirmTotpDisable"
            >
              {{ totpLoading ? 'Desactivando...' : 'Confirmar desactivación' }}
            </button>
            <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="totpStep = 'idle'; disablePassword = ''">
              Cancelar
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

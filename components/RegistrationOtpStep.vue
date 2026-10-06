<script setup lang="ts">
import { MailCheck, RefreshCw } from '@lucide/vue'
import { computed } from 'vue'

const props = defineProps<{
  email: string
  code: string
  newEmail: string
  changing: boolean
  busy: boolean
  busyAction: 'verify' | 'resend' | 'change-email' | null
  seconds: number
  message: string
  error: string
  delivery?: string
  invitationFailures: number
}>()
const secondsDisplay = computed(() => `${Math.floor(props.seconds / 60)}:${String(props.seconds % 60).padStart(2, '0')}`)

const emit = defineEmits<{
  'update:code': [value: string]
  'update:newEmail': [value: string]
  'confirm-code': []
  'resend-code': []
  'start-email-change': []
  'change-email': []
  'cancel-email-change': []
}>()
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-info-bg"><MailCheck class="h-5 w-5 text-brand-info-text" aria-hidden="true" /></div>
      <h1 class="text-2xl font-bold text-brand-text">Verifica tu correo</h1>
      <p class="mt-2 text-sm leading-6 text-brand-text-secondary">Tu organización ya está creada. Enviamos un código de 6 dígitos a <strong class="break-words text-brand-text">{{ email }}</strong>. Ingrésalo para continuar. El código vence en 15 minutos.</p>
    </div>

    <p v-if="delivery === 'failed'" role="alert" class="rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">No pudimos enviar el código; reenvíalo.</p>
    <p v-else-if="delivery === 'queued'" role="status" class="rounded bg-brand-info-bg p-3 text-sm text-brand-info-text">El envío está pendiente. Si no llega, solicita un código nuevo.</p>
    <p v-if="invitationFailures" role="status" class="rounded bg-brand-warning-bg p-3 text-sm text-brand-warning-text">{{ invitationFailures }} invitaciones no se pudieron enviar. Podrás reenviarlas desde Usuarios al activar tu organización.</p>
    <p v-if="message" role="status" class="rounded bg-brand-success-bg p-3 text-sm text-brand-success-text">{{ message }}</p>
    <p v-if="error" id="verification-error" role="alert" class="rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ error }}</p>

    <form v-if="!changing" class="space-y-4" @submit.prevent="emit('confirm-code')">
      <label for="verification-code" class="sr-only">Código de seis dígitos</label>
      <div class="relative grid grid-cols-6 gap-1.5 rounded focus-within:outline focus-within:outline-2 focus-within:outline-brand-blue sm:gap-2">
        <span v-for="slot in 6" :key="slot" aria-hidden="true" class="flex h-12 items-center justify-center rounded border bg-brand-surface text-xl font-semibold tabular-nums text-brand-text" :class="error ? 'border-brand-error-text' : code.length === slot - 1 ? 'border-brand-orange' : 'border-brand-control-border'">{{ code[slot - 1] || '' }}</span>
        <input id="verification-code" :value="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required :disabled="busy" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'verification-error' : 'code-help'" class="absolute inset-0 h-full w-full cursor-text opacity-0" @input="emit('update:code', ($event.target as HTMLInputElement).value)" />
      </div>
      <p id="code-help" class="text-xs text-brand-text-secondary">Puedes pegar el código completo. Usa el del último correo recibido.</p>
      <p class="text-center text-xs text-brand-text-secondary">¿No llegó? <button type="button" :disabled="busy || seconds > 0" class="font-semibold text-brand-blue underline underline-offset-2 disabled:no-underline disabled:opacity-60" @click="emit('resend-code')">{{ busyAction === 'resend' ? 'Enviando código…' : seconds > 0 ? `Reenviar código en ${secondsDisplay}` : 'Reenviar código' }}</button></p>
      <button type="submit" :disabled="busy || !/^\d{6}$/.test(code)" class="w-full rounded bg-brand-orange px-4 py-3 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50">{{ busyAction === 'verify' ? 'Verificando…' : 'Verificar y continuar' }}</button>
    </form>
    <form v-else class="space-y-4" @submit.prevent="emit('change-email')">
      <label for="new-email" class="block text-sm font-semibold text-brand-text">Nuevo correo electrónico</label>
      <input id="new-email" :value="newEmail" type="email" required autocomplete="email" :disabled="busy" class="w-full rounded border border-brand-control-border bg-brand-surface px-3 py-3 text-brand-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" @input="emit('update:newEmail', ($event.target as HTMLInputElement).value)" />
      <div class="flex flex-wrap gap-3">
        <button type="submit" :disabled="busy || seconds > 0" class="rounded bg-brand-orange px-4 py-3 text-sm font-semibold text-brand-primary-fg disabled:opacity-50">{{ busyAction === 'change-email' ? 'Guardando…' : 'Guardar y enviar' }}</button>
        <button type="button" :disabled="busy" class="rounded px-3 py-3 text-sm text-brand-text-secondary focus-visible:outline focus-visible:outline-brand-blue" @click="emit('cancel-email-change')">Cancelar</button>
      </div>
    </form>

    <div class="flex flex-wrap gap-3">
      <button v-if="changing" type="button" :disabled="busy || seconds > 0" class="inline-flex items-center gap-2 rounded border border-brand-control-border px-3 py-3 text-sm font-semibold text-brand-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50" @click="emit('resend-code')"><RefreshCw class="h-4 w-4" aria-hidden="true" />{{ busyAction === 'resend' ? 'Enviando código…' : seconds > 0 ? `Reenviar código en ${secondsDisplay}` : 'Reenviar código' }}</button>
      <button v-if="!changing" type="button" :disabled="busy" class="w-full rounded px-3 py-2 text-center text-sm font-semibold text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50" @click="emit('start-email-change')">Usar otro correo</button>
    </div>
    <p class="border-t border-brand-border-light pt-4 text-xs leading-5 text-brand-text-secondary">Puedes solicitar un código cada minuto y hasta cinco por hora. El enlace de respaldo del correo también permite confirmar tu cuenta.</p>
  </div>
</template>

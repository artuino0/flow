<script setup lang="ts">
// HU-ERD-83 (parte 2): modal de aviso de inactividad - mostrado por
// layouts/default.vue via composables/useIdleTimeout.ts. Sin mock en el
// .pen (revisado antes de construir - ningun Screen menciona "inactividad"/
// "sesion"/"timeout") - se construyo siguiendo el mismo lenguaje visual de
// components/FieldImpactWarningModal.vue (unico modal de advertencia que ya
// existia en la app).
import { Clock } from '@lucide/vue'

defineProps<{
  countdown: number
}>()

const emit = defineEmits<{
  confirm: []
}>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="flex w-full max-w-[380px] flex-col rounded-lg bg-brand-surface shadow-xl">
      <div class="flex items-start gap-3 border-b border-brand-border-light p-5">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-warning-bg">
          <Clock class="h-[18px] w-[18px] text-brand-warning-text" :stroke-width="1.75" />
        </div>
        <div class="flex flex-col gap-1">
          <h2 class="text-[15px] font-bold text-brand-text">¿Seguís ahí?</h2>
          <p class="text-sm text-brand-text-secondary">Tu sesión está por cerrarse por inactividad.</p>
        </div>
      </div>

      <div class="flex flex-col gap-2 p-5">
        <div class="flex items-center gap-2.5 rounded border border-brand-warning-text/30 bg-brand-warning-bg px-3 py-2.5">
          <Clock class="h-4 w-4 shrink-0 text-brand-warning-text" :stroke-width="1.75" />
          <span class="text-sm font-semibold text-brand-warning-text">
            La sesión se cerrará en {{ countdown }} segundo{{ countdown === 1 ? '' : 's' }}
          </span>
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button
          type="button"
          class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover"
          @click="emit('confirm')"
        >
          Seguir conectado
        </button>
      </div>
    </div>
  </div>
</template>

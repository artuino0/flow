<script setup lang="ts">
// HU-ERD-83 (parte 2) - rediseño (2026-09-03, "checa esto" sobre
// Screen/Modal - Sesión por Inactividad): cuando se construyó esta HU el
// .pen no tenía mock para este modal (documentado en el comentario original,
// ahora borrado) - se armó siguiendo el lenguaje visual de
// FieldImpactWarningModal.vue como mejor aproximación. Ahora el .pen SÍ tiene
// el mock real y difiere en varios puntos: paleta de error (roja) en vez de
// warning (amarilla), un anillo circular de cuenta regresiva en vez de una
// caja de texto plana, y un segundo botón "Cerrar sesión" que la versión
// anterior no tenía (solo dejaba "Seguir conectado", sin forma explícita de
// cerrar sesión desde el propio aviso).
import { ClockAlert } from '@lucide/vue'

const props = defineProps<{
  countdown: number
  // Segundos totales de la cuenta regresiva (WARNING_DURATION_SECONDS de
  // useIdleTimeout.ts) - el anillo dibuja countdown/total, no un numero fijo.
  total: number
}>()

const emit = defineEmits<{
  confirm: []
  logout: []
}>()

// Anillo SVG: mismo criterio que un donut chart (stroke-dasharray como
// "porcentaje visible" del perimetro). r=52 en un viewBox de 120x120 deja el
// mismo grosor de trazo (~8px) que el innerRadius:0.86 del diseno original.
const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const progressOffset = computed(() => {
  const ratio = props.total > 0 ? Math.max(0, Math.min(1, props.countdown / props.total)) : 0
  return CIRCUMFERENCE * (1 - ratio)
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="flex w-full max-w-[440px] flex-col rounded-lg bg-brand-surface shadow-xl">
      <div class="flex items-start gap-3 border-b border-brand-border-light p-5">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-error-bg">
          <ClockAlert class="h-[22px] w-[22px] text-brand-error-text" :stroke-width="1.75" />
        </div>
        <div class="flex flex-col gap-0.5">
          <h2 class="text-base font-bold text-brand-text">Sesión por inactividad</h2>
          <p class="text-[13px] text-brand-text-secondary">Cerraremos tu sesión por seguridad.</p>
        </div>
      </div>

      <div class="flex flex-col items-center gap-4 p-5">
        <div class="relative flex h-[120px] w-[120px] items-center justify-center">
          <svg viewBox="0 0 120 120" class="h-full w-full -rotate-90">
            <circle cx="60" cy="60" :r="RADIUS" fill="none" stroke-width="10" class="stroke-brand-border-light" />
            <circle
              cx="60"
              cy="60"
              :r="RADIUS"
              fill="none"
              stroke-width="10"
              stroke-linecap="round"
              class="stroke-brand-error-text transition-[stroke-dashoffset] duration-1000 ease-linear"
              :stroke-dasharray="CIRCUMFERENCE"
              :stroke-dashoffset="progressOffset"
            />
          </svg>
          <div class="absolute flex flex-col items-center">
            <span class="text-[32px] font-extrabold leading-none text-brand-text">{{ countdown }}</span>
            <span class="text-xs text-brand-text-muted">segundo{{ countdown === 1 ? '' : 's' }}</span>
          </div>
        </div>

        <p class="max-w-[360px] text-center text-sm text-brand-text-secondary">
          ¿Sigues ahí? Presiona "Seguir conectado" para continuar con tu sesión activa.
        </p>
      </div>

      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button
          type="button"
          class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
          @click="emit('logout')"
        >
          Cerrar sesión
        </button>
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

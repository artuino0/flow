<script setup lang="ts">
// Pedido directo del usuario ("aplica los toast, checa donde deben ir"):
// implementa las 4 notificaciones toast del diseno en Pencil - revisadas con
// las herramientas de Pencil antes de este cambio (pencil-antes-de-frontend):
//   - Toast/Guardado (gh7dB): IconWrap bg $success-bg, icono circle-check
//     $success-text. Texto de ejemplo del .pen: "Cambios guardados".
//   - Toast/Editado (z0ToRP): IconWrap bg $info-bg, icono pencil-line
//     $info-text. Texto de ejemplo: "Registro actualizado".
//   - Toast/Error (QhNbi): IconWrap bg $error-bg, icono circle-x $error-text.
//     Texto de ejemplo: "No se pudo guardar".
//   - Toast/Cargando (R8v5A): IconWrap bg $neutral-bg, icono loader-circle
//     $text-secondary (unico agregado propio: gira con animate-spin, ya que
//     un loader estatico no comunicaria "en curso" - el .pen es una imagen
//     fija y no puede mostrar animacion).
// Contenedor: w-360 (w-[360px]), fill $surface, stroke $border-light,
// padding 14, gap 12, cornerRadius $radius-m (rounded-lg) - todos los
// valores numericos y de color leidos directo del .pen, no inventados.
//
// Se monta una sola vez en layouts/default.vue (fixed top-right, apilado) -
// ver composables/useToast.ts para la API (success/updated/error/loading).
import { CircleCheck, PencilLine, CircleX, LoaderCircle, X } from '@lucide/vue'
import type { ToastVariant } from '~/composables/useToast'

const { toasts, dismiss } = useToast()

const VARIANT_META: Record<ToastVariant, { icon: typeof CircleCheck; iconWrapClass: string; iconClass: string; spin?: boolean }> = {
  success: { icon: CircleCheck, iconWrapClass: 'bg-brand-success-bg', iconClass: 'text-brand-success-text' },
  updated: { icon: PencilLine, iconWrapClass: 'bg-brand-info-bg', iconClass: 'text-brand-info-text' },
  error: { icon: CircleX, iconWrapClass: 'bg-brand-error-bg', iconClass: 'text-brand-error-text' },
  loading: { icon: LoaderCircle, iconWrapClass: 'bg-brand-neutral-bg', iconClass: 'text-brand-text-secondary', spin: true }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed right-4 top-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="flex items-start gap-3 rounded-lg border border-brand-border-light bg-brand-surface p-3.5 shadow-lg"
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" :class="VARIANT_META[toast.variant].iconWrapClass">
            <component
              :is="VARIANT_META[toast.variant].icon"
              class="h-4 w-4"
              :class="[VARIANT_META[toast.variant].iconClass, { 'animate-spin': VARIANT_META[toast.variant].spin }]"
              :stroke-width="2"
            />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <p class="text-[13px] font-semibold text-brand-text">{{ toast.title }}</p>
            <p v-if="toast.description" class="text-xs text-brand-text-secondary">{{ toast.description }}</p>
          </div>
          <button type="button" class="shrink-0 text-brand-text-muted hover:text-brand-text" @click="dismiss(toast.id)">
            <X class="h-3.5 w-3.5" :stroke-width="2" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(16px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
.toast-leave-active {
  position: absolute;
  width: 360px;
}
</style>

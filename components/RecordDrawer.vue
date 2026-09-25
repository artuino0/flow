<script setup lang="ts">
// Panel lateral genérico (drawer) para capturar o editar algo sin salir de la
// página ni empujar el contenido: fondo atenuado, cabecera, cuerpo con scroll
// propio y pie fijo con las acciones (slot `footer`). Se cierra con Esc, con el
// clic en el fondo o con el botón de cerrar.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from '@lucide/vue'

const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
  /** Impide cerrar (Esc, fondo, X) mientras se guarda. */
  busy?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

function requestClose() {
  if (!props.busy) emit('close')
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') requestClose()
}

async function focusFirst() {
  await nextTick()
  panel.value?.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])')?.focus()
}
defineExpose({ focusFirst })

watch(() => props.open, async (open) => {
  if (import.meta.server) return
  if (open) {
    document.addEventListener('keydown', onKeydown)
    // Foco en el primer control editable del formulario.
    await focusFirst()
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
}, { immediate: true })
onBeforeUnmount(() => { if (!import.meta.server) document.removeEventListener('keydown', onKeydown) })
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150" enter-from-class="opacity-0" leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-[80] flex justify-end bg-[#33475B]/40" @mousedown.self="requestClose">
        <aside
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          class="flex h-full w-full max-w-[520px] flex-col bg-brand-surface shadow-[-8px_0_24px_#33475B22]"
        >
          <header class="flex items-start justify-between gap-3 border-b border-brand-border-light px-5 py-4">
            <div class="min-w-0">
              <h2 class="truncate text-[15px] font-bold text-brand-text">{{ title }}</h2>
              <p v-if="subtitle" class="mt-0.5 truncate text-xs text-brand-text-muted">{{ subtitle }}</p>
            </div>
            <button type="button" aria-label="Cerrar" class="rounded p-1.5 text-brand-text-secondary hover:bg-brand-bg hover:text-brand-text disabled:opacity-50" :disabled="busy" @click="requestClose">
              <X class="h-4 w-4" :stroke-width="1.9" />
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-24">
            <slot />
          </div>
          <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-brand-border-light bg-brand-surface px-5 py-3">
            <slot name="footer" />
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

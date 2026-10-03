<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { X } from '@lucide/vue'

const props = defineProps<{ open: boolean; changeClient?: boolean }>()
const emit = defineEmits<{ close: []; decline: []; installed: [slug: string]; changed: [] }>()
type Options = { base: { id: string; slug: string; name: string } | null; modules: Array<{ id: string; name: string; slug: string }>; clientSlug: string | null }
const options = ref<Options | null>(null)
const step = ref<'offer' | 'client'>('offer')
const mode = ref<'create' | 'link'>('create')
const entityId = ref('')
const acknowledged = ref(false)
const busy = ref(false)
const error = ref('')
const dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
const errorMessage = (value: unknown) => (value as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'No se pudo completar la operación. Intenta de nuevo.'

watch(() => props.open, async open => {
  if (!open) { previousFocus?.focus(); return }
  previousFocus = document.activeElement as HTMLElement | null
  step.value = props.changeClient ? 'client' : 'offer'
  mode.value = props.changeClient ? 'link' : 'create'
  acknowledged.value = false; entityId.value = ''; options.value = null; error.value = ''; busy.value = true
  await nextTick(); dialog.value?.focus()
  try {
    options.value = await $fetch<Options>('/api/agenda/options')
    entityId.value = options.value.modules.find(module => module.slug === options.value?.clientSlug)?.id ?? ''
  } catch (value) { error.value = errorMessage(value) } finally { busy.value = false }
})

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !busy.value) emit('close')
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
  const first = controls[0], last = controls.at(-1)
  if (!first || !last) return
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus() }
}

async function submit() {
  error.value = ''; busy.value = true
  try {
    if (props.changeClient) {
      const result = await $fetch<{ affectedRecords: number }>('/api/agenda/client', { method: 'PUT', body: { entityId: entityId.value, confirmed: acknowledged.value } })
      useToast().updated('Cliente configurado', result.affectedRecords ? `${result.affectedRecords} citas conservan su cliente anterior en un campo histórico. Selecciona su nuevo Cliente al editarlas.` : 'El vínculo de Cliente se actualizó.')
      emit('changed')
    } else {
      await $fetch('/api/agenda/install', { method: 'POST', body: mode.value === 'create' ? { mode: 'create' } : { mode: 'link', entityId: entityId.value } })
      emit('installed', 'agenda-citas')
    }
  } catch (value) { error.value = errorMessage(value) } finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-brand-overlay/50 p-4" @keydown="keydown">
      <section ref="dialog" role="dialog" aria-modal="true" aria-labelledby="agenda-base-title" aria-describedby="agenda-base-help" tabindex="-1" class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-brand-border-light bg-brand-surface text-brand-text shadow-xl outline-none">
        <header class="flex items-start justify-between gap-4 border-b border-brand-border-light p-5">
          <h2 id="agenda-base-title" class="text-lg font-bold">{{ step === 'offer' ? '¿Usar el módulo Citas prearmado?' : '¿De dónde vienen tus clientes?' }}</h2>
          <button type="button" aria-label="Cerrar" :disabled="busy" class="rounded p-1 text-brand-text-secondary hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-40" @click="emit('close')"><X class="h-5 w-5" /></button>
        </header>
        <div class="space-y-4 p-5 text-sm">
          <p v-if="step === 'offer'" id="agenda-base-help" class="text-brand-text-secondary">Parece que quieres una agenda de citas. ¿Quieres usar el módulo Citas prearmado?</p>
          <p v-else id="agenda-base-help" class="text-brand-text-secondary">Vincula un módulo existente con un campo de texto para mostrar el cliente{{ changeClient ? '.' : ' o crea el catálogo Clientes de la plantilla.' }}</p>
          <p v-if="busy" role="status" class="text-brand-text-secondary">{{ options ? 'Guardando…' : 'Cargando opciones…' }}</p>
          <p v-if="step === 'offer' && options?.base" class="rounded border border-brand-border-light bg-brand-info-bg p-3 text-brand-info-text">Tu organización ya tiene Citas base. Puedes abrirlo; se conservarán tus citas y configuración.</p>
          <template v-if="step === 'client' && options">
            <label v-if="!changeClient" class="flex items-start gap-2"><input v-model="mode" type="radio" value="create" :disabled="busy" class="mt-1 accent-brand-blue" />Crear Clientes de la plantilla</label>
            <label v-if="!changeClient" class="flex items-start gap-2"><input v-model="mode" type="radio" value="link" :disabled="busy" class="mt-1 accent-brand-blue" />Vincular un módulo que ya tengo</label>
            <div v-if="mode === 'link'">
              <label for="agenda-client-target" class="mb-1 block font-semibold">Módulo de clientes</label>
              <select id="agenda-client-target" v-model="entityId" :disabled="busy" class="w-full rounded border border-brand-border bg-brand-surface px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"><option value="">Selecciona un módulo</option><option v-for="module in options.modules" :key="module.id" :value="module.id">{{ module.name }}</option></select>
              <p v-if="!options.modules.length" class="mt-2 text-brand-text-secondary">No hay módulos activos con campos de texto. Crea uno o elige Clientes de la plantilla.</p>
            </div>
            <label v-if="changeClient" class="flex items-start gap-2 rounded border border-brand-border-light bg-brand-warning-bg p-3 text-brand-warning-text"><input v-model="acknowledged" type="checkbox" :disabled="busy" class="mt-1 accent-brand-blue" /><span>Si cambia el módulo, el cliente actual de cada cita se conservará en un campo histórico visible. Cliente quedará pendiente de selección. No se borran citas ni clientes, incluidos los de la papelera. Confirmo este cambio.</span></label>
            <p v-else class="text-brand-text-secondary">Incluye Servicios, Recursos, Citas, Servicios de la cita, roles Recepción y Personal y la vista Calendario. Los módulos de plantilla no consumen tu límite.</p>
          </template>
          <p v-if="error" role="alert" class="rounded border border-brand-error-text/30 bg-brand-error-bg p-3 text-brand-error-text">{{ error }}</p>
        </div>
        <footer class="flex flex-wrap justify-end gap-3 border-t border-brand-border-light p-5">
          <button v-if="step === 'offer'" type="button" :disabled="busy" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-40" @click="emit('decline')">Crear el mío</button>
          <button v-if="step === 'offer'" type="button" :disabled="busy || !options" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-40" @click="options?.base ? emit('installed', options.base.slug) : step = 'client'">{{ options?.base ? 'Abrir Citas' : 'Usar prearmado' }}</button>
          <button v-else type="button" :disabled="busy || !options || (mode === 'link' && !entityId) || (changeClient && !acknowledged)" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-40" @click="submit">{{ changeClient ? 'Cambiar vínculo' : 'Instalar Citas' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Clock } from '@lucide/vue'
import type { LocationQueryRaw } from 'vue-router'
import type { EntityFieldsResponse, EntityFieldMeta } from '~/composables/useEntityFields'

type CreateResult = { id?: string; customData?: { _agenda_conflict?: boolean } }

const props = withDefaults(defineProps<{
  slug: string
  data: EntityFieldsResponse | null
  pending?: boolean
  fetchError?: unknown
  mode?: 'page' | 'drawer'
  initialValues?: LocationQueryRaw
  returnTo?: string
  calendarDate?: string
  calendarTime?: string
}>(), { mode: 'page', pending: false })
const emit = defineEmits<{
  created: [result: CreateResult]
  close: []
}>()

const generalFields = computed(() => (props.data?.fields ?? []).filter(field => field.dataType !== 'tabla'))
const visibleGeneralFields = computed(() => generalFields.value.filter(field => field.name !== 'id' && field.dataType !== 'incremental'))
const tablaFields = computed(() => (props.data?.fields ?? []).filter(field => field.dataType === 'tabla'))
const formValues = ref<Record<string, unknown>>({})
const fixedWorkflowValues = computed(() => props.data?.entity.workflowConfig?.enabled
  ? { [props.data.entity.workflowConfig.field]: props.data.entity.workflowConfig.initial }
  : {})
const generalFormRef = ref<{ validateAll: () => boolean } | null>(null)
const tablaFormRefs = ref<Array<{ validateAll: () => boolean } | null>>([])
const submitting = ref(false)
const submitError = ref<string | null>(null)
const agendaConflict = ref(false)
const agendaForceReason = ref('')
const initialized = ref(false)
const baseline = ref('')
const isDirty = computed(() => initialized.value && JSON.stringify(formValues.value) !== baseline.value)
const toast = useToast()
const { confirm: confirmDiscard } = useConfirm()
const drawer = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
let bodyOverflow = ''
const inertSiblings: Array<{ element: HTMLElement; inert: boolean }> = []
const confirmingClose = ref(false)

watch([() => props.data?.fields, () => props.initialValues], async ([fields]) => {
  if (!fields?.length) return
  const next = { ...formValues.value }
  let changed = false
  for (const field of fields) {
    const raw = props.initialValues?.[field.name]
    const value = Array.isArray(raw) ? raw[0] : raw
    const isRelationId = field.dataType === 'relation' && typeof value === 'string' && /^[0-9a-fA-F-]{36}$/.test(value)
    const isCalendarDate = field.name === props.data?.calendarConfig.startDateField && field.dataType === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    const isCalendarTime = field.name === props.data?.calendarConfig.startTimeField && ['text', 'datetime'].includes(field.dataType) && typeof value === 'string'
    if ((isRelationId || isCalendarDate || isCalendarTime) && next[field.name] == null) {
      next[field.name] = value
      changed = true
    }
  }
  if (changed) formValues.value = next
  await nextTick()
  baseline.value = JSON.stringify(formValues.value)
  initialized.value = true
}, { immediate: true })

onMounted(async () => {
  if (props.mode !== 'drawer') return
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  bodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const overlay = drawer.value?.parentElement
  for (const sibling of document.body.children) {
    if (sibling instanceof HTMLElement && sibling !== overlay) {
      inertSiblings.push({ element: sibling, inert: sibling.inert })
      sibling.inert = true
    }
  }
  await nextTick()
  drawer.value?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus()
})

onBeforeUnmount(() => {
  if (props.mode !== 'drawer') return
  for (const { element, inert } of inertSiblings) element.inert = inert
  document.body.style.overflow = bodyOverflow
  returnFocus?.focus()
})

function validateAll(): boolean {
  const refs = [generalFormRef.value, ...tablaFormRefs.value].filter((form): form is { validateAll: () => boolean } => Boolean(form))
  return refs.map(form => form.validateAll()).every(Boolean)
}

async function onSubmit() {
  submitError.value = null
  if (!validateAll()) return
  submitting.value = true
  try {
    const result = await $fetch<CreateResult>(`/api/records/${props.slug}`, {
      method: 'POST',
      body: { customData: formValues.value, ...(agendaConflict.value && agendaForceReason.value.trim().length >= 5 ? { agendaForceReason: agendaForceReason.value.trim() } : {}) }
    })
    toast.success('Registro creado', `Se creó un nuevo registro en ${props.data?.entity?.singularName || props.data?.entity?.name || props.slug}.`)
    if (result.customData?._agenda_conflict) toast.updated('Aviso: cita traslapada', 'La excepción quedó registrada en la actividad de la cita.')
    emit('created', result)
  } catch (error) {
    const failure = error as { data?: { statusMessage?: string }; statusCode?: number }
    submitError.value = failure?.data?.statusMessage || 'No se pudo crear el registro'
    agendaConflict.value = failure?.statusCode === 409 && submitError.value.includes('Hueco ya ocupado')
    toast.error('No se pudo crear el registro', submitError.value)
  } finally {
    submitting.value = false
  }
}

async function requestClose() {
  if (submitting.value || confirmingClose.value) return
  if (isDirty.value) {
    confirmingClose.value = true
    const accepted = await confirmDiscard({ title: 'Descartar cambios', message: 'Hay cambios sin guardar. ¿Quieres descartarlos?', confirmLabel: 'Descartar', destructive: true })
    confirmingClose.value = false
    if (!accepted) return
  }
  emit('close')
}

function onDrawerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void requestClose()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(drawer.value?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])
    .filter(element => !element.hidden && element.getClientRects().length > 0)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first) { event.preventDefault(); drawer.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function fieldTableRefs(field: EntityFieldMeta) { return [field] }
const drawerTitle = computed(() => {
  const name = props.data?.entity.name || ''
  if (name.toLocaleLowerCase('es-MX').includes('cita') || props.slug.includes('cita')) return 'Nueva cita'
  return `Nuevo ${name || 'registro'}`
})
const calendarDateLabel = computed(() => {
  if (!props.calendarDate) return ''
  const date = new Date(`${props.calendarDate}T12:00:00`)
  return new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
})
</script>

<template>
  <template v-if="mode === 'page'">
    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando formulario...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">No se pudo cargar la definición de esta entidad.</p>
    <form v-else-if="data" class="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]" @submit.prevent="onSubmit">
      <div class="flex h-fit flex-col self-start rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
        <div class="flex flex-col gap-3 border-b border-brand-border-light p-5">
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">NUEVO REGISTRO</p>
            <h2 class="break-words text-[17px] font-bold leading-snug text-brand-text">{{ data.entity.singularName || data.entity.name }}</h2>
            <p class="text-xs text-brand-text-muted">Completa los campos para crear la ficha.</p>
          </div>
        </div>
        <div class="p-5">
          <DynamicForm v-if="visibleGeneralFields.length" ref="generalFormRef" v-model="formValues" :fields="generalFields" :entity-id="data.entity.id" :disabled="submitting" :fixed-values="fixedWorkflowValues" />
          <p v-else class="text-sm text-brand-text-muted">No hay campos generales configurados.</p>
          <p v-if="submitError" role="alert" class="mt-4 text-sm text-brand-error-text">{{ submitError }}</p>
          <AgendaConflictOverride v-if="agendaConflict" v-model="agendaForceReason" :disabled="submitting" />
          <div class="mt-6 flex flex-col gap-2">
            <button type="submit" :disabled="submitting" class="w-full rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60">{{ submitting ? 'Guardando...' : 'Guardar y continuar' }}</button>
            <NuxtLink :to="returnTo || `/registros/${slug}`" class="w-full rounded border border-brand-border px-4 py-2 text-center text-sm font-semibold text-brand-text hover:bg-brand-bg">Cancelar</NuxtLink>
          </div>
        </div>
      </div>

      <div class="flex min-w-0 flex-col rounded-lg">
        <div class="flex items-center gap-1 border-b border-brand-border-light" role="tablist">
          <button type="button" class="border-b-2 border-brand-orange px-4 py-3 text-sm font-semibold text-brand-text">Asociaciones</button>
          <button type="button" class="border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-brand-text-muted">Actividad</button>
        </div>
        <div class="flex flex-col gap-5 pt-5">
          <div v-for="field in tablaFields" :key="field.id" class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
            <div class="border-b border-brand-border-light px-4 py-3"><h3 class="text-sm font-bold text-brand-text">{{ field.label }}</h3></div>
            <div class="p-4"><DynamicForm ref="tablaFormRefs" v-model="formValues" :fields="fieldTableRefs(field)" :entity-id="data.entity.id" :disabled="submitting" hide-labels /></div>
          </div>
          <div class="flex items-center gap-2 rounded border border-brand-border-light bg-brand-bg p-3 text-xs text-brand-text-secondary">
            <Clock class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
            <span>Guarda el registro a la izquierda para empezar a registrar actividad y vincular otras relaciones.</span>
          </div>
        </div>
      </div>
    </form>
  </template>

  <Teleport v-else-if="mode === 'drawer'" to="body">
    <div class="fixed inset-0 z-[80] flex justify-end bg-brand-modal-overlay/40" @click.self="requestClose" @keydown="onDrawerKeydown">
      <section ref="drawer" role="dialog" aria-modal="true" aria-labelledby="record-create-drawer-title" tabindex="-1" class="flex h-full w-[480px] max-w-full flex-col border-l border-brand-border-light bg-brand-surface text-brand-text shadow-xl max-[639px]:w-screen">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border-light px-5 py-4">
          <div class="min-w-0">
            <h2 id="record-create-drawer-title" class="text-[17px] font-bold">{{ drawerTitle }}</h2>
            <p v-if="calendarDateLabel" class="mt-1 text-sm text-brand-text-secondary">{{ calendarDateLabel }}<span v-if="calendarTime"> · {{ calendarTime }}</span></p>
          </div>
          <button type="button" aria-label="Cerrar panel" :disabled="submitting" class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg leading-none text-brand-text-muted hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50" @click="requestClose">×</button>
        </header>

        <p v-if="pending" class="p-5 text-sm text-brand-text-muted">Cargando formulario...</p>
        <p v-else-if="fetchError" role="alert" class="p-5 text-sm text-brand-error-text">No se pudo cargar la definición de esta entidad.</p>
        <form v-else-if="data" class="flex min-h-0 flex-1 flex-col" @submit.prevent="onSubmit">
          <div class="min-h-0 flex-1 overflow-y-auto p-5">
            <div class="flex flex-col gap-5">
              <section class="rounded-lg border border-brand-border-light bg-brand-surface">
                <div class="border-b border-brand-border-light px-4 py-3"><h3 class="text-sm font-bold text-brand-text">Información general</h3></div>
                <div class="p-4">
                  <DynamicForm v-if="visibleGeneralFields.length" ref="generalFormRef" v-model="formValues" :fields="generalFields" :entity-id="data.entity.id" :disabled="submitting" :fixed-values="fixedWorkflowValues" />
                  <p v-else class="text-sm text-brand-text-muted">No hay campos generales configurados.</p>
                </div>
              </section>
              <section v-for="field in tablaFields" :key="field.id" class="rounded-lg border border-brand-border-light bg-brand-surface">
                <div class="border-b border-brand-border-light px-4 py-3"><h3 class="text-sm font-bold text-brand-text">{{ field.label }}</h3></div>
                <div class="p-4"><DynamicForm ref="tablaFormRefs" v-model="formValues" :fields="fieldTableRefs(field)" :entity-id="data.entity.id" :disabled="submitting" hide-labels /></div>
              </section>
              <p v-if="submitError" role="alert" class="text-sm text-brand-error-text">{{ submitError }}</p>
              <AgendaConflictOverride v-if="agendaConflict" v-model="agendaForceReason" :disabled="submitting" />
            </div>
          </div>
          <footer class="flex shrink-0 flex-col gap-3 border-t border-brand-border-light bg-brand-surface px-5 py-4">
            <NuxtLink :to="{ path: `/registros/${slug}/nuevo`, query: initialValues || {} }" class="text-sm font-semibold text-brand-blue hover:underline">Abrir en página completa</NuxtLink>
            <div class="flex justify-end gap-2">
              <button type="button" :disabled="submitting" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg disabled:opacity-50" @click="requestClose">Cancelar</button>
              <button type="submit" :disabled="submitting" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60">{{ submitting ? 'Guardando…' : 'Guardar' }}</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

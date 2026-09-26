<script setup lang="ts">
import type { EntityFieldMeta, StateWorkflowConfig } from '~/composables/useEntityFields'

const props = defineProps<{ moduleId: string; fields: EntityFieldMeta[]; config?: StateWorkflowConfig | null; selectedField?: string | null }>()
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()
const saving = ref(false)
const enabled = ref(Boolean(props.config?.enabled))
const fieldName = ref(props.config?.field ?? props.selectedField ?? '')
const initial = ref(props.config?.initial ?? '')
const states = ref<StateWorkflowConfig['states']>(structuredClone(props.config?.states ?? {}))
const transitions = ref<StateWorkflowConfig['transitions']>(structuredClone(props.config?.transitions ?? []))
const roles = ref<Array<{ id: string; name: string }>>([])
const from = ref('')
const to = ref('')
const roleSelection = ref('all')

const selectFields = computed(() => props.fields.filter(field => field.dataType === 'select'))
const selectedField = computed(() => selectFields.value.find(field => field.name === fieldName.value))
const options = computed(() => Array.isArray(selectedField.value?.validationRules?.options) ? selectedField.value.validationRules.options as Array<{ value: string; label: string }> : [])
const editableFields = computed(() => props.fields.filter(field => field.name !== fieldName.value && field.name !== 'id'))

watch(() => props.config, value => {
  enabled.value = Boolean(value?.enabled)
  fieldName.value = value?.field ?? props.selectedField ?? ''
  initial.value = value?.initial ?? ''
  states.value = structuredClone(value?.states ?? {})
  transitions.value = structuredClone(value?.transitions ?? [])
}, { immediate: true })
watch([fieldName, options], () => {
  const values = options.value.map(option => option.value)
  const previous = states.value
  states.value = Object.fromEntries(values.map(value => [value, previous[value] ?? { locked: false, editableFields: [] }]))
  if (!values.includes(initial.value)) initial.value = values[0] ?? ''
  if (!values.includes(from.value)) from.value = values[0] ?? ''
  if (!values.includes(to.value)) to.value = values[1] ?? values[0] ?? ''
  transitions.value = transitions.value.filter(item => values.includes(item.from) && values.includes(item.to))
}, { immediate: true })

onMounted(async () => {
  try {
    const result = await $fetch<{ roles: Array<{ id: string; name: string }> }>('/api/roles')
    roles.value = result.roles
  } catch { roles.value = [] }
})

function updateState(value: string, patch: Partial<StateWorkflowConfig['states'][string]>) {
  states.value = { ...states.value, [value]: { ...states.value[value], ...patch, editableFields: patch.locked === false ? [] : (patch.editableFields ?? states.value[value].editableFields) } }
}
function addTransition() {
  if (!from.value || !to.value || from.value === to.value || transitions.value.some(item => item.from === from.value && item.to === to.value)) return
  transitions.value = [...transitions.value, { from: from.value, to: to.value, roles: roleSelection.value === 'all' ? 'all' : [roleSelection.value] }]
}
async function save() {
  saving.value = true
  try {
    const workflowConfig = enabled.value ? { enabled: true, field: fieldName.value, initial: initial.value, states: states.value, transitions: transitions.value, rules: props.config?.rules ?? [] } : null
    await $fetch(`/api/entities/${props.moduleId}`, { method: 'PUT', body: { workflowConfig } })
    toast.updated('Flujo de estados guardado', enabled.value ? 'Las reglas ya se aplican en el servidor.' : 'El flujo quedó desactivado.')
    emit('saved')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } } | null)?.data?.statusMessage
    toast.error('No se pudo guardar el flujo', statusMessage || 'Revisa los estados y las transiciones.')
  } finally { saving.value = false }
}
</script>

<template>
  <section class="flex flex-col gap-5 rounded-lg border border-brand-border bg-white p-5">
    <header>
      <h2 class="text-base font-bold text-brand-text">Flujo de estados</h2>
      <p class="mt-1 text-sm text-brand-text-secondary">Controla transiciones y bloqueos usando un campo Select existente.</p>
    </header>
    <label class="flex items-center gap-3 text-sm font-semibold text-brand-text">
      <input v-model="enabled" type="checkbox" class="h-4 w-4 accent-brand-blue">
      Activar flujo
    </label>
    <template v-if="enabled">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-brand-text">Campo Select
          <select v-model="fieldName" class="rounded border border-brand-border px-3 py-2 font-normal"><option value="" disabled>Selecciona un campo</option><option v-for="field in selectFields" :key="field.id" :value="field.name">{{ field.label }}</option></select>
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-brand-text">Estado inicial
          <select v-model="initial" class="rounded border border-brand-border px-3 py-2 font-normal"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        </label>
      </div>
      <div v-if="options.length" class="flex flex-col gap-3">
        <h3 class="text-sm font-bold text-brand-text">Estados bloqueantes</h3>
        <div v-for="option in options" :key="option.value" class="rounded border border-brand-border-light p-3">
          <label class="flex items-center gap-2 text-sm font-semibold text-brand-text"><input :checked="states[option.value]?.locked" type="checkbox" class="accent-brand-blue" @change="updateState(option.value, { locked: ($event.target as HTMLInputElement).checked })">{{ option.label }} bloquea la edición</label>
          <div v-if="states[option.value]?.locked" class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <label v-for="field in editableFields" :key="field.id" class="flex items-center gap-2 text-xs text-brand-text-secondary"><input :checked="states[option.value]?.editableFields.includes(field.name)" type="checkbox" class="accent-brand-blue" @change="updateState(option.value, { editableFields: ($event.target as HTMLInputElement).checked ? [...states[option.value].editableFields, field.name] : states[option.value].editableFields.filter(name => name !== field.name) })">{{ field.label }}</label>
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-3">
        <h3 class="text-sm font-bold text-brand-text">Transiciones y roles</h3>
        <div class="grid gap-2 sm:grid-cols-4">
          <select v-model="from" class="rounded border border-brand-border px-2 py-2 text-sm"><option v-for="option in options" :key="option.value" :value="option.value">Desde: {{ option.label }}</option></select>
          <select v-model="to" class="rounded border border-brand-border px-2 py-2 text-sm"><option v-for="option in options" :key="option.value" :value="option.value">Hacia: {{ option.label }}</option></select>
          <select v-model="roleSelection" class="rounded border border-brand-border px-2 py-2 text-sm"><option value="all">Todos los roles</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select>
          <button type="button" class="rounded bg-brand-blue px-3 py-2 text-sm font-semibold text-white" @click="addTransition">Agregar transición</button>
        </div>
        <ul class="divide-y divide-brand-border-light rounded border border-brand-border-light">
          <li v-for="(transition, index) in transitions" :key="`${transition.from}-${transition.to}`" class="flex items-center justify-between gap-3 px-3 py-2 text-sm text-brand-text">
            <span>{{ options.find(item => item.value === transition.from)?.label }} → {{ options.find(item => item.value === transition.to)?.label }} · {{ transition.roles === 'all' ? 'Todos los roles' : roles.find(role => role.id === transition.roles[0])?.name || 'Rol' }}</span>
            <button type="button" class="font-semibold text-brand-error-text" @click="transitions.splice(index, 1)">Quitar</button>
          </li>
          <li v-if="!transitions.length" class="px-3 py-2 text-sm text-brand-text-muted">Todavía no hay transiciones.</li>
        </ul>
      </div>
    </template>
    <button type="button" class="self-start rounded bg-brand-blue px-4 py-2 text-sm font-bold text-white disabled:opacity-50" :disabled="saving || (enabled && (!fieldName || !initial))" @click="save">{{ saving ? 'Guardando…' : 'Guardar flujo' }}</button>
  </section>
</template>

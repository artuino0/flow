<script setup lang="ts">
import { agendaDefaults, agendaErrorMessage, type AgendaPerson, type AgendaSettings, type AgendaSlot } from '~/utils/agenda'
const props = defineProps<{ ownOnly?: boolean; userId?: string }>()
const emit = defineEmits<{ dirty: [boolean] }>()
const { user } = useAuth()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ installed: boolean; settings: AgendaSettings; timezone: string; people: AgendaPerson[]; permissions: { manage: boolean; edit: boolean } }>('/api/agenda/settings', { headers })
const form = reactive<AgendaSettings>({ ...agendaDefaults }), snapshot = ref(''), saving = ref(false), failure = ref(''), message = ref('')
const personal = ref(user.value?.id ?? ''), from = ref(''), duration = ref(30), slots = ref<AgendaSlot[]>([]), previewed = ref(false), previewLoading = ref(false)
watch(data, value => { if (value) { Object.assign(form, value.settings); snapshot.value = JSON.stringify(form); if (!personal.value) personal.value = value.people[0]?.id ?? ''; if (!from.value) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const p = Object.fromEntries(parts.map(p => [p.type, p.value])); from.value = `${p.year}-${p.month}-${p.day}` } } }, { immediate: true })
watch(form, value => emit('dirty', JSON.stringify(value) !== snapshot.value), { deep: true })
onBeforeUnmount(() => emit('dirty', false))
async function save() {
  saving.value = true; failure.value = ''; message.value = ''
  try { await $fetch('/api/agenda/settings', { method: 'PUT', body: form }); await refresh(); emit('dirty', false); message.value = 'Ajustes de agenda guardados.' }
  catch (error) { failure.value = agendaErrorMessage(error) }
  finally { saving.value = false }
}
async function preview() {
  previewLoading.value = true; failure.value = ''; previewed.value = false
  try {
    const to = new Date(Date.parse(from.value + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10)
    const result = await $fetch<{ slots: AgendaSlot[]; automatic: AgendaSlot[] }>('/api/agenda/availability', { query: { personal: personal.value, from: from.value, to, duration: duration.value } })
    slots.value = result.slots.length ? result.slots : result.automatic; previewed.value = true
  } catch (error) { failure.value = agendaErrorMessage(error) }
  finally { previewLoading.value = false }
}
const numberFields = [
  { key: 'slotMinutes', label: 'Rejilla (minutos)', min: 5, max: 120 }, { key: 'bufferMinutes', label: 'Margen entre citas (minutos)', min: 0, max: 120 },
  { key: 'minNoticeMinutes', label: 'Anticipación mínima (minutos)', min: 0, max: 525600 }, { key: 'maxDaysAhead', label: 'Días hacia adelante', min: 1, max: 365 }
] as const
</script>
<template>
  <div class="agenda-ui space-y-5" data-dark-ready="true">
    <p v-if="pending" role="status" class="text-sm text-brand-text-muted">Cargando agenda…</p>
    <section v-else-if="error" class="settings-card" role="alert"><h2>No se pudo cargar la agenda</h2><button type="button" class="settings-button mt-3" @click="refresh()">Reintentar</button></section>
    <section v-else-if="!data?.installed" class="settings-card"><h2>Citas base todavía no está instalado</h2><p>Ve a Módulos → Nuevo módulo y elige Citas prearmadas para habilitar horarios, bloqueos y disponibilidad.</p><NuxtLink to="/modulos/nuevo" class="settings-button mt-4 inline-block">Ir a instalar Citas base</NuxtLink></section>
    <template v-else-if="data">
      <p class="text-sm text-brand-text-muted">Zona horaria: {{ data.timezone }}</p>
      <section v-if="!ownOnly" class="settings-card">
        <h2>Ajustes de agenda</h2><p>La disponibilidad aplica estos valores a todas las personas de la organización.</p>
        <form class="mt-5 space-y-4" @submit.prevent="save"><fieldset :disabled="!data.permissions.manage || saving" class="grid gap-4 sm:grid-cols-2">
          <label v-for="field in numberFields" :key="field.key" class="settings-field">{{ field.label }}<input v-model.number="form[field.key]" type="number" :min="field.min" :max="field.max" required /></label>
          <label class="settings-field">Asignación<select v-model="form.assignmentMode"><option value="client_chooses">El cliente elige persona</option><option value="auto">Automática</option><option value="both">Ambas</option></select></label>
          <label class="settings-field">Citas internas traslapadas<select v-model="form.conflictPolicy"><option value="block">Bloquear (recomendado)</option><option value="warn">Permitir con aviso y constancia</option></select></label>
          <label class="settings-field sm:col-span-2">Mensaje de confirmación<textarea v-model="form.confirmationMessage" maxlength="2000" rows="2" /></label>
        </fieldset><button v-if="data.permissions.manage" class="settings-button" type="submit" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar ajustes' }}</button><p v-else class="text-sm text-brand-text-muted">Ajustes de solo lectura.</p></form>
      </section>
      <AgendaScheduleEditor v-if="ownOnly && user" :user-id="user.id" @dirty="emit('dirty', $event)" />
      <AgendaScheduleEditor v-else-if="userId" :user-id="userId" @dirty="emit('dirty', $event)" />
      <template v-else-if="!ownOnly"><label class="settings-field">Horario por persona<select v-model="personal"><option v-for="person in data.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><AgendaScheduleEditor v-if="personal" :key="personal" :user-id="personal" @dirty="emit('dirty', $event)" /></template>
      <AgendaTimeOffEditor v-if="user" :people="data.people" :own-id="user.id" :manage="data.permissions.manage" :edit="data.permissions.edit" :user-id="ownOnly ? user.id : undefined" />
      <section class="settings-card"><h2>Vista previa de huecos de la semana</h2><p>Solo se muestran huecos libres. Las citas ocupadas y los bloqueos se excluyen.</p>
        <form class="mt-4 grid items-end gap-3 sm:grid-cols-4" @submit.prevent="preview"><label class="settings-field">Persona<select v-model="personal" required><option v-for="person in data.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><label class="settings-field">Semana desde<input v-model="from" type="date" required /></label><label class="settings-field">Duración (minutos)<input v-model.number="duration" type="number" min="1" max="1440" required /></label><button type="submit" class="settings-button" :disabled="previewLoading || !personal">{{ previewLoading ? 'Consultando…' : 'Ver huecos' }}</button></form>
        <p v-if="previewed && !slots.length" role="status" class="mt-4 text-sm text-brand-text-muted">No hay huecos libres en esta semana para la duración elegida.</p>
        <ul v-if="previewed && slots.length" class="mt-4 grid max-h-96 gap-2 overflow-auto sm:grid-cols-3" aria-label="Huecos disponibles"><li v-for="slot in slots" :key="slot.start + slot.userId" class="rounded border border-brand-border-light bg-brand-success-bg px-3 py-2 text-sm text-brand-success-text">Libre · {{ slot.date }} · {{ slot.time }}</li></ul>
      </section>
    </template>
    <p v-if="failure" role="alert" class="text-sm text-brand-error-text">{{ failure }}</p><p v-if="message" role="status" class="text-sm text-brand-success-text">{{ message }}</p>
  </div>
</template>

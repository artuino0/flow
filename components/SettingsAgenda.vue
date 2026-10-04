<script setup lang="ts">
import { agendaDefaults, agendaErrorMessage, type AgendaPerson, type AgendaSettings, type AgendaSlot, type AgendaSchedule } from '~/utils/agenda'
const props = defineProps<{ ownOnly?: boolean; userId?: string }>()
const emit = defineEmits<{ dirty: [boolean] }>()
const { user } = useAuth()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ installed: boolean; settings: AgendaSettings; timezone: string; people: Array<AgendaPerson & { agendaStaff?: boolean }>; permissions: { manage: boolean; edit: boolean } }>('/api/agenda/settings', { headers })
const form = reactive<AgendaSettings>({ ...agendaDefaults }), snapshot = ref(''), saving = ref(false), failure = ref(''), message = ref('')
const personal = ref(user.value?.id ?? ''), from = ref(''), duration = ref(30), slots = ref<AgendaSlot[]>([]), previewed = ref(false), previewLoading = ref(false)
const schedules = ref<AgendaSchedule[]>([])
const previewPeople = computed(() => data.value?.people.filter(person => person.agendaStaff !== false) ?? [])
const dirty = computed(() => JSON.stringify(form) !== snapshot.value)
const scheduleDirty = ref(false)
function discard() { Object.assign(form, JSON.parse(snapshot.value)); failure.value = ''; message.value = '' }
const week = computed(() => !from.value ? [] : Array.from({ length: 7 }, (_, index) => {
  const date = new Date(Date.parse(from.value + 'T00:00:00Z') + index * 86400000).toISOString().slice(0, 10)
  return { date, label: new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z')), slots: slots.value.filter(slot => slot.date === date) }
}))
watch(data, value => { if (value) { Object.assign(form, value.settings); snapshot.value = JSON.stringify(form); if (!personal.value) personal.value = value.people[0]?.id ?? ''; if (!from.value) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const p = Object.fromEntries(parts.map(p => [p.type, p.value])); from.value = `${p.year}-${p.month}-${p.day}` } } }, { immediate: true })
watch([dirty, scheduleDirty], ([rules, schedule]) => emit('dirty', rules || schedule))
onBeforeUnmount(() => emit('dirty', false))
async function save() {
  saving.value = true; failure.value = ''; message.value = ''
  try { await $fetch('/api/agenda/settings', { method: 'PUT', body: form }); await refresh(); message.value = 'Ajustes de agenda guardados.' }
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
      <AgendaCard v-if="!ownOnly" title="Reglas de agenda" description="La disponibilidad aplica estos valores a todas las personas de la organización.">
        <form class="mt-5 space-y-4" @submit.prevent="save"><fieldset :disabled="!data.permissions.manage || saving" class="grid gap-4 sm:grid-cols-2">
          <label v-for="field in numberFields" :key="field.key" class="settings-field">{{ field.label }}<input v-model.number="form[field.key]" type="number" :min="field.min" :max="field.max" required /></label>
          <label class="settings-field">Asignación<select v-model="form.assignmentMode"><option value="client_chooses">El cliente elige persona</option><option value="auto">Automática</option><option value="both">Ambas</option></select></label>
          <label class="settings-field">Citas internas traslapadas<select v-model="form.conflictPolicy"><option value="block">Bloquear (recomendado)</option><option value="warn">Permitir con aviso y constancia</option></select></label>
          <label class="settings-field sm:col-span-2">Mensaje de confirmación<textarea v-model="form.confirmationMessage" maxlength="2000" rows="2" /></label>
        </fieldset><footer class="agenda-action-bar agenda-card-footer"><span>{{ dirty ? 'Hay cambios por guardar' : 'Sin cambios por guardar' }}</span><div v-if="data.permissions.manage"><button type="button" class="settings-button" :disabled="saving" @click="discard">Descartar</button><button class="settings-button agenda-primary" type="submit" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar ajustes' }}</button></div><p v-else>Ajustes de solo lectura.</p></footer></form>
      </AgendaCard>
      <div v-if="ownOnly && user" class="agenda-personal-columns"><AgendaScheduleSummary :schedules="schedules" /><AgendaScheduleEditor :user-id="user.id" @change="schedules = $event" @dirty="scheduleDirty = $event" @saved="refresh" /></div>
      <AgendaScheduleEditor v-else-if="userId" :user-id="userId" @dirty="scheduleDirty = $event" @saved="refresh" />
      <template v-else-if="!ownOnly"><label class="settings-field">Horario por persona<select v-model="personal"><option v-for="person in data.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><AgendaScheduleEditor v-if="personal" :key="personal" :user-id="personal" @dirty="scheduleDirty = $event" @saved="refresh" /></template>
      <AgendaTimeOffEditor v-if="user" :people="data.people" :own-id="user.id" :manage="data.permissions.manage" :edit="data.permissions.edit" :user-id="ownOnly ? user.id : undefined" />
      <AgendaCard title="Vista previa de huecos de la semana" description="Solo se muestran huecos libres. Las citas ocupadas y los bloqueos se excluyen.">
        <form class="mt-4 grid items-end gap-3 sm:grid-cols-4" @submit.prevent="preview"><label class="settings-field">Persona<select v-model="personal" required><option v-for="person in previewPeople" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><label class="settings-field">Semana desde<input v-model="from" type="date" required /></label><label class="settings-field">Duración (minutos)<input v-model.number="duration" type="number" min="1" max="1440" required /></label><button type="submit" class="settings-button" :disabled="previewLoading || !previewPeople.some(person => person.id === personal)">{{ previewLoading ? 'Consultando…' : 'Ver huecos' }}</button></form>
        <p v-if="previewed && !slots.length" role="status" class="mt-4 text-sm text-brand-text-muted">No hay huecos libres en esta semana para la duración elegida.</p>
        <div v-if="previewed" class="agenda-week" aria-label="Huecos disponibles"><section v-for="day in week" :key="day.date" class="agenda-week-day"><h3>{{ day.label }}</h3><ul><li v-for="slot in day.slots" :key="slot.start + slot.userId">Libre · {{ slot.time }} · {{ data.people.find(person => person.id === slot.userId)?.name || 'Personal' }}</li></ul><p v-if="!day.slots.length" class="agenda-note p-3">Sin huecos</p></section></div>
      </AgendaCard>
    </template>
    <p v-if="failure" role="alert" class="text-sm text-brand-error-text">{{ failure }}</p><p v-if="message" role="status" class="text-sm text-brand-success-text">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { agendaErrorMessage, schedulesSchema, type AgendaSchedule } from '~/utils/agenda'
const props = defineProps<{ userId: string }>()
const emit = defineEmits<{ dirty: [boolean] }>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ schedules: AgendaSchedule[]; permissions: { edit: boolean } }>('/api/agenda/schedules', { query: { personal: props.userId }, headers })
const rows = ref<AgendaSchedule[]>([]), saving = ref(false), message = ref(''), failure = ref('')
const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const snapshot = ref('')
watch(data, value => { if (value) { rows.value = value.schedules.map(row => ({ weekday: row.weekday, startTime: row.startTime, endTime: row.endTime, validFrom: row.validFrom, validTo: row.validTo })); snapshot.value = JSON.stringify(rows.value) } }, { immediate: true })
watch(rows, value => emit('dirty', JSON.stringify(value) !== snapshot.value), { deep: true })
onBeforeUnmount(() => emit('dirty', false))
function add(weekday: number) { rows.value.push({ weekday, startTime: '09:00', endTime: '18:00', validFrom: null, validTo: null }) }
function copy(weekday: number, target: number) {
  const copies = rows.value.filter(row => row.weekday === weekday).map(row => ({ ...row, weekday: target }))
  rows.value = [...rows.value.filter(row => row.weekday !== target), ...copies]
}
async function save() {
  failure.value = ''; message.value = ''
  const parsed = schedulesSchema.safeParse(rows.value)
  if (!parsed.success) { failure.value = parsed.error.issues.map(v => v.message).join('. '); return }
  saving.value = true
  try { await $fetch('/api/agenda/schedules', { method: 'PUT', body: { userId: props.userId, schedules: parsed.data } }); await refresh(); emit('dirty', false); message.value = 'Horario guardado.' }
  catch (error) { failure.value = agendaErrorMessage(error) }
  finally { saving.value = false }
}
</script>
<template>
  <section class="agenda-ui settings-card" data-dark-ready="true">
    <h2>Horario de agenda</h2><p>Los rangos usan la zona horaria de la organización. Un día sin rangos no ofrece citas.</p>
    <p v-if="pending" role="status">Cargando horario…</p>
    <div v-else-if="error" role="alert"><p>No se pudo cargar el horario.</p><button type="button" class="settings-button mt-3" @click="refresh()">Reintentar</button></div>
    <form v-else-if="data" class="mt-5 space-y-4" @submit.prevent="save">
      <p v-if="!data.permissions.edit" class="text-sm text-brand-text-muted">Horario de solo lectura.</p>
      <fieldset :disabled="!data.permissions.edit || saving" class="space-y-4">
        <div v-for="(day, weekday) in days" :key="day" class="border-b border-brand-border-light pb-4">
          <div class="mb-2 flex flex-wrap items-center gap-3"><h3 class="text-sm font-semibold text-brand-text">{{ day }}</h3><button type="button" class="settings-button" :aria-label="`Agregar rango a ${day}`" @click="add(weekday)">Agregar rango</button>
            <label v-if="rows.some(row => row.weekday === weekday)" class="settings-field">Copiar a<select :aria-label="`Copiar ${day} a otro día`" value="" @change="copy(weekday, Number(($event.target as HTMLSelectElement).value)); ($event.target as HTMLSelectElement).value = ''"><option value="" disabled>Elige un día</option><option v-for="(target, index) in days" :key="target" :value="index" :disabled="index === weekday">{{ target }}</option></select></label>
          </div>
          <p v-if="!rows.some(row => row.weekday === weekday)" class="text-xs text-brand-text-muted">Sin atención</p>
          <div v-for="(row, index) in rows" :key="index"><div v-if="row.weekday === weekday" class="mb-2 grid items-end gap-3 sm:grid-cols-5">
            <label class="settings-field">Inicio<input v-model="row.startTime" type="time" required /></label><label class="settings-field">Fin<input v-model="row.endTime" type="time" required /></label>
            <label class="settings-field">Vigente desde<input :value="row.validFrom || ''" type="date" @input="row.validFrom = ($event.target as HTMLInputElement).value || null" /></label><label class="settings-field">Vigente hasta<input :value="row.validTo || ''" type="date" @input="row.validTo = ($event.target as HTMLInputElement).value || null" /></label>
            <button type="button" class="settings-button" :aria-label="`Quitar rango de ${day} ${row.startTime}`" @click="rows.splice(index, 1)">Quitar</button>
          </div></div>
        </div>
      </fieldset>
      <p v-if="failure" role="alert" class="text-sm text-brand-error-text">{{ failure }}</p><p v-if="message" role="status" class="text-sm text-brand-success-text">{{ message }}</p>
      <button v-if="data.permissions.edit" type="submit" class="settings-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar horario' }}</button>
    </form>
  </section>
</template>

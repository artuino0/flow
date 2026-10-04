<script setup lang="ts">
import { agendaErrorMessage, schedulesSchema, type AgendaSchedule } from '~/utils/agenda'
const props = defineProps<{ userId: string }>()
const emit = defineEmits<{ dirty: [boolean]; change: [AgendaSchedule[]]; saved: [] }>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ schedules: AgendaSchedule[]; permissions: { edit: boolean } }>('/api/agenda/schedules', { query: { personal: props.userId }, headers })
const rows = ref<AgendaSchedule[]>([]), saving = ref(false), message = ref(''), failure = ref('')
const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const snapshot = ref('')
watch(data, value => { if (value) { rows.value = value.schedules.map(row => ({ weekday: row.weekday, startTime: row.startTime, endTime: row.endTime, validFrom: row.validFrom, validTo: row.validTo })); snapshot.value = JSON.stringify(rows.value) } }, { immediate: true })
watch(rows, value => { emit('dirty', JSON.stringify(value) !== snapshot.value); emit('change', value.map(row => ({ ...row }))) }, { deep: true, immediate: true })
const dirty = computed(() => JSON.stringify(rows.value) !== snapshot.value)
const order = [1, 2, 3, 4, 5, 6, 0]
const mixedValidity = computed(() => new Set(rows.value.map(row => JSON.stringify([row.validFrom, row.validTo]))).size > 1)
function validity(key: 'validFrom' | 'validTo', value: string) { rows.value.forEach(row => { row[key] = value || null }) }
function toggle(weekday: number, enabled: boolean) { if (enabled) add(weekday); else rows.value = rows.value.filter(row => row.weekday !== weekday) }
function discard() { rows.value = JSON.parse(snapshot.value); failure.value = ''; message.value = '' }
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
  try { await $fetch('/api/agenda/schedules', { method: 'PUT', body: { userId: props.userId, schedules: parsed.data } }); await refresh(); emit('dirty', false); emit('saved'); message.value = 'Horario guardado.' }
  catch (error) { failure.value = agendaErrorMessage(error) }
  finally { saving.value = false }
}
</script>
<template>
  <AgendaCard title="Horario de agenda" description="Define los días y las horas en que esta persona puede recibir citas.">
    <p v-if="pending" role="status">Cargando horario…</p>
    <div v-else-if="error" role="alert"><p>No se pudo cargar el horario.</p><button type="button" class="settings-button mt-3" @click="refresh()">Reintentar</button></div>
    <form v-else-if="data" @submit.prevent="save">
      <p v-if="!data.permissions.edit" class="agenda-note">Horario de solo lectura.</p>
      <fieldset :disabled="!data.permissions.edit || saving">
        <div v-for="weekday in order" :key="weekday" class="agenda-day">
          <div class="agenda-day-title"><h3>{{ days[weekday] }}</h3><label class="agenda-switch-label"><input type="checkbox" role="switch" class="agenda-switch" :aria-label="`Trabaja el ${days[weekday]}`" :checked="rows.some(row => row.weekday === weekday)" @change="toggle(weekday, ($event.target as HTMLInputElement).checked)" />Trabaja este día</label></div>
          <div class="agenda-day-ranges"><p v-if="!rows.some(row => row.weekday === weekday)" class="agenda-unavailable">No disponible · Sin atención</p>
            <template v-for="(row, index) in rows" :key="index"><div v-if="row.weekday === weekday" class="agenda-range">
              <label class="settings-field"><span class="sr-only">Inicio de {{ days[weekday] }}</span><input v-model="row.startTime" type="time" required /></label><span aria-hidden="true">—</span><label class="settings-field"><span class="sr-only">Fin de {{ days[weekday] }}</span><input v-model="row.endTime" type="time" required /></label>
              <button type="button" class="settings-button" :aria-label="`Quitar rango de ${days[weekday]} ${row.startTime}`" @click="rows.splice(index, 1)">×</button>
            </div></template>
            <button type="button" class="settings-button agenda-range-add" :aria-label="`Agregar rango a ${days[weekday]}`" @click="add(weekday)">＋ Agregar rango</button>
          </div>
          <div class="agenda-day-actions">
            <label v-if="rows.some(row => row.weekday === weekday)" class="settings-field"><span class="sr-only">Copiar {{ days[weekday] }} a otro día</span><select :aria-label="`Copiar ${days[weekday]} a otro día`" value="" @change="copy(weekday, Number(($event.target as HTMLSelectElement).value)); ($event.target as HTMLSelectElement).value = ''"><option value="" disabled>Copiar día a…</option><option v-for="target in order" :key="target" :value="target" :disabled="target === weekday">{{ days[target] }}</option></select></label>
          </div>
        </div>
        <div class="agenda-validity"><h3>Vigencia del horario <span class="agenda-note">(opcional)</span></h3><p class="agenda-note">Déjalo vacío para que el horario no venza.</p>
          <div class="agenda-two-columns"><label class="settings-field">Desde<input :value="mixedValidity ? '' : rows[0]?.validFrom || ''" type="date" @input="validity('validFrom', ($event.target as HTMLInputElement).value)" /></label><label class="settings-field">Hasta<input :value="mixedValidity ? '' : rows[0]?.validTo || ''" type="date" @input="validity('validTo', ($event.target as HTMLInputElement).value)" /></label></div>
          <details v-if="mixedValidity" class="mt-3"><summary>Vigencias distintas por rango</summary><p class="agenda-note">Se conservan las vigencias individuales. Cambiar la vigencia general la aplica a todos los rangos.</p><div v-for="(row, index) in rows" :key="index" class="agenda-two-columns mt-3"><label class="settings-field">{{ days[row.weekday] }} {{ row.startTime }} · Desde<input :value="row.validFrom || ''" type="date" @input="row.validFrom = ($event.target as HTMLInputElement).value || null" /></label><label class="settings-field">Hasta<input :value="row.validTo || ''" type="date" @input="row.validTo = ($event.target as HTMLInputElement).value || null" /></label></div></details>
        </div>
      </fieldset>
      <p v-if="failure" role="alert" class="text-sm text-brand-error-text mt-3">{{ failure }}</p><p v-if="message" role="status" class="text-sm text-brand-success-text mt-3">{{ message }}</p>
      <footer class="agenda-action-bar agenda-card-footer"><span>{{ dirty ? 'Hay cambios por guardar' : 'Sin cambios por guardar' }}</span><div v-if="data.permissions.edit"><button type="button" class="settings-button" :disabled="saving" @click="discard">Descartar</button><button type="submit" class="settings-button agenda-primary" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar horario' }}</button></div></footer>
    </form>
  </AgendaCard>
</template>

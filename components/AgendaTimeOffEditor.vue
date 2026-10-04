<script setup lang="ts">
import { agendaErrorMessage, type AgendaPerson, type AgendaTimeOff } from '~/utils/agenda'
const props = defineProps<{ people: AgendaPerson[]; ownId: string; manage: boolean; edit: boolean; userId?: string }>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ blocks: (AgendaTimeOff & { id: string })[] }>('/api/agenda/time-off', { headers })
const form = reactive({ userId: props.userId ?? props.ownId, startLocal: '', endLocal: '', reason: '', allDay: false })
const editingId = ref(''), saving = ref(false), failure = ref(''), message = ref('')
const modalOpen = ref(false)
const shown = computed(() => (data.value?.blocks ?? []).filter(row => !props.userId || !row.userId || row.userId === props.userId))
function editable(row: AgendaTimeOff) { return props.manage || (props.edit && row.userId === props.ownId) }
function startEdit(row: AgendaTimeOff & { id: string }) { Object.assign(form, { userId: row.userId ?? '', startLocal: row.startLocal, endLocal: row.endLocal, reason: row.reason, allDay: row.allDay }); editingId.value = row.id; modalOpen.value = true; nextTick(() => document.getElementById('agenda-block-reason')?.focus()) }
function reset() { Object.assign(form, { userId: props.userId ?? props.ownId, startLocal: '', endLocal: '', reason: '', allDay: false }); editingId.value = '' }
async function save() {
  failure.value = ''; message.value = ''; saving.value = true
  try {
    const body = { userId: form.userId || null, startLocal: form.allDay ? form.startLocal.slice(0, 10) + 'T00:00' : form.startLocal, endLocal: form.allDay ? form.endLocal.slice(0, 10) + 'T00:00' : form.endLocal, reason: form.reason, allDay: form.allDay }
    if (editingId.value) await $fetch(`/api/agenda/time-off/${editingId.value}`, { method: 'PUT', body })
    else await $fetch('/api/agenda/time-off', { method: 'POST', body })
    reset(); modalOpen.value = false; await refresh(); message.value = 'Bloqueo guardado.'
  } catch (error) { failure.value = agendaErrorMessage(error) }
  finally { saving.value = false }
}
async function remove(id: string) {
  saving.value = true; failure.value = ''; message.value = ''
  try { await $fetch(`/api/agenda/time-off/${id}`, { method: 'DELETE' }); await refresh(); message.value = 'Bloqueo eliminado.' }
  catch (error) { failure.value = agendaErrorMessage(error) }
  finally { saving.value = false }
}
</script>
<template>
  <AgendaCard title="Bloqueos y ausencias" description="Vacaciones, festivos y ausencias. Un bloqueo de toda la organización afecta a cada persona.">
    <template #actions><button v-if="edit || manage" type="button" class="settings-button" @click="reset(); failure = ''; modalOpen = true">＋ Nuevo bloqueo</button></template>
    <p v-if="pending" role="status">Cargando bloqueos…</p>
    <div v-else-if="error" role="alert"><p>No se pudieron cargar los bloqueos.</p><button type="button" class="settings-button" @click="refresh()">Reintentar</button></div>
    <template v-else>
      <div v-if="!shown.length" class="agenda-empty"><span aria-hidden="true">⊘</span><strong>Sin bloqueos</strong><p>Agrega una ausencia para retirarla de los huecos disponibles.</p></div>
      <div v-else class="agenda-table-scroll" tabindex="0" role="region" aria-label="Bloqueos y ausencias"><table><thead><tr><th scope="col">Persona</th><th scope="col">Motivo</th><th scope="col">Inicio</th><th scope="col">Fin exclusivo</th><th scope="col">Acciones</th></tr></thead><tbody><tr v-for="row in shown" :key="row.id"><td>{{ row.userId ? people.find(p => p.id === row.userId)?.name || 'Usuario' : 'Toda la organización' }}</td><td>{{ row.reason }} <span v-if="row.allDay" class="agenda-note">· Todo el día</span></td><td>{{ row.startLocal.replace('T', ' ') }}</td><td>{{ row.endLocal.replace('T', ' ') }}</td><td><div v-if="editable(row)" class="flex gap-2"><button type="button" class="settings-button" :disabled="saving" :aria-label="`Editar bloqueo: ${row.reason}`" @click="startEdit(row)">Editar</button><button type="button" class="settings-button" :disabled="saving" :aria-label="`Eliminar bloqueo: ${row.reason}`" @click="remove(row.id)">Eliminar</button></div></td></tr></tbody></table></div>
      <AgendaInternalModal v-if="modalOpen && (edit || manage)" :title="editingId ? 'Editar bloqueo' : 'Nuevo bloqueo'" :busy="saving" @close="modalOpen = false">
        <form id="agenda-block-form" class="space-y-4" @submit.prevent="save">
          <fieldset :disabled="saving" class="agenda-two-columns">
            <label class="settings-field">Persona<select v-model="form.userId" :disabled="!manage"><option v-if="manage" value="">Toda la organización</option><option v-for="person in people.filter(p => manage || p.id === ownId)" :key="person.id" :value="person.id">{{ person.name }}</option></select></label>
            <label class="settings-field">Motivo<input id="agenda-block-reason" v-model="form.reason" required maxlength="500" placeholder="Vacaciones, festivo o ausencia" /></label>
            <label class="settings-field">Inicio<input v-model="form.startLocal" type="datetime-local" required /></label><label class="settings-field">Fin exclusivo<input v-model="form.endLocal" type="datetime-local" required /></label>
            <label class="agenda-switch-label"><input v-model="form.allDay" class="agenda-switch" role="switch" type="checkbox" />Todo el día</label>
          </fieldset>
          <p class="agenda-note">Todo el día usa medianoche; el fin es el día siguiente al último bloqueado.</p>
          <p v-if="failure" role="alert" class="text-sm text-brand-error-text">{{ failure }}</p>
        </form>
        <template #footer><footer class="agenda-action-bar"><span>Horario de la organización</span><div><button type="button" class="settings-button" :disabled="saving" @click="modalOpen = false">Cancelar</button><button form="agenda-block-form" type="submit" class="settings-button agenda-primary" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar bloqueo' }}</button></div></footer></template>
      </AgendaInternalModal>
    </template>
    <p v-if="failure && !modalOpen" role="alert" class="mt-3 text-sm text-brand-error-text">{{ failure }}</p><p v-if="message" role="status" class="mt-3 text-sm text-brand-success-text">{{ message }}</p>
  </AgendaCard>
</template>

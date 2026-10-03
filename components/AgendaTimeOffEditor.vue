<script setup lang="ts">
import { agendaErrorMessage, type AgendaPerson, type AgendaTimeOff } from '~/utils/agenda'
const props = defineProps<{ people: AgendaPerson[]; ownId: string; manage: boolean; edit: boolean; userId?: string }>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, pending, error, refresh } = await useFetch<{ blocks: (AgendaTimeOff & { id: string })[] }>('/api/agenda/time-off', { headers })
const form = reactive({ userId: props.userId ?? props.ownId, startLocal: '', endLocal: '', reason: '', allDay: false })
const editingId = ref(''), saving = ref(false), failure = ref(''), message = ref('')
const shown = computed(() => (data.value?.blocks ?? []).filter(row => !props.userId || !row.userId || row.userId === props.userId))
function editable(row: AgendaTimeOff) { return props.manage || (props.edit && row.userId === props.ownId) }
function startEdit(row: AgendaTimeOff & { id: string }) { Object.assign(form, { userId: row.userId ?? '', startLocal: row.startLocal, endLocal: row.endLocal, reason: row.reason, allDay: row.allDay }); editingId.value = row.id; nextTick(() => document.getElementById('agenda-block-reason')?.focus()) }
function reset() { Object.assign(form, { userId: props.userId ?? props.ownId, startLocal: '', endLocal: '', reason: '', allDay: false }); editingId.value = '' }
async function save() {
  failure.value = ''; message.value = ''; saving.value = true
  try {
    const body = { userId: form.userId || null, startLocal: form.allDay ? form.startLocal.slice(0, 10) + 'T00:00' : form.startLocal, endLocal: form.allDay ? form.endLocal.slice(0, 10) + 'T00:00' : form.endLocal, reason: form.reason, allDay: form.allDay }
    if (editingId.value) await $fetch(`/api/agenda/time-off/${editingId.value}`, { method: 'PUT', body })
    else await $fetch('/api/agenda/time-off', { method: 'POST', body })
    reset(); await refresh(); message.value = 'Bloqueo guardado.'
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
  <section class="agenda-ui settings-card" data-dark-ready="true">
    <h2>Bloqueos de agenda</h2><p>Vacaciones, festivos y ausencias. Un bloqueo de toda la organización afecta a cada persona.</p>
    <p v-if="pending" role="status">Cargando bloqueos…</p>
    <div v-else-if="error" role="alert"><p>No se pudieron cargar los bloqueos.</p><button type="button" class="settings-button" @click="refresh()">Reintentar</button></div>
    <template v-else>
      <p v-if="!shown.length" class="my-4 text-sm text-brand-text-muted">Sin bloqueos. Agrega una ausencia para retirarla de los huecos disponibles.</p>
      <ul class="my-4 divide-y divide-brand-border-light"><li v-for="row in shown" :key="row.id" class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-brand-text">
        <div><strong>Bloqueado: {{ row.reason }}</strong><p>{{ row.userId ? people.find(p => p.id === row.userId)?.name || 'Usuario' : 'Toda la organización' }} · {{ row.startLocal.replace('T', ' ') }} a {{ row.endLocal.replace('T', ' ') }}{{ row.allDay ? ' · Todo el día' : '' }}</p></div>
        <div v-if="editable(row)" class="flex gap-2"><button type="button" class="settings-button" :disabled="saving" @click="startEdit(row)">Editar</button><button type="button" class="settings-button" :disabled="saving" @click="remove(row.id)">Eliminar</button></div>
      </li></ul>
      <form v-if="edit || manage" class="space-y-4" @submit.prevent="save">
        <h3 class="text-sm font-semibold text-brand-text">{{ editingId ? 'Editar bloqueo' : 'Agregar bloqueo' }}</h3>
        <fieldset :disabled="saving" class="grid gap-3 sm:grid-cols-2">
          <label class="settings-field">Persona<select v-model="form.userId" :disabled="!manage"><option v-if="manage" value="">Toda la organización</option><option v-for="person in people.filter(p => manage || p.id === ownId)" :key="person.id" :value="person.id">{{ person.name }}</option></select></label>
          <label class="settings-field">Motivo<input id="agenda-block-reason" v-model="form.reason" required maxlength="500" placeholder="Vacaciones, festivo o ausencia" /></label>
          <label class="settings-field">Inicio<input v-model="form.startLocal" type="datetime-local" required /></label><label class="settings-field">Fin exclusivo<input v-model="form.endLocal" type="datetime-local" required /></label>
          <label class="flex items-center gap-2 text-sm text-brand-text"><input v-model="form.allDay" type="checkbox" />Todo el día</label>
        </fieldset>
        <p class="text-xs text-brand-text-muted">Todo el día usa medianoche; el fin es el día siguiente al último bloqueado.</p>
        <div class="flex gap-2"><button type="submit" class="settings-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar bloqueo' }}</button><button v-if="editingId" type="button" class="settings-button" @click="reset">Cancelar edición</button></div>
      </form>
    </template>
    <p v-if="failure" role="alert" class="mt-3 text-sm text-brand-error-text">{{ failure }}</p><p v-if="message" role="status" class="mt-3 text-sm text-brand-success-text">{{ message }}</p>
  </section>
</template>

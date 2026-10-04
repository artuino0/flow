<script setup lang="ts">
import { CalendarDays, Check, ChevronDown, CircleAlert, RefreshCw, Users } from '@lucide/vue'
import { agendaSiteSettingsSchema, type AgendaSiteConfig } from '~/utils/agendaPublic'
import { agendaAccentPresets, agendaAccentPresentation, normalizeAgendaAccent } from '~/utils/agendaAccent'
import { publicAgendaRuntime } from '~/utils/publicAgendaRuntime'
import { agendaAdministrationError, agendaReadiness, publishedDocumentHasAgenda } from '~/utils/agendaAdministration'

definePageMeta({ layout: 'default', darkReady: true })
interface Entry { id: string; name: string; scheduled?: boolean }
interface Administration { ownStaff?: { id: string; administrator: boolean; scheduled: boolean } | null; scheduledOtherRoles?: string[]; settings: AgendaSiteConfig; available: boolean; reason: string | null; services: Entry[]; people: Entry[]; recent: Array<{ id: string; status: string; date: string; time: string; personal: string; services: string[] }> }
const route = useRoute(), siteId = String(route.params.siteId)
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data, error, pending, refresh } = await useFetch<Administration>('/api/agenda/site-settings', { query: { site: siteId }, headers })
interface SiteInfo { name?: string; pages: Array<{ id: string; path: string; publishedVersionId: string | null }> }
const { data: site, error: siteError, pending: sitePending, refresh: refreshSite } = await useFetch<SiteInfo>(`/api/sites/${encodeURIComponent(siteId)}`, { headers })
const publishedPage = ref<string | null>(null), inspecting = ref(true), publicationFailure = ref('')
let inspection = 0
async function inspectPublication() {
  const current = ++inspection
  inspecting.value = true; publicationFailure.value = ''; publishedPage.value = null
  try {
    for (const page of site.value?.pages ?? []) {
      if (!page.publishedVersionId) continue
      const href = `/site-preview/${encodeURIComponent(siteId)}${page.path === '/' ? '' : page.path}`
      const html = await $fetch<string>(href, { responseType: 'text' })
      if (current !== inspection) return
      if (publishedDocumentHasAgenda(html)) { publishedPage.value = href; break }
    }
  } catch (err: unknown) { if (current === inspection) publicationFailure.value = agendaAdministrationError(err, 'load') }
  finally { if (current === inspection) inspecting.value = false }
}
onMounted(inspectPublication)
onBeforeUnmount(() => { inspection++ })
async function retry() { await Promise.all([refresh(), refreshSite()]); await inspectPublication() }
const loadError = computed(() => error.value || siteError.value)
const readiness = computed(() => data.value ? agendaReadiness(data.value, siteId, publishedPage.value) : [])
const ready = computed(() => !inspecting.value && !publicationFailure.value && readiness.value.length === 6 && readiness.value.every(item => item.ready))
const completedRequirements = computed(() => readiness.value.filter(item => item.ready).length)
const stateExpanded = ref(true), stateAnnouncement = ref('')
let lastVerifiedReady: boolean | null = null
watch([ready, inspecting], ([complete, checking]) => {
  if (checking || complete === lastVerifiedReady) return
  stateExpanded.value = !complete
  stateAnnouncement.value = complete && lastVerifiedReady === false ? 'Tu agenda está lista. Estado de la agenda completado; tarjeta contraída.' : ''
  lastVerifiedReady = complete
}, { immediate: true })
const form = reactive(agendaSiteSettingsSchema.parse({}))
const serviceSearch = ref(''), peopleSearch = ref(''), saving = ref(false), saved = ref(false), failure = ref('')
const accents = agendaAccentPresets
const contrast = computed(() => agendaAccentPresentation(form.accent, form.accentColor))
const customColor = computed({ get: () => form.accentColor ?? '', set: (value: string) => { form.accentColor = normalizeAgendaAccent(value) ?? value } })
watch(() => form.accent, value => {
  if (value !== 'custom' && form.accentColor !== undefined && !normalizeAgendaAccent(form.accentColor)) delete form.accentColor
})
const colorPicker = computed({ get: () => normalizeAgendaAccent(form.accentColor) ?? '#' + accents.primary.map(channel => channel.toString(16).padStart(2, '0')).join(''), set: (value: string) => { customColor.value = value } })
const creatingOwnSchedule = ref(false), ownScheduleFailure = ref('')
async function createOwnSchedule() {
  if (creatingOwnSchedule.value) return
  creatingOwnSchedule.value = true; ownScheduleFailure.value = ''
  const draft = structuredClone(toRaw(form))
  try { await $fetch('/api/agenda/own-schedule', { method: 'POST', body: {} }); await refresh(); Object.assign(form, draft) }
  catch (error: unknown) { ownScheduleFailure.value = agendaAdministrationError(error, 'save') }
  finally { creatingOwnSchedule.value = false }
}
const assignment = computed({ get: () => form.assignmentMode ?? 'inherit', set: (value: string) => { form.assignmentMode = value === 'inherit' ? null : value as NonNullable<AgendaSiteConfig['assignmentMode']> } })
const assignmentOptions = [{ value: 'client_chooses', label: 'Elige el cliente', description: 'El visitante elige a la persona que le atenderá.' }, { value: 'auto', label: 'Automática', description: 'La agenda asigna la primera persona disponible.' }, { value: 'both', label: 'Ambas', description: 'El visitante puede elegir o dejar que Flow asigne.' }, { value: 'inherit', label: 'Heredar de la organización', description: 'Usa las reglas de Ajustes → Agenda.' }]
const accentOptions = [{ value: 'primary', label: 'Principal' }, { value: 'secondary', label: 'Secundario' }, { value: 'accent', label: 'Acento' }, { value: 'custom', label: 'Personalizado' }]
const dirty = computed(() => !!data.value && JSON.stringify(form) !== JSON.stringify(agendaSiteSettingsSchema.parse(data.value.settings)))
function discard() { if (data.value) Object.assign(form, agendaSiteSettingsSchema.parse(data.value.settings)); failure.value = ''; saved.value = false }
const requirementDescriptions: Record<string, string> = { base: 'Activa el módulo de agenda en tu cuenta.', services: 'Lo que tus visitantes podrán reservar.', schedules: 'Pueden atender usuarios activos con rol Personal, con horario de agenda o administradores de la organización.', visible: 'Administradores y usuarios activos con horario también cuentan, sin cambiar su rol. Al menos una persona visible necesita horario.', enabled: 'Se activa en «Reservas públicas».', published: 'Inserta el marcador en una página y publícala.' }
const fieldNames = { name: 'Nombre', phone: 'Teléfono', email: 'Correo' } as const
const availableServices = computed(() => data.value?.services.filter(s => s.name.toLocaleLowerCase().includes(serviceSearch.value.toLocaleLowerCase())) ?? [])
const availablePeople = computed(() => data.value?.people.filter(p => p.name.toLocaleLowerCase().includes(peopleSearch.value.toLocaleLowerCase())) ?? [])
watch(data, value => { if (value) Object.assign(form, agendaSiteSettingsSchema.parse(value.settings)) }, { immediate: true })
const validations = computed(() => {
  const parsed = agendaSiteSettingsSchema.safeParse(form)
  const messages = parsed.success ? [] : parsed.error.issues.map(issue => issue.message)
  if (form.enabled && !data.value?.available) messages.push(data.value?.reason ?? 'La agenda no está disponible.')
  if (form.enabled && !data.value?.services.length) messages.push('Agrega servicios en Citas base antes de publicar la agenda.')
  if (form.enabled && !data.value?.people.some(p => p.scheduled && (!form.personalIds.length || form.personalIds.includes(p.id)))) messages.push('Selecciona personal con un horario definido.')
  return messages
})
const preview = computed(() => {
  const accent = contrast.value.approved ? contrast.value.css : agendaAccentPresentation('primary').css
  return `<!doctype html><html lang="es"><head><meta name="color-scheme" content="light"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p>Vista previa con datos simulados.</p><button data-flow-agenda-open>Probar modal</button><div data-flow-agenda="inline"></div>${publicAgendaRuntime({ site: siteId, page: 'preview', locale: 'es', timezone: 'America/Mexico_City', accent, fields: form.visibleFields, requiredFields: form.requiredFields, assignmentMode: form.assignmentMode ?? 'both', preview: true })}</body></html>`
})
async function save() {
  if (saving.value || validations.value.length) return
  saving.value = true; saved.value = false; failure.value = ''
  try { await $fetch('/api/agenda/site-settings', { method: 'PUT', body: { site: siteId, settings: agendaSiteSettingsSchema.parse(form) } }); await refresh(); saved.value = true }
  catch (err: unknown) { failure.value = agendaAdministrationError(err, 'save') }
  finally { saving.value = false }
}
function personName(id: string) { return data.value?.people.find(p => p.id === id)?.name ?? 'Personal' }
function serviceNames(ids: string[]) { return ids.map(id => data.value?.services.find(s => s.id === id)?.name ?? 'Servicio').join(', ') }
</script>

<template>
  <SitesAdminPage class="agenda-ui agenda-admin">
    <ListPageHeader title="Agenda del sitio" description="Permite que tus visitantes reserven una cita y la gestionen desde su correo." :breadcrumb="`Sites / ${site?.name || 'Sitio'} / Agenda`" :show-toolbar="false">
      <template #breadcrumb><NuxtLink to="/sites">Sites</NuxtLink><span aria-hidden="true">/</span><NuxtLink :to="`/sites/${encodeURIComponent(siteId)}`">{{ site?.name || 'Sitio' }}</NuxtLink><span aria-hidden="true">/</span><span>Agenda</span></template>
      <template #title-help><span class="state-pill" :class="ready ? 'is-complete' : 'is-pending'">{{ ready ? 'Lista' : 'Falta configurar' }}</span><ModuleTourHelpButton help-id="sites:agenda" /></template>
      <template #actions><button type="button" class="settings-button header-refresh" aria-label="Actualizar" :disabled="pending || sitePending || inspecting" @click="retry"><RefreshCw :size="14" aria-hidden="true" /><span>Actualizar</span></button></template>
    </ListPageHeader>
    <div class="agenda-content">
      <p v-if="pending || sitePending" role="status" class="settings-card">Cargando configuración…</p>
      <div v-else-if="loadError" role="alert" class="settings-card error-state"><p>{{ agendaAdministrationError(loadError, 'load') }}</p><button type="button" class="settings-button mt-3" @click="retry">Reintentar</button></div>
      <template v-else-if="data">
        <section class="settings-card agenda-card readiness" aria-labelledby="agenda-state-title">
          <header class="agenda-card-heading readiness-heading"><div><h2 id="agenda-state-title">Estado de la agenda</h2><p v-if="stateExpanded">{{ completedRequirements }} de 6 pasos completos</p></div>
            <div class="readiness-actions"><span class="state-pill" :class="ready ? 'is-complete' : 'is-pending'"><Check v-if="ready" :size="14" aria-hidden="true" /><CircleAlert v-else :size="14" aria-hidden="true" />{{ ready ? 'Completado' : `${completedRequirements} de 6` }}</span><button type="button" class="state-toggle" :aria-expanded="stateExpanded" aria-controls="agenda-readiness-details" :aria-label="stateExpanded ? 'Contraer estado de la agenda' : 'Expandir estado de la agenda'" @click="stateExpanded = !stateExpanded"><ChevronDown :size="18" :class="{ expanded: stateExpanded }" aria-hidden="true" /></button></div>
          </header>
          <p class="sr-only" role="status" aria-live="polite">{{ stateAnnouncement }}</p>
          <div v-show="stateExpanded" id="agenda-readiness-details">
            <p v-if="ready" class="success-text ready-link">✓ Tu agenda está lista. <a :href="publishedPage!" class="text-link" target="_blank" rel="noopener noreferrer">Ver mi agenda pública</a></p>
            <ul class="checklist"><li v-for="item in readiness" :key="item.key" :data-requirement="item.key" :data-ready="item.ready">
              <span class="requirement-icon" :class="item.ready ? 'is-complete' : 'is-pending'" aria-hidden="true"><Check v-if="item.ready" :size="15" /><CircleAlert v-else :size="15" /></span>
              <div class="requirement-copy"><strong>{{ item.label }}</strong><p>{{ requirementDescriptions[item.key] }}</p></div>
              <div class="requirement-actions"><span class="state-pill" :class="item.ready ? 'is-complete' : 'is-pending'">{{ item.ready ? 'Completo' : item.key === 'published' && inspecting ? 'Comprobando…' : 'Pendiente' }}</span><div v-if="!item.ready" class="check-links"><NuxtLink v-for="link in item.links" :key="link.to" :to="link.to" class="settings-button">{{ link.label }}</NuxtLink></div></div>
            </li></ul>
            <p v-if="data.scheduledOtherRoles?.length" class="ready-link">También cuentan usuarios activos con horario: {{ data.scheduledOtherRoles.join(', ') }}.</p>
            <div v-if="data.ownStaff?.administrator && !data.ownStaff.scheduled" class="ready-link"><p>Tu usuario aún no tiene horario de agenda.</p><button type="button" class="settings-button mt-3" :disabled="creatingOwnSchedule" @click="createOwnSchedule">{{ creatingOwnSchedule ? 'Creando horario…' : 'Atiendo citas yo: crear mi horario L-V 9 a 18' }}</button><p v-if="ownScheduleFailure" role="alert" class="error-text">{{ ownScheduleFailure }}</p></div>
            <p v-if="publicationFailure" role="alert" class="error-text ready-link">No pudimos comprobar la página publicada. {{ publicationFailure }} <button type="button" class="settings-button mt-3" @click="inspectPublication">Reintentar</button></p>
          </div>
        </section>
        <form id="agenda-site-form" class="agenda-sections" @submit.prevent="save">
          <AgendaCard title="Reservas públicas" description="Controla si tus visitantes pueden reservar y qué datos se les piden." data-tour="sites-agenda-settings">
            <div class="enable-row"><div><label for="agenda-enabled" class="font-semibold">Activar agenda en este sitio</label><p>Mientras esté apagada, el marcador no mostrará la agenda.</p></div><input id="agenda-enabled" v-model="form.enabled" type="checkbox" role="switch" class="agenda-switch" :disabled="!data.available" /></div>
            <h3 class="field-group-title">Datos que se piden al cliente</h3>
            <div class="client-fields"><div v-for="(label, key) in fieldNames" :key="key" class="client-field-row"><span>{{ label }}</span><div><label class="check-row"><input v-model="form.visibleFields" class="agenda-switch" role="switch" type="checkbox" :value="key" />Pedir {{ label }}</label><label class="check-row"><input v-model="form.requiredFields" type="checkbox" :value="key" />{{ label }} obligatorio</label></div></div></div>
            <p>Siempre se exige al menos un contacto.</p>
            <details class="mt-4"><summary>Opciones avanzadas de reservas</summary>
            <label class="check-row mt-4"><input v-model="form.requireConsent" type="checkbox" />Pedir consentimiento para gestionar la cita</label>
            <details class="mt-5"><summary>Campos del módulo de clientes</summary><div class="settings-grid mt-3"><label v-for="(label, key) in fieldNames" :key="key">{{ label }}<input v-model="form.clientFields[key]" required pattern="[a-z][a-z0-9_]{0,63}" class="control" /></label></div></details>
            <label class="mt-5 block">Mensaje de confirmación<textarea v-model="form.confirmationMessage" maxlength="2000" rows="3" class="control" /></label>
            </details>
          </AgendaCard>
          <AgendaCard title="Servicios y personal" description="Elige qué servicios y personas podrán reservarse en tu agenda pública." data-tour="sites-agenda-catalog">
            <div class="settings-grid catalog-columns">
              <div><div class="catalog-heading"><h3>Servicios públicos</h3><span class="catalog-count">{{ form.serviceIds.length }} de {{ data.services.length }} seleccionados</span></div><label class="mt-3 block"><span class="sr-only">Buscar servicios</span><input v-model="serviceSearch" type="search" class="control" placeholder="Buscar servicios…" /></label>
                <div v-if="!data.services.length" class="agenda-empty"><CalendarDays :size="28" aria-hidden="true" /><strong>No hay servicios disponibles</strong><p>Agrega servicios a la agenda de la organización.</p><NuxtLink to="/registros/agenda-servicios" class="text-link">Crear servicio</NuxtLink></div><p v-else-if="!availableServices.length">No hay servicios que coincidan con la búsqueda.</p><div class="catalog-list"><label v-for="service in availableServices" :key="service.id" class="check-row"><input v-model="form.serviceIds" type="checkbox" :value="service.id" />{{ service.name }}</label></div><p>Sin selección se muestran todos los servicios disponibles.</p>
              </div>
              <div id="agenda-personal"><div class="catalog-heading"><h3>Personal visible</h3><span class="catalog-count">{{ form.personalIds.length }} de {{ data.people.length }} seleccionados</span></div><label class="mt-3 block"><span class="sr-only">Buscar personal</span><input v-model="peopleSearch" type="search" class="control" placeholder="Buscar personal…" /></label>
                <div v-if="!data.people.length" class="agenda-empty"><Users :size="28" aria-hidden="true" /><strong>No hay personal activo</strong><p>Configúralo en Usuarios.</p><NuxtLink to="/usuarios" class="text-link">Definir horarios</NuxtLink></div><p v-else-if="!availablePeople.length">No hay personal que coincida con la búsqueda.</p><div class="catalog-list"><label v-for="person in availablePeople" :key="person.id" class="check-row"><input v-model="form.personalIds" type="checkbox" :value="person.id" :disabled="!person.scheduled" />{{ person.name }}<span v-if="!person.scheduled" class="agenda-note">Sin horario</span></label></div><p>Sin selección se permite todo el personal con disponibilidad.</p>
              </div>
            </div>
          </AgendaCard>
          <AgendaCard title="Asignación y reglas" description="Decide cómo se asigna el personal y los límites de las reservas.">
            <AgendaChoiceTiles v-model="assignment" label="Modo de asignación" :options="assignmentOptions" />
            <div class="settings-grid mt-5"><label>Anticipación para cancelar o reprogramar (horas)<input v-model.number="form.cancellationHours" class="control" type="number" required min="0" max="8760" /></label><label>Máximo de citas activas por correo o teléfono<input v-model.number="form.maxActiveBookings" class="control" type="number" required min="1" max="20" /></label></div>
          </AgendaCard>
          <AgendaCard title="Aspecto" description="El componente siempre es claro. Personaliza su acento con los colores del sitio.">
            <div class="appearance-columns"><div><AgendaChoiceTiles v-model="form.accent" label="Acento del componente" :options="accentOptions"><template #default="{ option }"><span class="accent-swatch" :style="{ background: agendaAccentPresentation(option.value as AgendaSiteConfig['accent'], form.accentColor).css || 'transparent' }" aria-hidden="true" /></template></AgendaChoiceTiles><div v-if="form.accent === 'custom'" class="settings-grid mt-4"><label>Elegir color<input v-model="colorPicker" type="color" class="control" /></label><label>Color hexadecimal<input v-model="customColor" type="text" maxlength="7" placeholder="#RRGGBB" class="control" :aria-invalid="!contrast.approved" /></label></div><p class="mt-4">Contraste del botón: {{ contrast.ratio.toFixed(2) }}:1. Texto {{ contrast.foreground === 'white' ? 'claro' : 'oscuro' }} calculado.</p></div>
              <div class="accent-preview"><h3>Vista previa del botón</h3><p class="agenda-note">Datos simulados</p><span class="preview-button" :style="{ background: contrast.css, color: contrast.foreground === 'white' ? 'white' : 'black' }">Reservar cita</span><p :class="contrast.approved ? 'success-text' : 'error-text'" role="status"><span aria-hidden="true">{{ contrast.approved ? '✓' : '⚠' }}</span> {{ contrast.approved ? 'Aprobado AA' : 'Insuficiente' }}</p><p v-if="!contrast.approved">Escribe un color hexadecimal válido. Usa un color más oscuro si el contraste es insuficiente.</p><p class="agenda-note">El acento se usa en botones y selecciones.</p><div class="mini-agenda" aria-label="Miniatura de agenda con datos simulados"><strong>Agenda de citas</strong><ol class="mini-days" aria-label="Días de ejemplo"><li v-for="day in [9, 10, 12, 14]" :key="day">{{ day }}</li></ol><ol class="mini-hours" aria-label="Horas de ejemplo"><li v-for="hour in ['10:30', '11:00', '11:30']" :key="hour">{{ hour }}</li></ol><span class="preview-button" :style="{ background: contrast.css, color: contrast.foreground === 'white' ? 'white' : 'black' }">Continuar</span></div></div>
            </div>
            <details class="mt-5" data-tour="sites-agenda-preview"><summary>Vista previa segura del componente y modal</summary><p>Usa datos simulados. Ninguna acción de esta vista crea o modifica citas.</p><iframe :srcdoc="preview" sandbox="allow-scripts allow-modals" title="Vista previa clara del componente y modal de agenda" class="agenda-preview" /><p>Inserta el componente o un botón modal desde el editor de páginas. Los parámetros servicio y personal aceptan el nombre convertido en slug o su ID público.</p></details>
          </AgendaCard>
          <ul v-if="validations.length" role="alert" class="rounded bg-brand-warning-bg p-4 text-sm text-brand-warning-text"><li v-for="message in validations" :key="message">{{ message }}</li></ul>
          <div v-if="failure" role="alert" class="settings-card error-state"><p>{{ failure }}</p><button type="button" class="settings-button mt-3" :disabled="saving" @click="save">Reintentar</button></div>
        </form>
        <AgendaCard title="Reservas recientes" description="Las últimas citas que llegaron desde tu agenda pública."><template #actions><NuxtLink to="/registros/agenda-citas" class="text-link">Ver todas</NuxtLink></template>
          <div v-if="!data.recent.length" class="agenda-empty table-state"><CalendarDays :size="32" aria-hidden="true" /><strong>Aún no hay reservas desde tu sitio</strong><p>Cuando alguien reserve una cita, aparecerá aquí.</p></div>
          <div v-else class="agenda-table" tabindex="0" role="region" aria-label="Reservas públicas recientes"><table><thead><tr><th scope="col">Fecha y hora</th><th scope="col">Servicio</th><th scope="col">Personal</th><th scope="col">Estado</th></tr></thead><tbody><tr v-for="booking in data.recent" :key="booking.id"><td>{{ booking.date }} {{ booking.time }}</td><td>{{ serviceNames(booking.services) }}</td><td>{{ personName(booking.personal) }}</td><td>{{ booking.status === 'active' ? 'Activa' : 'Cancelada' }}</td></tr></tbody></table></div>
        </AgendaCard>
      </template>
      <section v-else class="settings-card"><p>No hay configuración disponible para este sitio.</p><button type="button" class="settings-button mt-3" @click="retry">Reintentar</button></section>
    </div>
    <footer v-if="data && !loadError && !pending && !sitePending" class="agenda-action-bar site-action-bar"><span v-if="saved" role="status" class="success-text">Cambios guardados.</span><span v-else>{{ dirty ? 'Hay cambios por guardar' : 'Sin cambios por guardar' }}</span><div><button type="button" class="settings-button" :disabled="saving" @click="discard">Descartar</button><button type="submit" form="agenda-site-form" :disabled="saving || validations.length > 0" class="settings-button agenda-primary primary-button">{{ saving ? 'Guardando…' : 'Guardar cambios' }}</button></div></footer>
  </SitesAdminPage>
</template>
<style scoped>
.agenda-content{display:grid;gap:24px;padding-top:28px}.agenda-sections{display:grid;gap:24px}.agenda-admin :deep(.list-page-heading){height:113px}.agenda-admin :deep(.agenda-card-body p),.readiness p{font-size:12px;color:rgb(var(--brand-text-secondary))}.readiness-heading{border-bottom:1px solid rgb(var(--brand-border-light))}.readiness-actions{display:flex;align-items:center;gap:8px;flex:none}.state-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:700}.is-complete{background:rgb(var(--brand-success-bg));color:rgb(var(--brand-success-text))}.is-pending{background:rgb(var(--brand-warning-bg));color:rgb(var(--brand-warning-text))}.state-toggle{display:grid;place-items:center;width:32px;height:32px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));color:rgb(var(--brand-text))}.state-toggle svg.expanded{transform:rotate(180deg)}.ready-link{padding:14px 24px}.checklist{list-style:none;margin:0;padding:0}.checklist li{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid rgb(var(--brand-border-light))}.checklist li:last-child{border:0}.requirement-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;flex:none}.requirement-copy{flex:1;min-width:0}.requirement-copy strong{font-size:13px;font-weight:600}.requirement-copy p{margin:2px 0 0}.requirement-actions{display:flex;gap:10px;align-items:center}.check-links{display:flex;gap:6px;flex-wrap:wrap;max-width:340px}.check-links .settings-button{min-height:28px;padding:5px 10px;font-size:12px}.text-link{color:rgb(var(--brand-blue));text-decoration:underline}.enable-row{display:flex;justify-content:space-between;gap:16px;align-items:center;padding-bottom:20px;border-bottom:1px solid rgb(var(--brand-border-light))}.field-group-title{font-weight:600;margin:20px 0 10px}.client-fields{display:grid;gap:8px}.client-field-row{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;background:rgb(var(--brand-bg));border-radius:4px}.client-field-row>div{display:flex;gap:16px}.check-row{display:flex;align-items:center;gap:8px}.check-row input{flex:none}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.catalog-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.catalog-heading h3{font-weight:600}.catalog-count{font-size:11px;color:rgb(var(--brand-text-muted))}.catalog-list{display:grid;gap:10px;margin:14px 0}.control{display:block;box-sizing:border-box;min-width:0;width:100%;margin-top:6px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));color:rgb(var(--brand-text));padding:9px 12px;font:inherit;color-scheme:inherit}.appearance-columns{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px}.appearance-columns :deep(.agenda-choice-tiles){grid-template-columns:repeat(2,minmax(0,1fr))}.accent-swatch{width:18px;height:18px;border-radius:50%;border:1px solid rgb(var(--brand-border))}.accent-preview{border:1px solid rgb(var(--brand-border-light));border-radius:6px;padding:16px;display:grid;gap:10px}.accent-preview h3{font-weight:600}.preview-button{display:block;text-align:center;border-radius:4px;padding:10px;font-weight:600}.agenda-preview{display:block;height:720px;width:100%;max-width:100%;margin:16px 0;border:1px solid rgb(var(--brand-border-light));border-radius:6px}.agenda-table{overflow-x:auto}.agenda-table table{width:100%;min-width:600px;text-align:left;border-collapse:collapse}.agenda-table th{height:40px;padding:0 14px;background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary));font-size:12px}.agenda-table td{padding:14px;border-top:1px solid rgb(var(--brand-border-light));font-size:13px}.site-action-bar{position:sticky;bottom:-28px;margin:28px -28px -28px;padding:14px 28px;z-index:2}.success-text{color:rgb(var(--brand-success-text))}.error-text,.error-state{color:rgb(var(--brand-error-text))}.agenda-empty :deep(svg){margin:auto}
@media(max-width:900px){.appearance-columns{grid-template-columns:minmax(0,1fr)}.requirement-actions{flex-wrap:wrap}.check-links{max-width:230px}}@media(max-width:720px){.agenda-content{gap:16px;padding-top:16px}.agenda-sections{gap:16px}.agenda-admin :deep(.list-page-heading){height:auto;min-height:90px;padding:14px 16px}.agenda-admin :deep(.list-title-row){margin-top:6px;gap:8px}.agenda-admin :deep(.list-title-line h1){font-size:20px}.agenda-admin :deep(.list-title-line){flex-wrap:wrap}.checklist li{padding:14px 16px;display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start}.requirement-actions{grid-column:2;justify-content:flex-start}.check-links{max-width:100%}.settings-grid{grid-template-columns:minmax(0,1fr);gap:16px}.client-field-row{flex-wrap:wrap}.client-field-row>div{flex-wrap:wrap}.appearance-columns :deep(.agenda-choice-tiles){grid-template-columns:minmax(0,1fr)}.site-action-bar{bottom:-16px;margin:16px -16px -16px;padding:12px 16px}.readiness-actions{gap:4px}.readiness-heading{flex-wrap:wrap}.ready-link{padding:14px 16px}}
</style>

<style scoped>
.agenda-admin :deep(.list-page-heading){position:relative}
@media(max-width:720px){.header-refresh>span{display:none}.header-refresh{min-width:32px;padding:7px}.agenda-admin :deep(.list-header-actions){position:absolute;right:16px;top:12px}.agenda-admin :deep(.list-title-row){gap:0}.agenda-admin :deep(.list-title-line){gap:6px}}
</style>

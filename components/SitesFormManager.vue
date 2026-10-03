<script setup lang="ts">
import { Braces, ClipboardList, ExternalLink, Link2, Unplug, X } from '@lucide/vue'

const props = defineProps<{ siteId?: string }>()

type DefaultValue = string | number | boolean | null | string[]

interface FormConnection {
  entityId: string
  entityName: string
  entitySlug: string
  fieldMapping: Record<string, string>
  defaultValues: Record<string, DefaultValue>
  valueMappings: Record<string, Record<string, string>>
}
interface DetectedForm {
  id: string
  name: string
  method: string
  action: string
  fields: Array<{
    name: string
    label: string
    type: string
    required: boolean
    options?: Array<{ value: string; label: string }>
  }>
  siteId: string
  siteName?: string
  siteSlug?: string
  pageId: string
  pageTitle: string
  pagePath: string
  updatedAt: string
  connection: FormConnection | null
}
interface CoreEntity { id: string; name: string; slug: string; isActive: boolean; deletedAt?: string | null }
interface CoreField {
  id: string
  name: string
  label: string
  dataType: string
  isRequired: boolean
  validationRules: { options?: Array<{ value: string; label: string }> }
}

const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const endpoint = computed(() => props.siteId ? '/api/sites/' + props.siteId + '/forms' : '/api/sites/forms')
const [{ data, pending, error, refresh }, { data: entityData }] = await Promise.all([
  useFetch<{ forms: DetectedForm[] }>(endpoint, { headers }),
  useFetch<{ entities: CoreEntity[] }>('/api/entities?deleted=exclude', { headers })
])
const query = ref('')
const view = ref<'all' | 'connected' | 'pending'>('all')
const selectedForm = ref<DetectedForm | null>(null)
const selectedEntityId = ref('')
const selectedMapping = ref<Record<string, string>>({})
const selectedDefaults = ref<Record<string, DefaultValue>>({})
const selectedValueMappings = ref<Record<string, Record<string, string>>>({})
const targetFields = ref<CoreField[]>([])
const fieldsLoading = ref(false)
const saving = ref(false)
const modalError = ref('')
const toast = useToast()
// HU-ERD-104c: conectar un formulario detectado crea una conexión y consume
// cuota del plan ('forms') - aviso antes de abrir el modal (solo cuando aún no
// está conectado) y mismo aviso si el servidor responde 402 al guardar.
const { checkBeforeCreate, handlePlanLimitError } = usePlanLimit()

const coreEntities = computed(() => (entityData.value?.entities ?? []).filter(entity => entity.isActive && !entity.deletedAt))
const mappableTargetFields = computed(() => targetFields.value.filter(field =>
  field.name !== 'id' && ['text', 'number', 'currency', 'boolean', 'date', 'select', 'multiselect'].includes(field.dataType)
))
const mappedTargetNames = computed(() => new Set(Object.values(selectedMapping.value).filter(Boolean)))
const defaultTargetFields = computed(() => mappableTargetFields.value.filter(field => !mappedTargetNames.value.has(field.name)))
const unresolvedRequiredFields = computed(() => {
  const sourceByName = new Map((selectedForm.value?.fields ?? []).map(field => [field.name, field]))
  return mappableTargetFields.value.filter(field => {
    if (!field.isRequired || hasDefaultValue(selectedDefaults.value[field.name])) return false
    const sourceName = Object.entries(selectedMapping.value).find(([, target]) => target === field.name)?.[0]
    return !sourceName || !sourceByName.get(sourceName)?.required
  })
})
const unresolvedOptionMappings = computed(() => (selectedForm.value?.fields ?? []).flatMap(field => {
  if (!field.options?.length) return []
  const target = targetFieldForSource(field.name)
  if (!target || !['select', 'multiselect'].includes(target.dataType)) return []
  return field.options.filter(option => !selectedValueMappings.value[field.name]?.[option.value])
    .map(option => `${field.label}: ${option.label}`)
}))
const allForms = computed(() => data.value?.forms ?? [])
const connectedCount = computed(() => allForms.value.filter(form => form.connection).length)
const pendingCount = computed(() => allForms.value.length - connectedCount.value)
const forms = computed(() => allForms.value.filter(form => {
  if (view.value === 'connected' && !form.connection) return false
  if (view.value === 'pending' && form.connection) return false
  const term = query.value.trim().toLowerCase()
  return !term || form.name.toLowerCase().includes(term) || form.pageTitle.toLowerCase().includes(term) || (form.siteName ?? '').toLowerCase().includes(term)
}))

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}
function hasDefaultValue(value: DefaultValue | undefined) {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
}
function fieldOptions(field: CoreField) {
  return Array.isArray(field.validationRules?.options) ? field.validationRules.options : []
}
function targetFieldForSource(sourceName: string) {
  const targetName = selectedMapping.value[sourceName]
  return mappableTargetFields.value.find(field => field.name === targetName)
}
function targetOptionsForSource(sourceName: string) {
  const target = targetFieldForSource(sourceName)
  return target ? fieldOptions(target) : []
}
function needsOptionMapping(field: DetectedForm['fields'][number]) {
  const target = targetFieldForSource(field.name)
  return Boolean(field.options?.length && target && ['select', 'multiselect'].includes(target.dataType))
}
function initializeValueMapping(sourceName: string, existing: Record<string, string> = {}) {
  const source = selectedForm.value?.fields.find(field => field.name === sourceName)
  const target = targetFieldForSource(sourceName)
  if (!source?.options?.length || !target || !['select', 'multiselect'].includes(target.dataType)) {
    delete selectedValueMappings.value[sourceName]
    return
  }
  const allowed = new Set(fieldOptions(target).map(option => option.value))
  selectedValueMappings.value[sourceName] = Object.fromEntries(source.options.map(option => {
    const configured = existing[option.value]
    return [option.value, configured && allowed.has(configured) ? configured : allowed.has(option.value) ? option.value : '']
  }))
}
function changeFieldMapping(sourceName: string) {
  initializeValueMapping(sourceName)
}
async function loadTargetFields(
  entityId: string,
  existing: Record<string, string> = {},
  existingDefaults: Record<string, DefaultValue> = {},
  existingValueMappings: Record<string, Record<string, string>> = {}
) {
  targetFields.value = []
  selectedMapping.value = {}
  selectedDefaults.value = {}
  selectedValueMappings.value = {}
  const entity = coreEntities.value.find(item => item.id === entityId)
  if (!entity) return
  fieldsLoading.value = true
  try {
    const response = await $fetch<{ fields: CoreField[] }>(`/api/entities/${entity.slug}/fields`)
    targetFields.value = response.fields
    const available = new Set(response.fields.map(field => field.name))
    const next: Record<string, string> = {}
    for (const field of selectedForm.value?.fields ?? []) {
      const configured = existing[field.name]
      if (configured && available.has(configured)) next[field.name] = configured
      else if (available.has(field.name)) next[field.name] = field.name
    }
    selectedMapping.value = next
    selectedDefaults.value = Object.fromEntries(
      Object.entries(existingDefaults).filter(([name, value]) => available.has(name) && hasDefaultValue(value))
    )
    for (const field of selectedForm.value?.fields ?? []) {
      initializeValueMapping(field.name, existingValueMappings[field.name] ?? {})
    }
  } catch {
    modalError.value = 'No se pudieron cargar los campos del módulo.'
  } finally {
    fieldsLoading.value = false
  }
}
async function openConnection(form: DetectedForm) {
  if (!form.connection && !await checkBeforeCreate('forms')) return
  selectedForm.value = form
  selectedEntityId.value = form.connection?.entityId ?? ''
  modalError.value = ''
  await loadTargetFields(
    selectedEntityId.value,
    form.connection?.fieldMapping ?? {},
    form.connection?.defaultValues ?? {},
    form.connection?.valueMappings ?? {}
  )
}
async function changeEntity() {
  modalError.value = ''
  await loadTargetFields(selectedEntityId.value)
}
function closeConnection() {
  selectedForm.value = null
  selectedEntityId.value = ''
  selectedMapping.value = {}
  selectedDefaults.value = {}
  selectedValueMappings.value = {}
  targetFields.value = []
  modalError.value = ''
}
async function saveConnection() {
  const form = selectedForm.value
  if (!form || !selectedEntityId.value) {
    modalError.value = 'Selecciona un módulo de Flow Core.'
    return
  }
  saving.value = true
  modalError.value = ''
  try {
    const fieldMapping = Object.fromEntries(
      Object.entries(selectedMapping.value).filter(([, target]) => Boolean(target))
    )
    const mappedTargets = new Set(Object.values(fieldMapping))
    const defaultValues = Object.fromEntries(
      Object.entries(selectedDefaults.value).filter(([name, value]) =>
        !mappedTargets.has(name) && hasDefaultValue(value)
      )
    )
    const valueMappings = Object.fromEntries(
      Object.entries(selectedValueMappings.value)
        .filter(([sourceName]) => Boolean(fieldMapping[sourceName]))
        .map(([sourceName, values]) => [
          sourceName,
          Object.fromEntries(Object.entries(values).filter(([, targetValue]) => Boolean(targetValue)))
        ])
        .filter(([, values]) => Object.keys(values as Record<string, string>).length > 0)
    )
    await $fetch('/api/sites/' + form.siteId + '/forms/connection', {
      method: 'POST',
      body: {
        pageId: form.pageId,
        formKey: form.id,
        entityId: selectedEntityId.value,
        fieldMapping,
        defaultValues,
        valueMappings
      }
    })
    await refresh()
    toast.success('Formulario conectado', 'Los envíos quedarán asociados al módulo seleccionado.')
    closeConnection()
  } catch (err: any) {
    if (await handlePlanLimitError(err)) {
      closeConnection()
      return
    }
    modalError.value = err?.data?.statusMessage || 'No se pudo guardar la conexión.'
  } finally {
    saving.value = false
  }
}
async function removeConnection() {
  const form = selectedForm.value
  if (!form?.connection) return
  saving.value = true
  modalError.value = ''
  try {
    await $fetch('/api/sites/' + form.siteId + '/forms/connection', {
      method: 'DELETE',
      body: { pageId: form.pageId, formKey: form.id }
    })
    await refresh()
    toast.updated('Conexión eliminada', 'El formulario sigue detectado y puede conectarse de nuevo.')
    closeConnection()
  } catch (err: any) {
    modalError.value = err?.data?.statusMessage || 'No se pudo eliminar la conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="forms-manager">
    <ListPageHeader
      v-model:search="query"
      title="Formularios"
      description="Detecta formularios, revisa sus campos y conéctalos con Flow Core."
      :count="allForms.length"
      count-noun="formulario"
      search-placeholder="Buscar formularios..."
      :refreshing="pending"
      @refresh="refresh"
    />

    <div class="forms-tabs">
      <button type="button" :class="{ active: view === 'all' }" @click="view = 'all'">Todos <span>{{ allForms.length }}</span></button>
      <button type="button" :class="{ active: view === 'connected' }" @click="view = 'connected'">Conectados <span>{{ connectedCount }}</span></button>
      <button type="button" :class="{ active: view === 'pending' }" @click="view = 'pending'">Sin conectar <span>{{ pendingCount }}</span></button>
    </div>

    <div class="forms-table">
      <div class="form-row form-head" :class="{ global: !siteId }">
        <div>Formulario</div><div v-if="!siteId">Sitio</div><div>Página de origen</div><div>Campos</div><div>Conexión con Core</div><div>Actualizado</div><div />
      </div>
      <div v-if="pending" class="table-state">Cargando formularios…</div>
      <div v-else-if="error" class="table-state error">No se pudieron cargar los formularios.</div>
      <template v-else-if="forms.length">
        <div v-for="form in forms" :key="form.siteId + '-' + form.pageId + '-' + form.id" class="form-row form-data" :class="{ global: !siteId }">
          <div class="form-name"><span><ClipboardList /></span><div><strong>{{ form.name }}</strong><small>{{ form.id }}</small></div></div>
          <div v-if="!siteId">{{ form.siteName }}</div>
          <NuxtLink :to="'/sites/' + form.siteId + '/pages/' + form.pageId" class="source-page"><strong>{{ form.pageTitle }}</strong><small>{{ form.pagePath }}</small></NuxtLink>
          <div>{{ form.fields.length }}</div>
          <div><button v-if="form.connection" type="button" class="connection-active" @click="openConnection(form)"><Link2 />{{ form.connection.entityName }}</button><button v-else type="button" class="connection-pending" @click="openConnection(form)">Conectar</button></div>
          <div>{{ formatDate(form.updatedAt) }}</div>
          <div class="row-action"><NuxtLink :to="'/sites/' + form.siteId + '/pages/' + form.pageId" aria-label="Abrir página"><ExternalLink /></NuxtLink></div>
        </div>
      </template>
      <div v-else class="empty-state">
        <Braces /><strong>{{ view === 'connected' ? 'Aún no hay formularios conectados' : view === 'pending' ? 'Todos los formularios están conectados' : 'No se detectaron formularios' }}</strong>
        <p>{{ view === 'connected' ? 'Conecta los campos detectados con módulos de Flow Core.' : view === 'pending' ? 'Puedes cambiar la conexión desde la vista Conectados.' : 'Agrega data-flow-form a un formulario dentro del HTML de una página.' }}</p>
      </div>
    </div>

    <div v-if="selectedForm" class="modal-layer" @keydown.esc="closeConnection">
      <form class="connection-modal" @submit.prevent="saveConnection">
        <header><div><h2>Conectar con Flow Core</h2><p>{{ selectedForm.name }} · {{ selectedForm.pageTitle }}</p></div><button type="button" aria-label="Cerrar" @click="closeConnection"><X /></button></header>
        <div class="modal-body">
          <div class="form-summary"><ClipboardList /><div><strong>{{ selectedForm.fields.length }} campos detectados</strong><p>Mapea los datos escritos por el visitante y define los valores operativos que Flow debe agregar automáticamente.</p></div></div>
          <label>Módulo de destino<select v-model="selectedEntityId" required @change="changeEntity"><option value="" disabled>Selecciona un módulo</option><option v-for="entity in coreEntities" :key="entity.id" :value="entity.id">{{ entity.name }}</option></select></label>
          <div v-if="selectedEntityId" class="field-mapping">
            <header><strong>Mapeo de campos</strong><span>Elige dónde guardar cada dato del formulario.</span></header>
            <p v-if="fieldsLoading" class="mapping-state">Cargando campos…</p>
            <div v-else-if="mappableTargetFields.length" class="mapping-list">
              <div v-for="field in selectedForm.fields" :key="field.name" class="mapping-item">
                <label class="mapping-row">
                  <span><strong>{{ field.label }}</strong><small>{{ field.name }}<b v-if="field.required"> · obligatorio</b></small></span>
                  <select v-model="selectedMapping[field.name]" @change="changeFieldMapping(field.name)">
                    <option value="">No guardar</option>
                    <option v-for="target in mappableTargetFields" :key="target.id" :value="target.name">{{ target.label }}{{ target.isRequired ? ' *' : '' }}</option>
                  </select>
                </label>
                <div v-if="needsOptionMapping(field)" class="option-mapping">
                  <p>Equivalencias de opciones</p>
                  <label v-for="option in field.options" :key="option.value" class="option-row">
                    <span><strong>{{ option.label }}</strong><small>{{ option.value }}</small></span>
                    <select v-model="selectedValueMappings[field.name][option.value]">
                      <option value="">Selecciona una opción</option>
                      <option v-for="targetOption in targetOptionsForSource(field.name)" :key="targetOption.value" :value="targetOption.value">{{ targetOption.label }}</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <p v-else-if="!fieldsLoading" class="mapping-state">Este módulo no tiene campos compatibles.</p>
          </div>
          <div v-if="selectedEntityId && !fieldsLoading && defaultTargetFields.length" class="field-defaults">
            <header><strong>Valores automáticos</strong><span>Flow los agregará a cada registro aunque no aparezcan en el formulario público.</span></header>
            <div class="defaults-list">
              <label v-for="field in defaultTargetFields" :key="field.name" class="default-row">
                <span><strong>{{ field.label }}</strong><small>{{ field.name }}<b v-if="field.isRequired"> · obligatorio</b></small></span>
                <select v-if="field.dataType === 'select'" v-model="selectedDefaults[field.name]">
                  <option value="">No definir</option>
                  <option v-for="option in fieldOptions(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <select v-else-if="field.dataType === 'multiselect'" v-model="selectedDefaults[field.name]" multiple>
                  <option v-for="option in fieldOptions(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <select v-else-if="field.dataType === 'boolean'" v-model="selectedDefaults[field.name]">
                  <option value="">No definir</option>
                  <option :value="true">Sí</option>
                  <option :value="false">No</option>
                </select>
                <input v-else-if="field.dataType === 'number' || field.dataType === 'currency'" v-model.number="selectedDefaults[field.name]" type="number" placeholder="No definir">
                <input v-else-if="field.dataType === 'date'" v-model="selectedDefaults[field.name]" type="date">
                <input v-else v-model="selectedDefaults[field.name]" type="text" placeholder="No definir">
              </label>
            </div>
          </div>
          <p v-if="unresolvedRequiredFields.length" class="mapping-warning">
            Falta completar: {{ unresolvedRequiredFields.map(field => field.label).join(', ') }}. Mapea un campo obligatorio del formulario o define un valor automático.
          </p>
          <p v-if="unresolvedOptionMappings.length" class="mapping-warning">
            Define la equivalencia de {{ unresolvedOptionMappings.length }} {{ unresolvedOptionMappings.length === 1 ? 'opción' : 'opciones' }} antes de guardar.
          </p>
          <p v-if="modalError" class="form-error">{{ modalError }}</p>
        </div>
        <footer><button v-if="selectedForm.connection" type="button" class="danger-button" :disabled="saving" @click="removeConnection"><Unplug />Quitar conexión</button><span /><button type="button" class="secondary-button" @click="closeConnection">Cancelar</button><button class="primary-button" :disabled="saving || !selectedEntityId || unresolvedRequiredFields.length > 0 || unresolvedOptionMappings.length > 0">{{ saving ? 'Guardando…' : 'Guardar conexión' }}</button></footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.forms-manager{min-height:100%;width:100%;padding:32px;background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.forms-heading{display:flex;min-height:54px;align-items:flex-start;justify-content:space-between;gap:24px}.forms-heading h1{margin:0;font-size:26px;line-height:1.15;font-weight:700}.forms-heading p{margin:6px 0 0;color:rgb(var(--brand-text-secondary));font-size:14px}.secondary-button{height:36px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 14px;color:rgb(var(--brand-text));font-size:13px;font-weight:600}.forms-tabs{display:flex;margin-top:20px;border-bottom:1px solid rgb(var(--brand-control-border));gap:24px}.forms-tabs button{position:relative;height:40px;border:0;background:transparent;padding:0;color:rgb(var(--brand-text-secondary));font-size:13px;font-weight:600}.forms-tabs button.active{color:rgb(var(--brand-text))}.forms-tabs button.active:after{position:absolute;right:0;bottom:-1px;left:0;height:2px;background:rgb(var(--brand-orange));content:""}.forms-tabs span{margin-left:4px;color:rgb(var(--brand-sites-muted));font-size:11px}.forms-toolbar{padding:16px 0}.forms-toolbar label{display:flex;height:36px;width:320px;align-items:center;gap:8px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 11px}.forms-toolbar svg{height:16px;width:16px;color:rgb(var(--brand-sites-muted))}.forms-toolbar input{min-width:0;flex:1;border:0;outline:0;color:rgb(var(--brand-text));font-size:13px}.forms-table{margin-top:16px;overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-surface))}.form-row{display:grid;grid-template-columns:minmax(220px,1.4fr) minmax(180px,1fr) 80px 150px 120px 46px;min-width:870px;align-items:center}.form-row.global{grid-template-columns:minmax(210px,1.35fr) minmax(140px,.8fr) minmax(180px,1fr) 80px 150px 120px 46px}.form-row>div,.form-row>a{min-width:0;padding:0 14px}.form-head{height:40px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary));font-size:11.5px;font-weight:700}.form-data{min-height:64px;border-bottom:1px solid rgb(var(--brand-border-light));color:rgb(var(--brand-text-secondary));font-size:13px}.form-data:last-child{border-bottom:0}.form-data:hover{background:rgb(var(--brand-sites-row-hover))}.form-name{display:flex;align-items:center;gap:10px}.form-name>span{display:grid;height:34px;width:34px;flex:0 0 34px;place-items:center;border-radius:4px;background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-blue))}.form-name svg{height:16px;width:16px}.form-name>div,.source-page{display:flex;min-width:0;flex-direction:column;gap:3px}.form-name strong,.source-page strong{overflow:hidden;color:rgb(var(--brand-text));font-size:13px;text-overflow:ellipsis;white-space:nowrap}.form-name small,.source-page small{overflow:hidden;color:rgb(var(--brand-sites-muted));font-size:11px;text-overflow:ellipsis;white-space:nowrap}.source-page{text-decoration:none}.connection-pending,.connection-active{display:inline-flex;max-width:100%;align-items:center;gap:5px;border:0;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:700}.connection-pending{background:rgb(var(--brand-warning-bg));color:rgb(var(--brand-warning-text))}.connection-active{overflow:hidden;background:rgb(var(--brand-success-bg));color:rgb(var(--brand-success-text));text-overflow:ellipsis;white-space:nowrap}.connection-active svg{height:12px;width:12px;flex-shrink:0}.row-action{display:flex;justify-content:center;padding:0!important}.row-action a{display:grid;height:30px;width:30px;place-items:center;border-radius:4px;color:rgb(var(--brand-sites-muted))}.row-action a:hover{background:rgb(var(--brand-sites-action-hover));color:rgb(var(--brand-text))}.row-action svg{height:15px;width:15px}.table-state{padding:28px 16px;color:rgb(var(--brand-text-secondary));font-size:13px}.table-state.error{color:rgb(var(--brand-error-text))}.empty-state{display:flex;min-height:280px;align-items:center;justify-content:center;flex-direction:column;text-align:center}.empty-state>svg{height:28px;width:28px;color:rgb(var(--brand-blue))}.empty-state strong{margin-top:12px;font-size:14px}.empty-state p{max-width:420px;margin:5px 0;color:rgb(var(--brand-sites-muted));font-size:13px}.modal-layer{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:rgb(var(--brand-shadow) / 0.4);padding:20px}.connection-modal{width:min(500px,100%);overflow:hidden;border:1px solid rgb(var(--brand-control-border));border-radius:8px;background:rgb(var(--brand-surface));box-shadow:0 12px 40px rgb(var(--brand-shadow) / 0.1803921568627451)}.connection-modal>header{display:flex;justify-content:space-between;border-bottom:1px solid rgb(var(--brand-border-light));padding:20px 22px}.connection-modal h2{margin:0;font-size:18px}.connection-modal header p{margin:4px 0 0;color:rgb(var(--brand-sites-muted));font-size:13px}.connection-modal header button{display:grid;height:28px;width:28px;place-items:center;border:0;background:transparent;color:rgb(var(--brand-sites-muted))}.connection-modal header svg{height:16px;width:16px}.modal-body{display:grid;gap:18px;padding:22px}.form-summary{display:flex;gap:11px;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-bg));padding:14px}.form-summary>svg{height:18px;width:18px;flex-shrink:0;color:rgb(var(--brand-blue))}.form-summary strong{font-size:12px}.form-summary p{margin:4px 0 0;color:rgb(var(--brand-text-secondary));font-size:11.5px;line-height:1.5}.modal-body label{display:grid;gap:7px;font-size:13px;font-weight:700}.modal-body select{height:40px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 10px;color:rgb(var(--brand-text));font-size:13px;font-weight:400;outline:none}.modal-body select:focus{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}.form-error{margin:0;border-radius:4px;background:rgb(var(--brand-error-bg));padding:9px 10px;color:rgb(var(--brand-error-text));font-size:12px}.connection-modal footer{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:10px;border-top:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-designer-section-bg));padding:14px 22px}.primary-button{height:36px;border:0;border-radius:4px;background:rgb(var(--brand-orange));padding:0 14px;color:rgb(var(--brand-primary-fg));font-size:13px;font-weight:700}.primary-button:disabled{opacity:.55}.danger-button{display:inline-flex;height:36px;align-items:center;gap:6px;border:0;background:transparent;color:rgb(var(--brand-error-text));font-size:12px;font-weight:700}.danger-button svg{height:14px;width:14px}@media(max-width:1050px){.forms-table{overflow-x:auto}}@media(max-width:640px){.forms-manager{--list-page-gutter-y:20px;--list-page-gutter-x:16px;padding:20px 16px}.forms-heading p{display:none}.forms-toolbar label{width:100%}.connection-modal footer{grid-template-columns:1fr 1fr}.connection-modal footer>span{display:none}}
.field-mapping{overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px}.field-mapping>header{display:flex;flex-direction:column;gap:3px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-designer-section-bg));padding:11px 12px}.field-mapping>header strong{font-size:12px}.field-mapping>header span{color:rgb(var(--brand-sites-muted));font-size:11px}.mapping-list{max-height:360px;overflow:auto}.mapping-item{border-bottom:1px solid rgb(var(--brand-skeleton-base))}.mapping-item:last-child{border-bottom:0}.mapping-row{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(170px,1fr);align-items:center;gap:12px;padding:9px 12px}.mapping-row>span{display:flex;min-width:0;flex-direction:column;gap:2px}.mapping-row>span strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.mapping-row small{color:rgb(var(--brand-sites-muted));font-size:10px;font-weight:400}.mapping-row small b{color:rgb(var(--brand-warning-text));font-weight:600}.mapping-row select{height:34px}.option-mapping{display:grid;gap:7px;border-top:1px solid rgb(var(--brand-skeleton-base));background:rgb(var(--brand-designer-section-bg));padding:10px 12px 12px 28px}.option-mapping>p{margin:0;color:rgb(var(--brand-text-secondary));font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}.option-row{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(170px,1fr);align-items:center;gap:12px}.option-row>span{display:flex;min-width:0;flex-direction:column;gap:1px}.option-row strong{font-size:11px}.option-row small{color:rgb(var(--brand-sites-muted));font-size:9.5px;font-weight:400}.option-row select{height:32px;font-size:11px}.mapping-state{margin:0;padding:14px;color:rgb(var(--brand-sites-muted));font-size:11px}.modal-body{max-height:min(70vh,680px);overflow:auto}.connection-modal footer{flex-shrink:0}
.field-defaults{overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px}.field-defaults>header{display:flex;flex-direction:column;gap:3px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-designer-section-bg));padding:11px 12px}.field-defaults>header strong{font-size:12px}.field-defaults>header span{color:rgb(var(--brand-sites-muted));font-size:11px}.defaults-list{max-height:250px;overflow:auto}.default-row{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(170px,1fr);align-items:center;gap:12px;border-bottom:1px solid rgb(var(--brand-skeleton-base));padding:9px 12px}.default-row:last-child{border-bottom:0}.default-row>span{display:flex;min-width:0;flex-direction:column;gap:2px}.default-row>span strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.default-row small{color:rgb(var(--brand-sites-muted));font-size:10px;font-weight:400}.default-row small b{color:rgb(var(--brand-warning-text));font-weight:600}.default-row input,.default-row select{width:100%;height:34px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:0 10px;color:rgb(var(--brand-text));font-size:12px;font-weight:400;outline:none}.default-row select[multiple]{height:72px;padding:5px 8px}.default-row input:focus,.default-row select:focus{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}.mapping-warning{margin:0;border:1px solid rgb(var(--brand-sites-warning-border));border-radius:4px;background:rgb(var(--brand-sites-warning-bg));padding:9px 10px;color:rgb(var(--brand-sites-warning-text));font-size:11px;line-height:1.45}
.forms-toolbar input{background:rgb(var(--brand-surface))}
input,select,textarea{color-scheme:inherit}
</style>

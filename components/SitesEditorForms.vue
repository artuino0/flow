<script setup lang="ts">
import { Braces, CheckCircle2, ChevronRight, CodeXml, Database, FileCode2, FileType2, Link2, Plus, RefreshCw, Unplug, X } from '@lucide/vue'

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
  fields: Array<{ name: string; label: string; type: string; required: boolean; options?: Array<{ value: string; label: string }> }>
  siteId: string
  pageId: string
  pageTitle: string
  pagePath: string
  connection: FormConnection | null
}
interface CoreEntity { id: string; name: string; slug: string; isActive: boolean; deletedAt?: string | null }
interface CoreField {
  id: string
  name: string
  label: string
  dataType: string
  isRequired: boolean
  validationRules?: { options?: Array<{ value: string; label: string }> }
}

type EditorFile = 'html' | 'css' | 'js'
const props = defineProps<{
  siteId: string
  pageId: string
  pageTitle: string
  pagePath: string
  pageStatus: string
  pageVersion: number
  pageUpdatedAt?: string
  dirty: boolean
  activeFile: EditorFile
  sidebarWidth: number
}>()
const emit = defineEmits<{
  rescan: []
  connectionChange: [open: boolean]
  fileSelect: [file: EditorFile]
  formSelect: [formKey?: string]
  fieldSelect: [formKey: string, fieldName: string]
}>()
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const [{ data, pending, error, refresh }, { data: entityData }] = await Promise.all([
  useFetch<{ forms: DetectedForm[] }>(() => `/api/sites/${props.siteId}/forms`, { headers }),
  useFetch<{ entities: CoreEntity[] }>('/api/entities?deleted=exclude', { headers })
])
const selectedForm = ref<DetectedForm | null>(null)
const focusedField = ref('')
const selectedEntityId = ref('')
const selectedMapping = ref<Record<string, string>>({})
const selectedDefaults = ref<Record<string, DefaultValue>>({})
const selectedValueMappings = ref<Record<string, Record<string, string>>>({})
const targetFields = ref<CoreField[]>([])
const fieldsLoading = ref(false)
const saving = ref(false)
const modalError = ref('')
const toast = useToast()

const forms = computed(() => (data.value?.forms ?? []).filter(form => form.pageId === props.pageId))
const coreEntities = computed(() => (entityData.value?.entities ?? []).filter(entity => entity.isActive && !entity.deletedAt))
const mappableTargetFields = computed(() => targetFields.value.filter(field =>
  field.name !== 'id' && ['text', 'number', 'currency', 'boolean', 'date', 'select', 'multiselect'].includes(field.dataType)
))
const mappedTargetNames = computed(() => new Set(Object.values(selectedMapping.value).filter(Boolean)))
const defaultTargetFields = computed(() => mappableTargetFields.value.filter(field => !mappedTargetNames.value.has(field.name)))
const unresolvedRequiredFields = computed(() => {
  const sourceByName = new Map((selectedForm.value?.fields ?? []).map(field => [field.name, field]))
  return mappableTargetFields.value.filter(field => {
    if (!field.isRequired || hasValue(selectedDefaults.value[field.name])) return false
    const sourceName = Object.entries(selectedMapping.value).find(([, target]) => target === field.name)?.[0]
    return !sourceName || !sourceByName.get(sourceName)?.required
  })
})
const unresolvedOptionMappings = computed(() => (selectedForm.value?.fields ?? []).flatMap(field => {
  if (!field.options?.length) return []
  const target = targetFieldForSource(field.name)
  if (!target || !['select', 'multiselect'].includes(target.dataType)) return []
  return field.options.filter(option => !selectedValueMappings.value[field.name]?.[option.value])
}))
const updatedLabel = computed(() => {
  if (!props.pageUpdatedAt) return ''
  const elapsed = Math.max(0, Date.now() - new Date(props.pageUpdatedAt).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
})

function hasValue(value: DefaultValue | undefined) {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
}
function fieldOptions(field: CoreField) {
  return Array.isArray(field.validationRules?.options) ? field.validationRules!.options! : []
}
function targetFieldForSource(sourceName: string) {
  return mappableTargetFields.value.find(field => field.name === selectedMapping.value[sourceName])
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
async function loadTargetFields(entityId: string, existing: Record<string, string> = {}, defaults: Record<string, DefaultValue> = {}, mappings: Record<string, Record<string, string>> = {}) {
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
    selectedMapping.value = Object.fromEntries((selectedForm.value?.fields ?? []).flatMap(field => {
      const configured = existing[field.name]
      if (configured && available.has(configured)) return [[field.name, configured]]
      return available.has(field.name) ? [[field.name, field.name]] : []
    }))
    selectedDefaults.value = Object.fromEntries(Object.entries(defaults).filter(([name, value]) => available.has(name) && hasValue(value)))
    for (const field of selectedForm.value?.fields ?? []) initializeValueMapping(field.name, mappings[field.name] ?? {})
  } catch {
    modalError.value = 'No se pudieron cargar los campos del módulo.'
  } finally {
    fieldsLoading.value = false
  }
}
async function openConnection(form: DetectedForm) {
  selectedForm.value = form
  focusedField.value = ''
  emit('connectionChange', true)
  emit('formSelect', form.id)
  selectedEntityId.value = form.connection?.entityId ?? ''
  modalError.value = ''
  await loadTargetFields(selectedEntityId.value, form.connection?.fieldMapping, form.connection?.defaultValues, form.connection?.valueMappings)
}
async function changeEntity() {
  modalError.value = ''
  await loadTargetFields(selectedEntityId.value)
}
function closeConnection() {
  selectedForm.value = null
  focusedField.value = ''
  emit('connectionChange', false)
  emit('formSelect', undefined)
  selectedEntityId.value = ''
  selectedMapping.value = {}
  selectedDefaults.value = {}
  selectedValueMappings.value = {}
  targetFields.value = []
  modalError.value = ''
}
function focusField(fieldName: string) {
  if (!selectedForm.value) return
  focusedField.value = fieldName
  emit('fieldSelect', selectedForm.value.id, fieldName)
}
async function saveConnection() {
  const form = selectedForm.value
  if (!form || !selectedEntityId.value) return
  saving.value = true
  modalError.value = ''
  try {
    const fieldMapping = Object.fromEntries(Object.entries(selectedMapping.value).filter(([, target]) => Boolean(target)))
    const mappedTargets = new Set(Object.values(fieldMapping))
    const defaultValues = Object.fromEntries(Object.entries(selectedDefaults.value).filter(([name, value]) => !mappedTargets.has(name) && hasValue(value)))
    const valueMappings = Object.fromEntries(Object.entries(selectedValueMappings.value)
      .filter(([source]) => Boolean(fieldMapping[source]))
      .map(([source, values]) => [source, Object.fromEntries(Object.entries(values).filter(([, target]) => Boolean(target)))])
      .filter(([, values]) => Object.keys(values as Record<string, string>).length))
    await $fetch(`/api/sites/${form.siteId}/forms/connection`, { method: 'POST', body: { pageId: form.pageId, formKey: form.id, entityId: selectedEntityId.value, fieldMapping, defaultValues, valueMappings } })
    await refresh()
    toast.success('Formulario conectado', 'Los nuevos envíos llegarán al módulo seleccionado.')
    closeConnection()
  } catch (err: any) {
    modalError.value = err?.data?.statusMessage || 'No se pudo guardar la conexión.'
  } finally { saving.value = false }
}
async function removeConnection() {
  const form = selectedForm.value
  if (!form?.connection) return
  saving.value = true
  try {
    await $fetch(`/api/sites/${form.siteId}/forms/connection`, { method: 'DELETE', body: { pageId: form.pageId, formKey: form.id } })
    await refresh()
    toast.updated('Conexión eliminada', 'El formulario sigue disponible para volver a conectarlo.')
    closeConnection()
  } catch (err: any) {
    modalError.value = err?.data?.statusMessage || 'No se pudo eliminar la conexión.'
  } finally { saving.value = false }
}
async function reload() { await refresh() }
defineExpose({ reload, closeConnection })
</script>

<template>
  <div class="forms-composite" :style="{ width: `${sidebarWidth + (selectedForm ? 420 : 0)}px`, maxWidth: '760px' }">
    <aside class="forms-sidebar" :style="{ width: `${sidebarWidth}px`, flex: '0 0 auto' }">
      <div class="sidebar-section page-section">
        <div class="section-label page-label"><span>Página</span></div>
        <dl class="page-meta">
          <div><dt>Título</dt><dd>{{ pageTitle }}</dd></div>
          <div><dt>Ruta</dt><dd>{{ pagePath || '/' }}</dd></div>
          <div><dt>Estado</dt><dd><span class="draft-status" :class="{ clean: !dirty && pageStatus === 'published' }">{{ dirty ? 'Cambios sin publicar' : pageStatus === 'published' ? 'Publicada' : 'Borrador' }}</span></dd></div>
          <div><dt>Versión</dt><dd>v{{ pageVersion }}<template v-if="updatedLabel"> · {{ updatedLabel }}</template></dd></div>
        </dl>
      </div>
      <div class="sidebar-section files-section">
        <div class="section-label"><span>Archivos</span><button type="button" aria-label="Agregar archivo" title="Los archivos base se administran automáticamente"><Plus /></button></div>
        <div class="files-list">
          <button type="button" :class="{ active: activeFile === 'html' }" @click="emit('fileSelect', 'html')"><CodeXml /><span>index.html</span><i v-if="dirty" /></button>
          <button type="button" :class="{ active: activeFile === 'css' }" @click="emit('fileSelect', 'css')"><FileType2 /><span>styles.css</span></button>
          <button type="button" :class="{ active: activeFile === 'js' }" @click="emit('fileSelect', 'js')"><FileCode2 /><span>site.js</span></button>
        </div>
      </div>
      <div class="sidebar-section forms-section">
        <div class="section-label"><span>Formularios</span><b>{{ forms.length }}</b></div>
        <div v-if="pending" class="forms-state">Analizando HTML…</div>
        <div v-else-if="error" class="forms-state error">No se pudieron cargar.</div>
        <div v-else-if="forms.length" class="forms-list">
          <button v-for="item in forms" :key="item.id" type="button" class="form-item" :class="{ active: selectedForm?.id === item.id }" @click="openConnection(item)">
            <span class="form-icon"><Braces /></span>
            <span class="form-copy"><strong>{{ item.name }}</strong><small>{{ item.fields.length }} campos · {{ item.id }}</small><em :class="{ connected: item.connection }"><CheckCircle2 v-if="item.connection" /><span v-else />{{ item.connection ? item.connection.entityName : 'Sin conectar' }}</em></span>
            <ChevronRight />
          </button>
        </div>
        <div v-else class="empty-forms"><Braces /><strong>Sin formularios detectados</strong><p>Agrega <code>data-flow-form</code> al HTML y vuelve a analizar.</p></div>
        <button type="button" class="rescan-button" @click="emit('rescan')"><RefreshCw />Volver a analizar HTML</button>
      </div>
      <div class="sidebar-section assets-section"><SitesAssetLibrary :site-id="siteId" /></div>
    </aside>

    <form v-if="selectedForm" class="connection-drawer" @submit.prevent="saveConnection">
      <header><div><span>CONEXIÓN DE FORMULARIO</span><h2>{{ selectedForm.name }}</h2><p>{{ selectedForm.fields.length }} campos detectados</p></div><button type="button" aria-label="Cerrar conexión" @click="closeConnection"><X /></button></header>
      <div class="drawer-body">
        <label class="control-label">Módulo de destino<select v-model="selectedEntityId" required @change="changeEntity"><option value="" disabled>Selecciona un módulo</option><option v-for="entity in coreEntities" :key="entity.id" :value="entity.id">{{ entity.name }}</option></select></label>
        <template v-if="selectedEntityId">
          <div class="mapping-heading"><Database /><span><strong>Mapeo de campos</strong><small>Define dónde guardar cada dato.</small></span></div>
          <p v-if="fieldsLoading" class="drawer-state">Cargando campos…</p>
          <div v-else class="mapping-list">
            <div v-for="field in selectedForm.fields" :key="field.name" class="mapping-item" :class="{ focused: focusedField === field.name }" @click="focusField(field.name)">
              <label><span><strong>{{ field.label }}</strong><small>{{ field.name }}<b v-if="field.required"> · obligatorio</b></small></span><select v-model="selectedMapping[field.name]" @change="initializeValueMapping(field.name)"><option value="">No guardar</option><option v-for="target in mappableTargetFields" :key="target.id" :value="target.name">{{ target.label }}{{ target.isRequired ? ' *' : '' }}</option></select></label>
              <div v-if="needsOptionMapping(field)" class="option-map"><span>Equivalencias</span><label v-for="option in field.options" :key="option.value"><small>{{ option.label }}</small><select v-model="selectedValueMappings[field.name][option.value]"><option value="">Selecciona</option><option v-for="target in targetOptionsForSource(field.name)" :key="target.value" :value="target.value">{{ target.label }}</option></select></label></div>
            </div>
          </div>
          <div v-if="!fieldsLoading && defaultTargetFields.length" class="defaults-block"><div class="mapping-heading"><Link2 /><span><strong>Valores automáticos</strong><small>Flow los agrega aunque no estén en el formulario.</small></span></div><label v-for="field in defaultTargetFields" :key="field.name" class="default-row"><span><strong>{{ field.label }}</strong><small>{{ field.name }}<b v-if="field.isRequired"> · obligatorio</b></small></span><select v-if="field.dataType === 'select'" v-model="selectedDefaults[field.name]"><option value="">No definir</option><option v-for="option in fieldOptions(field)" :key="option.value" :value="option.value">{{ option.label }}</option></select><select v-else-if="field.dataType === 'boolean'" v-model="selectedDefaults[field.name]"><option value="">No definir</option><option :value="true">Sí</option><option :value="false">No</option></select><input v-else-if="field.dataType === 'number' || field.dataType === 'currency'" v-model.number="selectedDefaults[field.name]" type="number" placeholder="No definir"><input v-else-if="field.dataType === 'date'" v-model="selectedDefaults[field.name]" type="date"><input v-else v-model="selectedDefaults[field.name]" type="text" placeholder="No definir"></label></div>
        </template>
        <p v-if="unresolvedRequiredFields.length" class="warning">Falta completar: {{ unresolvedRequiredFields.map(field => field.label).join(', ') }}.</p>
        <p v-if="unresolvedOptionMappings.length" class="warning">Faltan {{ unresolvedOptionMappings.length }} equivalencias de opciones.</p>
        <p v-if="modalError" class="drawer-error">{{ modalError }}</p>
      </div>
      <footer><button v-if="selectedForm.connection" type="button" class="disconnect" :disabled="saving" @click="removeConnection"><Unplug />Quitar</button><span /><button type="button" class="cancel" @click="closeConnection">Cancelar</button><button class="connect" :disabled="saving || !selectedEntityId || unresolvedRequiredFields.length > 0 || unresolvedOptionMappings.length > 0">{{ saving ? 'Guardando…' : 'Guardar conexión' }}</button></footer>
    </form>
  </div>
</template>

<style scoped>
.forms-composite{display:flex;min-width:210px;max-width:720px;min-height:0;flex:0 0 auto;background:#fff}.forms-sidebar{display:flex;width:100%;min-width:0;min-height:0;flex-direction:column;overflow:auto;border-right:1px solid #dfe6ed;background:#fff;color:#33475b}.sidebar-section{padding:14px 14px;border-bottom:1px solid #e5eaf0}.page-section{padding-top:16px;padding-bottom:16px}.section-heading{display:flex;align-items:center;gap:10px}.section-heading>svg{width:17px;color:#0091ae}.section-heading span{display:flex;min-width:0;flex-direction:column}.section-heading strong{font-size:12px}.section-heading small{overflow:hidden;margin-top:2px;color:#8da1b5;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.section-label{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;color:#516f90;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.section-label b{display:grid;min-width:18px;height:18px;place-items:center;border-radius:9px;background:#eaf3f6;color:#0088a3;font-size:9px}.forms-list{display:grid;gap:6px}.form-item{display:grid;width:100%;grid-template-columns:30px minmax(0,1fr) 14px;align-items:start;gap:8px;border:1px solid transparent;border-radius:6px;padding:9px 8px;text-align:left}.form-item:hover,.form-item.active{border-color:#b8dbe2;background:#edf6f8}.form-item.active{box-shadow:inset 2px 0 #0091ae}.form-icon{display:grid;width:30px;height:30px;place-items:center;border-radius:5px;background:#eaf3f6;color:#0091ae}.form-icon svg{width:14px}.form-copy{display:flex;min-width:0;flex-direction:column}.form-copy strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.form-copy small{overflow:hidden;margin-top:2px;color:#8da1b5;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.form-copy em{display:flex;align-items:center;gap:4px;margin-top:6px;color:#b3720a;font-size:9px;font-style:normal;font-weight:700}.form-copy em>span{width:6px;height:6px;border-radius:50%;background:#d59117}.form-copy em.connected{color:#0a7a4f}.form-copy em svg{width:11px}.form-item>svg{width:13px;margin-top:8px;color:#8da1b5}.rescan-button{display:flex;width:100%;height:31px;align-items:center;justify-content:center;gap:6px;margin-top:12px;border:1px solid #cbd6e2;border-radius:4px;color:#516f90;font-size:10px;font-weight:700}.rescan-button:hover{border-color:#8cc9d4;color:#0088a3}.rescan-button svg{width:12px}.empty-forms{display:flex;align-items:center;padding:18px 8px;flex-direction:column;text-align:center}.empty-forms>svg{width:22px;color:#9cb0c2}.empty-forms strong{margin-top:7px;font-size:11px}.empty-forms p{margin-top:4px;color:#8da1b5;font-size:9px;line-height:1.4}.assets-section{margin-top:auto}.forms-state{padding:14px 4px;color:#8da1b5;font-size:10px}.forms-state.error{color:#c7391f}.connection-drawer{display:flex;width:390px;min-width:350px;min-height:0;flex:0 0 auto;flex-direction:column;border-right:1px solid #cbd6e2;background:#fff;color:#33475b;box-shadow:6px 0 16px #33475b0c}.connection-drawer>header{display:flex;min-height:84px;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #e5eaf0;padding:15px 16px}.connection-drawer header span{color:#0091ae;font-size:9px;font-weight:800;letter-spacing:.06em}.connection-drawer h2{margin:4px 0 0;font-size:15px}.connection-drawer header p{margin:2px 0 0;color:#8da1b5;font-size:10px}.connection-drawer header button{display:grid;width:28px;height:28px;place-items:center;border-radius:4px;color:#8da1b5}.connection-drawer header button:hover{background:#f2f5f7;color:#33475b}.connection-drawer header svg{width:15px}.drawer-body{display:grid;min-height:0;flex:1;align-content:start;gap:14px;overflow:auto;padding:15px}.control-label{display:grid;gap:6px;color:#516f90;font-size:10px;font-weight:800;text-transform:uppercase}.drawer-body select,.drawer-body input{width:100%;height:34px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;padding:0 9px;color:#33475b;font-size:11px;font-weight:400;outline:none;text-transform:none}.drawer-body select:focus,.drawer-body input:focus{border-color:#0091ae;box-shadow:0 0 0 1px #0091ae}.mapping-heading{display:flex;align-items:center;gap:8px}.mapping-heading>svg{width:15px;color:#0091ae}.mapping-heading span{display:flex;flex-direction:column}.mapping-heading strong{font-size:11px}.mapping-heading small{margin-top:1px;color:#8da1b5;font-size:9px}.mapping-list,.defaults-block{overflow:hidden;border:1px solid #e5eaf0;border-radius:5px}.mapping-item{border-bottom:1px solid #edf1f4}.mapping-item:last-child{border-bottom:0}.mapping-item>label,.default-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(130px,.9fr);align-items:center;gap:8px;padding:8px}.mapping-item label>span,.default-row>span{display:flex;min-width:0;flex-direction:column}.mapping-item strong,.default-row strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.mapping-item small,.default-row small{color:#8da1b5;font-size:8.5px}.mapping-item small b,.default-row small b{color:#b3720a}.mapping-item select,.default-row select,.default-row input{height:30px;font-size:10px}.option-map{display:grid;gap:6px;border-top:1px solid #edf1f4;background:#f8fafb;padding:8px 8px 10px 20px}.option-map>span{color:#516f90;font-size:8px;font-weight:800;text-transform:uppercase}.option-map label{display:grid;grid-template-columns:1fr 130px;align-items:center;gap:8px}.defaults-block>.mapping-heading{border-bottom:1px solid #e5eaf0;background:#f8fafb;padding:9px}.warning,.drawer-error{margin:0;border-radius:4px;padding:9px;color:#8a5b08;background:#fff5dc;font-size:10px;line-height:1.4}.drawer-error{color:#c7391f;background:#fbe0dd}.drawer-state{color:#8da1b5;font-size:10px}.connection-drawer>footer{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:7px;border-top:1px solid #e5eaf0;background:#f8fafb;padding:11px 12px}.connection-drawer footer button{height:32px;border-radius:4px;padding:0 10px;font-size:10px;font-weight:700}.disconnect{display:flex;align-items:center;gap:4px;color:#c7391f}.disconnect svg{width:12px}.cancel{border:1px solid #cbd6e2;background:#fff;color:#33475b}.connect{background:#ff7a59;color:#fff}.connect:disabled{opacity:.5}@media(max-width:980px){.connection-drawer{position:absolute;z-index:20;inset:0 auto 0 0;width:min(430px,100%);box-shadow:8px 0 28px #33475b2b}}@media(max-width:720px){.forms-composite{width:100%!important;max-width:none}.connection-drawer{width:100%}}
.forms-sidebar{min-width:210px}
.connection-drawer{position:absolute;z-index:25;top:0;right:0;bottom:0;left:auto;width:420px;min-width:420px;height:100%;box-shadow:-10px 0 26px #33475b24}
.drawer-body{min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:18px 18px 28px;scrollbar-width:thin;scrollbar-color:#b9c8d5 transparent}
.drawer-body::-webkit-scrollbar{width:6px}.drawer-body::-webkit-scrollbar-thumb{border-radius:6px;background:#b9c8d5}.mapping-list,.defaults-block{overflow:visible}.mapping-item>label,.default-row{grid-template-columns:minmax(0,1fr) 168px;gap:12px;padding:11px 12px}.mapping-item strong,.default-row strong{font-size:12px}.mapping-item small,.default-row small{font-size:10px}.mapping-item select,.default-row select,.default-row input{height:36px;font-size:12px}.mapping-heading strong{font-size:13px}.mapping-heading small{font-size:11px}.control-label{font-size:11px}.drawer-body select,.drawer-body input{height:38px;font-size:12px}.option-map{gap:9px;padding:11px 12px 13px 28px}.option-map>span{font-size:9px}.option-map label{grid-template-columns:minmax(0,1fr) 168px;gap:12px}.connection-drawer h2{font-size:16px}.connection-drawer header p{font-size:11px}.connection-drawer>footer{position:relative;z-index:2;padding:13px 16px}.connection-drawer footer button{height:36px;font-size:11px}
@media(max-width:980px){.connection-drawer{top:0;right:0;bottom:0;left:auto;width:min(420px,100%);min-width:0}}
.page-label{margin-bottom:14px}.page-meta{display:grid;gap:12px;margin:0}.page-meta>div{display:grid;grid-template-columns:74px minmax(0,1fr);align-items:center;gap:8px}.page-meta dt{color:#516f90;font-size:12px}.page-meta dd{overflow:hidden;margin:0;color:#33475b;font-size:12px;font-weight:700;text-align:right;text-overflow:ellipsis;white-space:nowrap}.draft-status{display:inline-flex;border-radius:999px;background:#fef0d2;padding:3px 9px;color:#b3720a;line-height:1.2}.draft-status.clean{background:#ccf1de;color:#0a7a4f}.section-label button{display:grid;width:22px;height:22px;place-items:center;border-radius:4px;color:#8da1b5}.section-label button:hover{background:#eaf3f6;color:#0091ae}.section-label button svg{width:15px}.files-section{padding-right:10px;padding-left:10px}.files-list{display:grid;gap:5px}.files-list button{position:relative;display:grid;height:38px;grid-template-columns:24px minmax(0,1fr) 8px;align-items:center;gap:7px;border-radius:5px;padding:0 9px;color:#516f90;text-align:left}.files-list button:hover{background:#f5f8fa;color:#33475b}.files-list button.active{background:#eaf3f6;color:#33475b;font-weight:700;box-shadow:inset 3px 0 #0091ae}.files-list svg{width:16px;color:#8da1b5}.files-list button.active svg{color:#0091ae}.files-list span{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:12px}.files-list i{width:7px;height:7px;border-radius:50%;background:#ff7a59}.forms-section{padding-top:16px}.forms-composite{max-width:760px}.connection-drawer{position:relative;z-index:1;top:auto;right:auto;bottom:auto;left:auto;width:420px;min-width:420px;height:100%;box-shadow:none}.connection-drawer>header{min-height:92px}.drawer-body{padding-bottom:32px}
@media(max-width:980px){.connection-drawer{position:relative;top:auto;right:auto;bottom:auto;left:auto;width:390px;min-width:390px;box-shadow:none}}
.mapping-item.focused{background:#fff7f4;box-shadow:inset 3px 0 #ff7a59}
</style>

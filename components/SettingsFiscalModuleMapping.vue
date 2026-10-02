<script setup lang="ts">
interface Entity { id: string; slug: string; name: string; fiscalConfig?: any }
interface Field { name: string; label: string; dataType: string }
const emit = defineEmits<{ dirty: [boolean] }>()
const toast = useToast()
const { data: response, pending } = await useFetch<{ entities: Entity[] }>('/api/entities', { key: 'fiscal-config-entities' })
const entities = computed(() => response.value?.entities ?? [])
const entityId = ref('')
const fields = ref<Field[]>([])
const loadingFields = ref(false)
const saving = ref(false)
const error = ref('')
const enabled = ref(false)
const role = ref<'customer' | 'supplier' | 'both'>('customer')
const mapping = reactive({ legalName: '', taxId: '', taxSystem: '', postalCode: '', cfdiUse: '', email: '' })
const selected = computed(() => entities.value.find((e) => e.id === entityId.value) ?? null)

async function loadFields() {
  const entity = selected.value
  if (!entity) return
  loadingFields.value = true
  error.value = ''
  try {
    const result = await $fetch<{ fields: Field[] }>(`/api/entities/${entity.slug}/fields`)
    fields.value = result.fields.filter((field) => field.name !== 'id' && ['text', 'email', 'select'].includes(field.dataType))
    const config = entity.fiscalConfig
    enabled.value = Boolean(config?.enabled)
    role.value = config?.role ?? 'customer'
    Object.assign(mapping, { legalName: '', taxId: '', taxSystem: '', postalCode: '', cfdiUse: '', email: '', ...(config?.fields ?? {}) })
    emit('dirty', false)
  } catch (err: any) {
    fields.value = []
    error.value = err?.data?.statusMessage || 'No se pudieron cargar los campos del módulo'
  } finally { loadingFields.value = false }
}
watch(entityId, loadFields)
function markDirty() { emit('dirty', true) }
function optionsFor(key: string) {
  return fields.value.filter((field) => key === 'email' ? ['email', 'text'].includes(field.dataType) : ['text', 'select'].includes(field.dataType))
}
async function save() {
  error.value = ''
  if (!entityId.value) return
  const required = ['legalName', 'taxId', 'taxSystem', 'postalCode'] as const
  if (enabled.value && required.some((key) => !mapping[key])) { error.value = 'Selecciona los cuatro campos fiscales obligatorios.'; return }
  saving.value = true
  try {
    await $fetch(`/api/entities/${entityId.value}`, { method: 'PUT', body: { fiscalConfig: enabled.value ? { enabled: true, role: role.value, fields: { ...mapping, ...(mapping.cfdiUse ? {} : { cfdiUse: undefined }), ...(mapping.email ? {} : { email: undefined }) } } : { enabled: false, role: role.value, fields: { legalName: mapping.legalName || 'nombre', taxId: mapping.taxId || 'rfc', taxSystem: mapping.taxSystem || 'regimen_fiscal', postalCode: mapping.postalCode || 'codigo_postal' } } } })
    emit('dirty', false)
    toast.updated('Integración fiscal guardada', `${selected.value?.name} quedó configurado como fuente fiscal.`)
    await refreshNuxtData('fiscal-config-entities')
  } catch (err: any) { error.value = err?.data?.statusMessage || 'No se pudo guardar la integración fiscal'; toast.error('No se pudo guardar', error.value) }
  finally { saving.value = false }
}
</script>

<template>
  <section class="settings-card">
    <h2>Integración fiscal de módulos</h2>
    <p>Elige qué módulo alimenta los datos del receptor sin crear un catálogo duplicado.</p>
    <div class="mt-6 grid gap-5 sm:grid-cols-2">
      <label class="settings-field sm:col-span-2">Módulo fuente
        <select v-model="entityId" class="rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-sm font-normal">
          <option value="">Selecciona un módulo</option><option v-for="entity in entities" :key="entity.id" :value="entity.id">{{ entity.name }}</option>
        </select>
      </label>
      <div v-if="pending || loadingFields" class="text-sm text-brand-text-muted">Cargando campos…</div>
      <template v-if="selected && !loadingFields">
        <label class="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input v-model="enabled" type="checkbox" @change="markDirty" /> Usar este módulo para datos fiscales</label>
        <label class="settings-field">Tipo de relación
          <select v-model="role" class="rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-sm font-normal" @change="markDirty"><option value="customer">Receptor / cliente</option><option value="supplier">Proveedor</option><option value="both">Cliente y proveedor</option></select>
        </label>
        <div class="rounded bg-brand-blue-bg p-3 text-xs text-brand-blue">Los valores se copiarán al CFDI como snapshot al emitir. Si el registro cambia después, la factura histórica no se modifica.</div>
        <template v-if="enabled">
          <label v-for="item in [{ key: 'legalName', label: 'Razón social' }, { key: 'taxId', label: 'RFC' }, { key: 'taxSystem', label: 'Régimen fiscal' }, { key: 'postalCode', label: 'Código postal' }, { key: 'cfdiUse', label: 'Uso de CFDI (opcional)' }, { key: 'email', label: 'Correo (opcional)' }]" :key="item.key" class="settings-field">
            {{ item.label }}
            <select v-model="mapping[item.key as keyof typeof mapping]" class="rounded border border-brand-border bg-brand-surface px-3 py-2.5 text-sm font-normal" @change="markDirty"><option value="">Selecciona un campo</option><option v-for="field in optionsFor(item.key)" :key="field.name" :value="field.name">{{ field.label }}</option></select>
          </label>
        </template>
      </template>
    </div>
    <p v-if="error" role="alert" class="mt-4 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ error }}</p>
    <div v-if="selected" class="mt-6 flex justify-end"><button type="button" class="settings-primary" :disabled="saving" @click="save">{{ saving ? 'Guardando…' : 'Guardar integración' }}</button></div>
  </section>
</template>

<style scoped>
input, textarea, select { color-scheme: inherit; }
</style>

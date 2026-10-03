<script setup lang="ts">
import type { EntityFieldMeta } from '~/composables/useEntityFields'

interface ModuleOption { id: string; slug: string; name: string }
interface Mapping { sourceField: string; targetField: string }
interface RelationOption {
  id: string
  name: string
  sourceEntityId: string
  targetEntityId: string
}
type UpsertConfig = Record<string, unknown> & {
  targetEntityId?: string
  mappings?: Mapping[]
  values?: Record<string, unknown>
  matchBy?: Mapping[]
  existingBehavior?: 'update_and_link' | 'link_only' | 'fail'
  relationDefinitionId?: string | null
}

const props = defineProps<{
  modelValue: Record<string, unknown>
  sourceEntityId: string
  sourceFields: EntityFieldMeta[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>()

const { data: modulesData } = await useFetch<{ entities: ModuleOption[] }>('/api/entities', {
  key: 'workflow-target-entities',
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const { data: relationsData } = await useFetch<RelationOption[]>('/api/relation-definitions', {
  key: `workflow-relations-${props.sourceEntityId}`,
  query: { entityId: props.sourceEntityId },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const targetFields = ref<EntityFieldMeta[]>([])
const loadingFields = ref(false)
const modules = computed(() => modulesData.value?.entities ?? [])
const config = computed(() => props.modelValue as UpsertConfig)
const targetModule = computed(() => modules.value.find(module => module.id === config.value.targetEntityId))
const editableTargetFields = computed(() => targetFields.value.filter(field => field.name !== 'id' && field.dataType !== 'incremental'))
const compatibleRelations = computed(() => (relationsData.value ?? []).filter(relation => {
  const targetId = config.value.targetEntityId
  return targetId && ((relation.sourceEntityId === props.sourceEntityId && relation.targetEntityId === targetId) || (relation.targetEntityId === props.sourceEntityId && relation.sourceEntityId === targetId))
}))
const mappings = computed<Mapping[]>(() => Array.isArray(config.value.mappings) ? config.value.mappings : [])
const values = computed<Record<string, unknown>>(() => config.value.values && typeof config.value.values === 'object' ? config.value.values as Record<string, unknown> : {})

function update(patch: Partial<UpsertConfig>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
async function loadTargetFields() {
  if (!targetModule.value) { targetFields.value = []; return }
  loadingFields.value = true
  try {
    const response = await $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${targetModule.value.slug}/fields`)
    targetFields.value = response.fields
  } finally { loadingFields.value = false }
}
watch(() => config.value.targetEntityId, loadTargetFields, { immediate: true })

function chooseTarget(value: string) {
  update({ targetEntityId: value, mappings: [], values: {}, matchBy: [], relationDefinitionId: null, existingBehavior: 'update_and_link' })
}
function mappedSource(targetField: string): string {
  return mappings.value.find(mapping => mapping.targetField === targetField)?.sourceField ?? ''
}
function setMapping(targetField: string, sourceField: string) {
  const next = mappings.value.filter(mapping => mapping.targetField !== targetField)
  if (sourceField) next.push({ targetField, sourceField })
  const nextValues = { ...values.value }
  if (sourceField) delete nextValues[targetField]
  const matchBy = (config.value.matchBy ?? []).filter(mapping => mapping.targetField !== targetField || sourceField)
  update({ mappings: next, values: nextValues, matchBy })
}
function setConstant(field: EntityFieldMeta, raw: string | boolean) {
  const next = { ...values.value }
  if (raw === '') delete next[field.name]
  else if (field.dataType === 'number' || field.dataType === 'currency') next[field.name] = Number(raw)
  else if (field.dataType === 'boolean') next[field.name] = Boolean(raw)
  else next[field.name] = raw
  const nextMappings = mappings.value.filter(mapping => mapping.targetField !== field.name)
  update({ values: next, mappings: nextMappings, matchBy: (config.value.matchBy ?? []).filter(mapping => mapping.targetField !== field.name) })
}
function optionValues(field: EntityFieldMeta): Array<{ value: string; label: string }> {
  return Array.isArray(field.validationRules?.options) ? field.validationRules.options as Array<{ value: string; label: string }> : []
}
function setMatchTarget(targetField: string) {
  if (!targetField) { update({ matchBy: [] }); return }
  const sourceField = mappedSource(targetField)
  update({ matchBy: sourceField ? [{ targetField, sourceField }] : [] })
}
</script>

<template>
  <div class="upsert-config">
    <p class="config-intro">Crea un registro en otro módulo o reutiliza uno existente. El registro de origen se conserva.</p>
    <label class="config-field">Módulo destino
      <select :value="config.targetEntityId ?? ''" @change="chooseTarget(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>Selecciona un módulo</option>
        <option v-for="module in modules" :key="module.id" :value="module.id" :disabled="module.id === sourceEntityId">{{ module.name }}</option>
      </select>
    </label>

    <template v-if="config.targetEntityId">
      <p v-if="loadingFields" class="config-hint">Cargando campos…</p>
      <div v-else class="mapping-box">
        <div class="mapping-heading"><div><strong>Mapeo de campos</strong><p>Asigna un dato del registro origen o un valor fijo.</p></div><span>{{ mappings.length }} vinculados</span></div>
        <div v-for="field in editableTargetFields" :key="field.id" class="mapping-row">
          <div class="target-copy"><strong>{{ field.label }}</strong><small>{{ field.name }}<b v-if="field.isRequired"> · obligatorio</b></small></div>
          <select :value="mappedSource(field.name)" @change="setMapping(field.name, ($event.target as HTMLSelectElement).value)">
            <option value="">Sin campo de origen</option>
            <option v-for="source in sourceFields.filter(item => item.name !== 'id')" :key="source.id" :value="source.name">{{ source.label }}</option>
          </select>
          <select v-if="field.dataType === 'select'" :value="String(values[field.name] ?? '')" :disabled="Boolean(mappedSource(field.name))" @change="setConstant(field, ($event.target as HTMLSelectElement).value)">
            <option value="">Sin valor fijo</option><option v-for="option in optionValues(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <select v-else-if="field.dataType === 'boolean'" :value="values[field.name] === undefined ? '' : String(values[field.name])" :disabled="Boolean(mappedSource(field.name))" @change="setConstant(field, ($event.target as HTMLSelectElement).value === '' ? '' : ($event.target as HTMLSelectElement).value === 'true')">
            <option value="">Sin valor fijo</option><option value="true">Sí</option><option value="false">No</option>
          </select>
          <input v-else :type="field.dataType === 'number' || field.dataType === 'currency' ? 'number' : 'text'" :value="String(values[field.name] ?? '')" :disabled="Boolean(mappedSource(field.name))" placeholder="Valor fijo opcional" @input="setConstant(field, ($event.target as HTMLInputElement).value)" />
        </div>
      </div>

      <label class="config-field">Detectar existentes por
        <select :value="(config.matchBy as Mapping[] | undefined)?.[0]?.targetField ?? ''" @change="setMatchTarget(($event.target as HTMLSelectElement).value)">
          <option value="">No buscar coincidencias</option>
          <option v-for="mapping in mappings" :key="mapping.targetField" :value="mapping.targetField">{{ targetFields.find(field => field.name === mapping.targetField)?.label ?? mapping.targetField }}</option>
        </select>
        <small>Solo aparecen campos que ya reciben un valor del registro origen.</small>
      </label>
      <label v-if="(config.matchBy as Mapping[] | undefined)?.length" class="config-field">Si ya existe
        <select :value="config.existingBehavior ?? 'update_and_link'" @change="update({ existingBehavior: ($event.target as HTMLSelectElement).value as UpsertConfig['existingBehavior'] })">
          <option value="update_and_link">Actualizarlo y vincularlo</option>
          <option value="link_only">Solo vincularlo</option>
          <option value="fail">Detener con error</option>
        </select>
      </label>
      <label class="config-field">Relación entre registros
        <select :value="config.relationDefinitionId ?? ''" @change="update({ relationDefinitionId: ($event.target as HTMLSelectElement).value || null })">
          <option value="">Sin relación automática</option>
          <option v-for="relation in compatibleRelations" :key="relation.id" :value="relation.id">{{ relation.name }}</option>
        </select>
        <small v-if="!compatibleRelations.length">Crea primero una relación entre ambos módulos desde Editar módulo → Relaciones.</small>
      </label>
    </template>
  </div>
</template>

<style scoped>
.upsert-config{display:flex;flex-direction:column;gap:16px}.config-intro,.config-hint{font-size:12px;line-height:1.5;color:rgb(var(--brand-text-secondary))}.config-field{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}.config-field select,.config-field input,.mapping-row select,.mapping-row input{width:100%;min-width:0;border:1px solid rgb(var(--brand-control-border));border-radius:4px;background:rgb(var(--brand-surface));padding:8px 10px;color:rgb(var(--brand-text));font-size:12px;font-weight:400}.config-field small{font-size:11px;font-weight:400;color:rgb(var(--brand-sites-muted));line-height:1.45}.mapping-box{border:1px solid rgb(var(--brand-border-light));border-radius:6px;overflow:hidden}.mapping-heading{display:flex;align-items:flex-start;justify-content:space-between;padding:12px;background:rgb(var(--brand-bg));border-bottom:1px solid rgb(var(--brand-border-light))}.mapping-heading strong{font-size:12px}.mapping-heading p{margin-top:3px;font-size:10px;color:rgb(var(--brand-sites-muted))}.mapping-heading span{border-radius:999px;background:rgb(var(--brand-blue-bg));padding:3px 7px;color:rgb(var(--brand-blue));font-size:10px;font-weight:700}.mapping-row{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(130px,1fr);gap:8px;padding:10px 12px;border-bottom:1px solid rgb(var(--brand-kanban-divider))}.mapping-row:last-child{border-bottom:0}.mapping-row>select,.mapping-row>input{grid-column:2}.target-copy{grid-row:1 / span 2;display:flex;flex-direction:column;gap:3px;min-width:0}.target-copy strong{font-size:11px;overflow:hidden;text-overflow:ellipsis}.target-copy small{font-size:9px;color:rgb(var(--brand-sites-muted));overflow:hidden;text-overflow:ellipsis}.target-copy b{color:rgb(var(--brand-warning-text))}.mapping-row :disabled{background:rgb(var(--brand-bg));color:rgb(var(--brand-sites-muted))}
</style>

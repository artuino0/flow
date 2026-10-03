<script setup lang="ts">
import { FileText, X } from '@lucide/vue'
import type { PrintReportDsl } from '~/composables/usePrintReports'
import { resolveParameterFilters, type ParameterAnswers, type ReportParameter } from '~/utils/reportParameters'
const props = defineProps<{ dsl: PrintReportDsl }>()
const emit = defineEmits<{ cancel: []; generate: [ParameterAnswers] }>()
const dialog = ref<HTMLDialogElement>()
const answers = reactive<ParameterAnswers>({})
const enabled = reactive<Record<string, boolean>>({})
const searches = reactive<Record<string, string>>({})
const options = reactive<Record<string, { value: string; label: string }[]>>({})
const pending = reactive<Record<string, boolean>>({})
const errors = reactive<Record<string, string>>({})
const more = reactive<Record<string, boolean>>({})
const error = ref('')
const revisions: Record<string, number> = {}
function searchOptions(parameter: ReportParameter, value: string) { searches[parameter.id] = value; loadOptions(parameter) }
for (const parameter of props.dsl.parameters ?? []) {
  enabled[parameter.id] = parameter.required
  answers[parameter.id] = { value: ['checkbox', 'toggle'].includes(parameter.input) ? 'false' : '', operator: parameter.input === 'text' ? 'contains' : 'eq' }
}
async function loadOptions(parameter: ReportParameter) {
  const revision = revisions[parameter.id] = (revisions[parameter.id] ?? 0) + 1
  pending[parameter.id] = true
  errors[parameter.id] = ''
  try {
    const response = await $fetch<{ options: { value: string; label: string }[]; recordId: boolean; more: boolean }>('/api/print-reports/parameter-options', { method: 'POST', body: { dsl: props.dsl, parameterId: parameter.id, search: searches[parameter.id] ?? '' } })
    if (revision !== revisions[parameter.id]) return
    options[parameter.id] = response.options
    answers[parameter.id]!.recordId = response.recordId
    more[parameter.id] = response.more
  } catch (err: any) { if (revision === revisions[parameter.id]) errors[parameter.id] = err?.data?.statusMessage ?? 'No se pudieron cargar las opciones. Intenta buscar de nuevo.' }
  finally { if (revision === revisions[parameter.id]) pending[parameter.id] = false }
}
onMounted(() => {
  dialog.value?.showModal()
  for (const parameter of props.dsl.parameters ?? []) if (parameter.input === 'select') loadOptions(parameter)
})
function generate() {
  error.value = ''
  const values = Object.fromEntries((props.dsl.parameters ?? []).filter(parameter => parameter.required || enabled[parameter.id]).map(parameter => [parameter.id, answers[parameter.id]!]))
  try {
    for (const parameter of props.dsl.parameters ?? []) if ((parameter.required || enabled[parameter.id]) && !values[parameter.id]?.value?.trim()) throw new Error(`Completa ${parameter.label} o desactiva el filtro.`)
    resolveParameterFilters(props.dsl.parameters ?? [], values)
    emit('generate', values)
  } catch (err) { error.value = (err as Error).message }
}
</script>

<template>
  <dialog ref="dialog" aria-labelledby="report-parameters-title" class="report-filter-modal" @cancel.prevent="emit('cancel')">
    <form @submit.prevent="generate">
      <header class="filter-modal-header">
        <div class="filter-modal-heading"><div><h2 id="report-parameters-title">Generar reporte</h2><p class="filter-modal-subtitle">{{ dsl.title }}</p></div><button type="button" class="filter-modal-close" aria-label="Cerrar" @click="emit('cancel')"><X :size="18" /></button></div>
        <p class="filter-helper">Elige los filtros para esta ejecución</p>
      </header>
      <div class="filter-modal-body">
        <section v-for="parameter in dsl.parameters" :key="parameter.id" class="filter-block" :class="{ 'filter-inactive': !enabled[parameter.id] && !parameter.required }" :aria-label="parameter.label">
          <div class="filter-block-title">{{ parameter.label }}<span v-if="parameter.required" class="filter-required">Obligatorio</span></div>
          <label v-if="!parameter.required" class="filter-apply"><input v-model="enabled[parameter.id]" type="checkbox" />Aplicar filtro</label>
          <fieldset :disabled="!enabled[parameter.id] && !parameter.required" class="filter-controls" :aria-label="parameter.label">
            <PrintReportFilterSelect v-if="parameter.input === 'select'" v-model="answers[parameter.id]!.value" :label="parameter.label" :options="options[parameter.id] ?? []" :pending="pending[parameter.id]" :error="errors[parameter.id]" :more="more[parameter.id]" :disabled="!enabled[parameter.id] && !parameter.required" @search="searchOptions(parameter, $event)" />
            <template v-else-if="parameter.input === 'checkbox' || parameter.input === 'toggle'">
              <label v-if="parameter.input === 'checkbox'" class="filter-boolean"><input type="checkbox" :checked="answers[parameter.id]!.value === 'true'" @change="answers[parameter.id]!.value = ($event.target as HTMLInputElement).checked ? 'true' : 'false'" />{{ !enabled[parameter.id] && !parameter.required ? 'Sin aplicar' : answers[parameter.id]!.value === 'true' ? 'Sí' : 'No' }}</label>
              <button v-else type="button" role="switch" :aria-label="parameter.label" :aria-checked="answers[parameter.id]!.value === 'true'" class="filter-switch" @click="answers[parameter.id]!.value = answers[parameter.id]!.value === 'true' ? 'false' : 'true'"><span class="filter-switch-track" :class="{ on: answers[parameter.id]!.value === 'true' }"><span /></span>{{ !enabled[parameter.id] && !parameter.required ? 'Sin aplicar' : answers[parameter.id]!.value === 'true' ? 'Sí' : 'No' }}</button>
              <p v-if="enabled[parameter.id] || parameter.required" class="filter-helper">Se buscarán registros cuyo valor sea {{ answers[parameter.id]!.value === 'true' ? 'Sí' : 'No' }}.</p>
            </template>
            <template v-else-if="parameter.input.endsWith('Range')">
              <div class="filter-range"><label>Desde<input v-model="answers[parameter.id]!.value" :aria-label="'Desde: ' + parameter.label" :type="parameter.input === 'dateRange' ? 'date' : 'number'" step="any" /></label><label>Hasta<input v-model="answers[parameter.id]!.end" :aria-label="'Hasta: ' + parameter.label" :type="parameter.input === 'dateRange' ? 'date' : 'number'" step="any" /></label></div>
              <p class="filter-helper">{{ parameter.input === 'dateRange' ? 'Incluye ambas fechas' : 'Incluye ambos extremos' }}</p>
            </template>
            <div v-else class="filter-value-row">
              <select v-model="answers[parameter.id]!.operator" :aria-label="'Comparación de ' + parameter.label"><option value="eq">Igual a</option><option v-if="parameter.input === 'text'" value="contains">Contiene</option><template v-else><option value="lt">{{ parameter.input === 'date' ? 'Antes de' : 'Menor que' }}</option><option value="gt">{{ parameter.input === 'date' ? 'Después de' : 'Mayor que' }}</option></template></select>
              <input v-model="answers[parameter.id]!.value" :aria-label="parameter.label" :type="parameter.input === 'date' ? 'date' : parameter.input === 'number' ? 'number' : 'text'" step="any" />
            </div>
          </fieldset>
          <p v-if="!enabled[parameter.id] && !parameter.required" class="filter-helper">Activa “Aplicar filtro” para usar este criterio.</p>
          <p v-if="parameter.required" class="filter-helper">No se puede desactivar: este filtro siempre se aplica.</p>
        </section>
        <p v-if="error" role="alert" class="filter-modal-error">{{ error }}</p>
      </div>
      <footer class="filter-modal-footer"><button type="button" class="filter-cancel" @click="emit('cancel')">Cancelar</button><button class="filter-generate" type="submit" :disabled="Object.values(pending).some(Boolean)"><FileText :size="16" />Generar reporte</button></footer>
    </form>
  </dialog>
</template>
<style scoped>
.report-filter-modal { width:min(600px, calc(100vw - 32px)); max-height:calc(100dvh - 32px); padding:0; border:0; border-radius:8px; background:rgb(var(--brand-surface)); color:rgb(var(--brand-text)); font-family:Inter,sans-serif; box-shadow:0 12px 36px rgb(var(--brand-modal-overlay) / 0.25098039215686274); }
.report-filter-modal::backdrop { background:rgb(var(--brand-report-backdrop) / 0.6); }
.report-filter-modal form { display:flex; flex-direction:column; max-height:calc(100dvh - 32px); }
.filter-modal-header { padding:20px 24px; border-bottom:1px solid rgb(var(--brand-border-light)); flex:none; }
.filter-modal-heading { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.filter-modal-heading h2 { font-size:18px; font-weight:700; line-height:1.4; }
.filter-modal-subtitle { margin-top:3px; color:rgb(var(--brand-text-secondary)); font-size:13px; font-weight:600; overflow-wrap:anywhere; }
.filter-modal-close { color:rgb(var(--brand-sites-muted)); padding:3px; border-radius:4px; }
.filter-modal-close:hover { background:rgb(var(--brand-bg)); color:rgb(var(--brand-text)); }
.filter-modal-header > .filter-helper { margin-top:4px; }
.filter-modal-body { min-height:0; overflow-y:auto; }
.filter-block { padding:18px 24px; display:flex; flex-direction:column; gap:10px; border-bottom:1px solid rgb(var(--brand-border-light)); }
.filter-block:last-of-type { border-bottom:0; }
.filter-block-title { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; }
.filter-required { font-size:10px; font-weight:600; color:rgb(var(--brand-text-secondary)); background:rgb(var(--brand-blue-bg)); border-radius:3px; padding:2px 6px; }
.filter-apply { display:flex; align-items:center; gap:8px; color:rgb(var(--brand-text-secondary)); font-size:13px; font-weight:600; }
.filter-controls { min-width:0; display:flex; flex-direction:column; gap:10px; }
.filter-helper { color:rgb(var(--brand-sites-muted)); font-size:12px; line-height:1.5; }
.filter-range { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
.filter-range label { display:flex; flex-direction:column; gap:6px; color:rgb(var(--brand-sites-muted)); font-size:12px; font-weight:600; }
.filter-controls input:not([type=checkbox]), .filter-controls select { min-width:0; width:100%; min-height:38px; padding:9px 12px; border:1px solid rgb(var(--brand-control-border)); border-radius:4px; background:rgb(var(--brand-surface)); color:rgb(var(--brand-text)); font-size:14px; font-weight:400; }
.filter-value-row { display:grid; grid-template-columns:150px minmax(0,1fr); gap:12px; }
.filter-value-row select { font-size:13px; }
input[type=checkbox] { width:16px; height:16px; accent-color:rgb(var(--brand-orange)); flex:none; }
.filter-boolean, .filter-switch { display:flex; align-items:center; gap:10px; font-size:14px; font-weight:600; }
.filter-switch { width:fit-content; border-radius:4px; }
.filter-switch-track { width:38px; height:22px; flex:none; border-radius:999px; background:rgb(var(--brand-control-border)); position:relative; }
.filter-switch-track span { position:absolute; left:2px; top:2px; width:18px; height:18px; background:rgb(var(--brand-switch-thumb)); border-radius:50%; transition:transform .15s ease-out; }
.filter-switch-track.on { background:rgb(var(--brand-orange)); }
.filter-switch-track.on span { transform:translateX(16px); }
.filter-inactive .filter-block-title, .filter-inactive .filter-apply, .filter-controls:disabled { color:rgb(var(--brand-sites-muted)); }
.filter-controls:disabled input, .filter-controls:disabled select { background:rgb(var(--brand-bg)); color:rgb(var(--brand-sites-muted)); cursor:not-allowed; }
.filter-controls:disabled .filter-switch-track { background:rgb(var(--brand-border-light)); }
.filter-modal-footer { flex:none; display:flex; align-items:center; justify-content:flex-end; gap:10px; padding:16px 24px; border-top:1px solid rgb(var(--brand-border-light)); }
.filter-modal-footer button { display:flex; align-items:center; gap:8px; border-radius:4px; padding:9px 12px; font-size:13px; font-weight:600; }
.filter-cancel { border:1px solid rgb(var(--brand-control-border)); color:rgb(var(--brand-text)); background:rgb(var(--brand-surface)); }
.filter-cancel:hover { background:rgb(var(--brand-bg)); }
.filter-generate { background:rgb(var(--brand-orange)); color:rgb(var(--brand-primary-fg)); border:1px solid rgb(var(--brand-orange)); }
.filter-generate:hover { background:rgb(var(--brand-orange-hover)); }
.filter-generate:disabled { opacity:.5; cursor:not-allowed; }
.filter-modal-error { margin:0 24px 18px; color:rgb(var(--brand-error-text)); font-size:12px; }
button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid rgb(var(--brand-orange)); outline-offset:2px; }
@media(max-width:480px) { .filter-modal-header,.filter-block { padding:16px; } .filter-modal-footer { padding:12px 16px; } .filter-value-row { grid-template-columns:1fr; } }
</style>

<script setup lang="ts">
// Épica ERD-46 (Reportería con IA): pantalla "Nuevo reporte" - describir un
// reporte en lenguaje natural, generar una previsualización con IA
// (POST /api/reports/preview, server/utils/reportQuery.ts) y, si el
// resultado sirve, guardarlo (POST /api/reports). Sigue las 4 pantallas
// "QWEN Screen/Nuevo reporte" del ERPDinamico.pen (i8iWmg/lXFWi/MCAZU/apJJG
// - "Reportes - Nuevo reporte" / "- Generando" / "- Previsualización" /
// "- Error", revisadas con las herramientas de Pencil antes de este
// cambio): mismas 4 pantallas = 4 estados de esta única página
// (idle/generating/preview/error), sin ruteo entre ellas.
//
// Decisión deliberada (mismo criterio que el ícono "calendar" sin sentido en
// Automatización, ver pages/triggers/[id]/editar.vue): el Header Row del
// mock trae también un switch on/off y botones "Cancelar"/"Guardar cambios"
// junto al título - se repiten IDÉNTICOS en las 4 pantallas (incluida la de
// error, donde "guardar cambios" no tendría nada que guardar todavía). Se
// interpretan como el mismo chrome de encabezado de "editor de entidad
// existente" (Editar Módulo/Editar Automatización) copiado como plantilla,
// no como una intención de diseño real para un flujo de "generar y guardar
// una vez" - por eso NO se replican. Las acciones reales de este flujo son
// las que sí cambian entre pantallas: "Generar previsualización" (Form
// Card) y "Descartar"/"Guardar reporte" (Preview Card).
//
// La tabla de "Vista previa" muestra las columns/rows reales que ya devolvió
// executeReportQuery() (esquema OLAP del tenant) - no hay concepto de "datos
// de muestra" falsos en el backend real. Se mantiene igual la etiqueta "de
// muestra" del mock porque el sentido sigue siendo válido (es una vista
// previa acotada antes de decidir guardar) y se limita el render a los
// primeros 10 registros con el mismo texto "Mostrando X de Y" del mock -
// evita una tabla arbitrariamente larga sin inventar un límite que no está
// en el DSL (measures/groupBy no tienen paginación propia).
import { ChevronRight, CircleAlert, LoaderCircle, Save, Sparkles, SlidersHorizontal } from '@lucide/vue'
import type { ReportQueryDsl, ReportResult } from '~/server/utils/reportQuery'

definePageMeta({ layout: 'default' })

type Step = 'idle' | 'generating' | 'preview' | 'error'
const step = ref<Step>('idle')

const description = ref('')
const errorMessage = ref('')
const queryDsl = ref<ReportQueryDsl | null>(null)
const result = ref<ReportResult | null>(null)

const PREVIEW_ROW_LIMIT = 10
const previewRows = computed(() => result.value?.rows.slice(0, PREVIEW_ROW_LIMIT) ?? [])

const toast = useToast()

async function onGenerate() {
  if (!description.value.trim()) return
  step.value = 'generating'
  errorMessage.value = ''
  try {
    const data = await $fetch<{ queryDsl: ReportQueryDsl; result: ReportResult }>('/api/reports/preview', {
      method: 'POST',
      body: { description: description.value }
    })
    queryDsl.value = data.queryDsl
    result.value = data.result
    step.value = 'preview'
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || 'Revisa la descripción y prueba de nuevo. Si el problema sigue, simplifica la consulta o usa otros términos.'
    step.value = 'error'
  }
}

// "Descartar" (Preview Card) - descarta SOLO la previsualización, la
// descripción se mantiene para poder ajustarla y volver a generar (fiel al
// mock: el textarea conserva el mismo texto en las 4 pantallas).
function onDiscard() {
  queryDsl.value = null
  result.value = null
  step.value = 'idle'
}

const saving = ref(false)
async function onSave() {
  if (!queryDsl.value || !result.value) return
  saving.value = true
  try {
    await $fetch('/api/reports', {
      method: 'POST',
      body: { description: description.value, queryDsl: queryDsl.value, resultSnapshot: result.value }
    })
    toast.success('Reporte guardado', `"${queryDsl.value.title}" se guardó correctamente.`)
    description.value = ''
    queryDsl.value = null
    result.value = null
    step.value = 'idle'
  } catch (err: any) {
    toast.error('No se pudo guardar el reporte', err?.data?.statusMessage || 'Intenta de nuevo.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <span class="text-brand-text-secondary">Reportes</span>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <span class="font-bold text-brand-text">Nuevo reporte</span>
    </div>

    <div class="flex items-center gap-3">
      <div class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded bg-brand-blue-bg">
        <Sparkles class="h-[18px] w-[18px] text-brand-blue" :stroke-width="1.75" />
      </div>
      <div class="flex flex-col gap-0.5">
        <h1 class="text-[22px] font-bold text-brand-text">Nuevo reporte</h1>
        <p class="text-sm text-brand-text-secondary">Describe en lenguaje natural el reporte que necesitas y previsualízalo antes de guardarlo</p>
      </div>
    </div>

    <div class="flex max-w-[900px] flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
      <div class="border-b border-brand-border-light p-5">
        <h2 class="text-[16px] font-bold text-brand-text">Descripción del reporte</h2>
      </div>
      <div class="flex flex-col gap-2 p-5">
        <textarea
          v-model="description"
          rows="3"
          placeholder="Ej: Clientes con más de 3 pedidos en los últimos 30 días, agrupados por sucursal"
          class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-text-muted focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          :disabled="step === 'generating'"
        />
        <p class="text-xs text-brand-text-muted">La IA interpreta tu descripción y arma el reporte por ti. No necesitas saber SQL.</p>
      </div>
      <div class="flex items-center justify-between border-t border-brand-border-light p-5">
        <button
          type="button"
          :disabled="step === 'generating' || !description.trim()"
          class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onGenerate"
        >
          <Sparkles v-if="step !== 'generating'" class="h-4 w-4" :stroke-width="1.75" />
          <LoaderCircle v-else class="h-4 w-4 animate-spin" :stroke-width="1.75" />
          Generar previsualización
        </button>
        <p v-if="step === 'generating'" class="flex items-center gap-1.5 text-sm text-brand-text-muted">
          <LoaderCircle class="h-4 w-4 animate-spin" :stroke-width="1.75" />
          Generando reporte...
        </p>
      </div>
    </div>

    <div v-if="step === 'error'" class="flex max-w-[900px] items-start gap-3 rounded-lg border border-brand-error-text bg-brand-error-bg p-5">
      <CircleAlert class="h-5 w-5 shrink-0 text-brand-error-text" :stroke-width="1.75" />
      <div class="flex flex-col gap-1">
        <p class="text-sm font-bold text-brand-error-text">No se pudo generar el reporte</p>
        <p class="text-[13px] text-brand-error-text">{{ errorMessage }}</p>
      </div>
    </div>

    <div v-else-if="step === 'preview' && result && queryDsl" class="flex max-w-[900px] flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
      <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
        <div class="flex items-center justify-between">
          <h2 class="text-[16px] font-bold text-brand-text">Vista previa</h2>
          <span class="rounded-full bg-brand-neutral-bg px-2.5 py-1 text-xs font-semibold text-brand-neutral-text">Datos de muestra · {{ result.rows.length }} registro{{ result.rows.length === 1 ? '' : 's' }}</span>
        </div>
        <p class="text-xs text-brand-text-muted">{{ queryDsl.title }}</p>
      </div>
      <div class="flex flex-col gap-2 p-5">
        <div v-if="result.rows.length === 0" class="text-sm text-brand-text-muted">La consulta no encontró datos para esa descripción todavía.</div>
        <div v-else class="overflow-x-auto rounded border border-brand-border-light">
          <table class="min-w-full text-sm">
            <thead class="border-b border-brand-border-light bg-brand-bg">
              <tr>
                <th v-for="col in result.columns" :key="col.key" class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-brand-border-light">
              <tr v-for="(row, index) in previewRows" :key="index">
                <td v-for="col in result.columns" :key="col.key" class="px-4 py-3" :class="col.key === 'label' ? 'font-semibold text-brand-text' : 'text-brand-text-secondary'">{{ row[col.key] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="result.rows.length > 0" class="text-xs text-brand-text-muted">Mostrando {{ previewRows.length }} de {{ result.rows.length }} registros de la muestra</p>
      </div>
      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button type="button" class="flex items-center gap-1.5 rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="onDiscard">
          <SlidersHorizontal class="h-4 w-4" :stroke-width="1.75" />
          Descartar
        </button>
        <button
          type="button"
          :disabled="saving"
          class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onSave"
        >
          <Save class="h-4 w-4" :stroke-width="1.75" />
          {{ saving ? 'Guardando...' : 'Guardar reporte' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_LABEL_CONFIG, resolveLabelConfig, code128Svg, type LabelConfig } from '~/utils/labelTemplates'
import type { EntityFieldMeta } from '~/composables/useEntityFields'

definePageMeta({ layout: false })

const route = useRoute()
const slug = route.params.entity as string
const ids = String(route.query.ids ?? '').split(',').map(value => value.trim()).filter(Boolean)

const { data: meta, pending: metaPending, error: metaError } = await useFetch<{
  entity: { name: string; labelConfig?: LabelConfig | null }
  fields: EntityFieldMeta[]
}>(`/api/entities/${slug}/fields`, { headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })
const { data: branding, pending: brandingPending } = await useFetch<{ hasLogo: boolean }>('/api/tenant/branding', { headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })

const { data: records, pending: recordsPending, error: recordsError } = await useFetch<{ data: Array<{ id: string; customData: Record<string, unknown> }> }>(`/api/records/${slug}`, {
  query: { page: 1, pageSize: 100 },
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const config = computed(() => resolveLabelConfig(meta.value?.entity?.labelConfig ?? DEFAULT_LABEL_CONFIG))
const logoUrl = '/api/tenant/logo'
const fields = computed(() => meta.value?.fields ?? [])
const rows = computed(() => {
  const all = records.value?.data ?? []
  const selected = ids.length ? all.filter(row => ids.includes(row.id)) : all
  return selected.flatMap(row => Array.from({ length: config.value.copies }, () => row))
})
const fieldLabel = (name: string | null) => name ? fields.value.find(field => field.name === name)?.label ?? name : ''
const valueFor = (row: { id: string; customData: Record<string, unknown> }, name: string | null) => name ? String(row.customData?.[name] ?? '') : ''
const titleFor = (row: { id: string; customData: Record<string, unknown> }) => valueFor(row, config.value.titleField) || row.id.slice(0, 8).toUpperCase()
const barcodeFor = (row: { id: string; customData: Record<string, unknown> }) => valueFor(row, config.value.barcodeField) || row.id
const printStyle = computed(() => ({ '--label-width': `${config.value.widthMm}mm`, '--label-height': `${config.value.heightMm}mm` }))

onMounted(() => {
  if (config.value.enabled && rows.value.length) window.setTimeout(triggerPrint, 450)
})
function triggerPrint() { if (import.meta.client) window.print() }
</script>

<template>
  <main class="print-root" :style="printStyle">
    <div v-if="metaPending || recordsPending || brandingPending" class="screen-state">Preparando etiquetas…</div>
    <div v-else-if="metaError || recordsError" class="screen-state error">No se pudieron cargar las etiquetas.</div>
    <div v-else-if="!config.enabled" class="screen-state"><strong>Las etiquetas están desactivadas.</strong><a :href="`/registros/${slug}`">Volver al módulo</a></div>
    <div v-else-if="!rows.length" class="screen-state"><strong>No hay registros para imprimir.</strong><a :href="`/registros/${slug}`">Volver al módulo</a></div>
    <template v-else>
      <div class="print-toolbar"><strong>{{ meta?.entity.name }} · Etiquetas</strong><button type="button" @click="triggerPrint">Imprimir</button><a :href="`/registros/${slug}`">Cerrar</a></div>
      <article v-for="row in rows" :key="row.id" class="label-page">
        <div class="label-content">
          <div class="label-main" :class="{ 'with-logo': config.showLogo && branding?.hasLogo }">
            <img v-if="config.showLogo && branding?.hasLogo" :src="logoUrl" alt="" class="label-logo" />
            <div class="label-copy">
              <strong class="label-title">{{ titleFor(row) }}</strong>
              <span v-if="config.subtitleField" class="label-subtitle">{{ valueFor(row, config.subtitleField) }}</span>
              <div v-if="config.detailFields.length" class="label-details"><span v-for="field in config.detailFields" :key="field">{{ fieldLabel(field) }}: {{ valueFor(row, field) }}</span></div>
            </div>
          </div>
          <div v-if="config.barcodeField" class="barcode" v-html="code128Svg(barcodeFor(row), 36)" />
          <div v-if="config.barcodeField" class="barcode-value">{{ barcodeFor(row) }}</div>
        </div>
      </article>
    </template>
  </main>
</template>

<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#eef3f6;color:#183651;font-family:Arial,sans-serif}.print-root{min-height:100vh}.print-toolbar{display:flex;align-items:center;gap:14px;padding:18px 22px;background:#fff;border-bottom:1px solid #dbe4ec;font-size:14px}.print-toolbar strong{margin-right:auto}.print-toolbar button,.print-toolbar a{border:1px solid #cbd9e5;border-radius:5px;background:#fff;padding:8px 13px;color:#38536e;font-size:12px;text-decoration:none;cursor:pointer}.print-toolbar button{background:#ff765b;border-color:#ff765b;color:#fff;font-weight:700}.label-page{display:flex;align-items:center;justify-content:center;width:var(--label-width);height:var(--label-height);margin:26px auto;background:#fff;border:1px solid #b9c9d5;overflow:hidden}.label-content{display:flex;flex-direction:column;justify-content:center;width:100%;height:100%;padding:5mm;color:#183651;overflow:hidden}.label-main{display:flex;align-items:center;gap:3mm;min-width:0}.label-main.with-logo{align-items:flex-start}.label-logo{display:block;flex:0 0 34mm;width:34mm;max-width:34mm;max-height:10mm;object-fit:contain;object-position:left center}.label-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:1mm}.label-title{font-size:18px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label-subtitle{color:#597692;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label-details{display:flex;flex-wrap:wrap;gap:1mm 3mm;color:#597692;font-size:9px}.barcode{height:12mm;margin-top:3mm;color:#183651}.barcode svg{display:block;width:100%;height:100%}.barcode-value{text-align:center;margin-top:1mm;font-size:8px;letter-spacing:.08em;color:#597692}.screen-state{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;min-height:100vh;color:#597692;font-size:14px}.screen-state a{color:#007f99;text-decoration:underline}.screen-state.error{color:#b4463e}@media print{html,body{background:#fff}.print-toolbar{display:none}.label-page{margin:0;width:var(--label-width);height:var(--label-height);border:0;break-after:page;page-break-after:always}.label-page:last-of-type{break-after:auto;page-break-after:auto}@page{size:var(--label-width) var(--label-height);margin:0}}
.label-copy{gap:.5mm}.label-title{line-height:1.05}.label-subtitle{line-height:1.1}.label-details{gap:.5mm 3mm;line-height:1.1}
</style>

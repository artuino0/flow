<script setup lang="ts">
import { ArrowLeft, Printer } from '@lucide/vue'
import { onMounted, nextTick, ref } from 'vue'
import { EXPORTACION, FORMAS_PAGO, REGIMENES_FISCALES, TIPO_CFDI_LABEL, USOS_CFDI, catalogoLabel, formatoDinero, formatoFechaHora } from '~/utils/cfdiCatalogos'

definePageMeta({ layout: false })

const route = useRoute()
const id = String(route.params.id)

interface Detalle {
  documento: Record<string, any>
  serie: { serie: string }
  conceptos: Array<Record<string, any>>
  pagos: Array<Record<string, any>>
  relacionado: Record<string, any> | null
  relaciones: Array<Record<string, any>>
}

const { data: detail, pending, error } = await useFetch<Detalle>(`/api/facturacion/documents/${id}`, { key: `factura-print-${id}` })
const { data: branding, pending: brandingPending } = await useFetch<{ name: string; fiscalData: Record<string, unknown>; hasLogo: boolean; email: string | null; phone: string | null }>('/api/tenant/branding', {
  key: `factura-print-branding-${id}`,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const doc = computed(() => detail.value?.documento ?? null)
const fiscalData = computed(() => branding.value?.fiscalData ?? {})
const empresa = computed(() => branding.value?.name || doc.value?.emisorNombre || 'Organización')
// Los datos legales timbrados son la copia inmutable de Ajustes al emitir.
// La configuración vigente solo completa borradores o campos aún sin timbrar.
const razonSocial = computed(() => String(doc.value?.emisorNombre || fiscalData.value.razonSocial || empresa.value))
const rfcEmisor = computed(() => String(doc.value?.emisorRfc || fiscalData.value.rfc || ''))
const cpEmisor = computed(() => String(doc.value?.emisorCodigoPostal || fiscalData.value.codigoPostal || ''))
const domicilioEmisor = computed(() => [
  fiscalData.value.calle,
  fiscalData.value.numeroExterior,
  fiscalData.value.numeroInterior ? `Int. ${fiscalData.value.numeroInterior}` : null,
  fiscalData.value.colonia,
  fiscalData.value.municipio,
  fiscalData.value.estado,
  cpEmisor.value ? `C.P. ${cpEmisor.value}` : null,
  fiscalData.value.pais || 'México'
].filter(Boolean).join(', '))
const logoUrl = computed(() => branding.value?.hasLogo ? '/api/tenant/logo' : '')
const monograma = computed(() => empresa.value.split(/\s+/).filter(Boolean).slice(0, 3).map((word: string) => word[0]).join('').toUpperCase() || 'F')
const stamp = ref({ selloCfd: '', selloSat: '', noCertificado: '', noCertificadoSat: '', fechaTimbrado: '' })
const qrDataUrl = ref('')
const printReady = computed(() => !doc.value?.hasXml || Boolean(qrDataUrl.value))
const folio = computed(() => {
  if (!doc.value || !detail.value) return '—'
  return doc.value.folio != null ? `${detail.value.serie.serie}-${String(doc.value.folio).padStart(6, '0')}` : `${detail.value.serie.serie}-borrador`
})
const esPruebas = computed(() => folio.value.startsWith('TEST') || doc.value?.ambiente === 'test')
const tituloTipo = computed(() => TIPO_CFDI_LABEL[doc.value?.tipo] || 'Comprobante fiscal')

function valorFecha(value: unknown) {
  return value ? formatoFechaHora(value as string | Date) : '—'
}

function imprimir() {
  if (import.meta.client && printReady.value) window.print()
}

async function loadStamp() {
  if (!doc.value?.hasXml) return
  try {
    const response = await fetch(`/api/facturacion/documents/${id}/xml`, { credentials: 'same-origin' })
    if (!response.ok) return
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
    if (xml.querySelector('parsererror')) return
    const comprobante = xml.documentElement
    const timbre = xml.getElementsByTagNameNS('*', 'TimbreFiscalDigital')[0]
    const emisor = xml.getElementsByTagNameNS('*', 'Emisor')[0]
    const receptor = xml.getElementsByTagNameNS('*', 'Receptor')[0]
    if (!timbre) return
    stamp.value = {
      selloCfd: timbre.getAttribute('SelloCFD') || comprobante.getAttribute('Sello') || '',
      selloSat: timbre.getAttribute('SelloSAT') || '',
      noCertificado: comprobante.getAttribute('NoCertificado') || '',
      noCertificadoSat: timbre.getAttribute('NoCertificadoSAT') || '',
      fechaTimbrado: timbre.getAttribute('FechaTimbrado') || ''
    }
    const uuid = timbre.getAttribute('UUID')
    const rfcE = emisor?.getAttribute('Rfc')
    const rfcR = receptor?.getAttribute('Rfc')
    const total = comprobante.getAttribute('Total')
    if (uuid && rfcE && rfcR && total && /^\d+(?:\.\d+)?$/.test(total) && stamp.value.selloCfd.length >= 8) {
      const { toDataURL } = await import('qrcode')
      const [integer, decimals = ''] = total.split('.')
      const query = new URLSearchParams({ id: uuid, re: rfcE, rr: rfcR, tt: `${integer}.${decimals.padEnd(6, '0').slice(0, 6)}`, fe: stamp.value.selloCfd.slice(-8) })
      qrDataUrl.value = await toDataURL(`https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?${query}`, { width: 220, margin: 0, errorCorrectionLevel: 'M' })
    }
  } catch {
    // Un XML no disponible nunca debe convertirse en un sello o QR ficticio.
  }
}

onMounted(async () => {
  await loadStamp()
  await nextTick()
  await document.fonts.ready
  if (!route.query.preview && !error.value && doc.value && !pending.value && !brandingPending.value && printReady.value) imprimir()
})

</script>

<template>
  <div v-if="pending" class="print-loading">Cargando factura…</div>
  <div v-else-if="error || !detail || !doc" class="print-error">No se pudo cargar la factura.</div>
  <div v-else class="print-shell">
    <div class="print-toolbar no-print">
      <NuxtLink :to="`/facturacion/${id}`"><ArrowLeft class="h-4 w-4" />Volver al detalle</NuxtLink>
      <button type="button" :disabled="!printReady" @click="imprimir"><Printer class="h-4 w-4" />Imprimir / Guardar PDF</button>
    </div>

    <article class="invoice-paper">
      <div v-if="esPruebas" class="test-ribbon">Documento generado en ambiente de pruebas; sin validez fiscal</div>
      <header class="paper-header">
        <div class="issuer-block">
          <div class="logo-row">
            <div class="brand-mark"><img v-if="logoUrl" :src="logoUrl" alt="" /><span v-else>{{ monograma }}</span></div>
            <div><strong class="app-name">Flow</strong><strong class="company-name">{{ empresa }}</strong></div>
          </div>
          <div class="issuer-copy">
            <strong>{{ razonSocial }}</strong>
            <span v-if="rfcEmisor">RFC: {{ rfcEmisor }}</span>
            <span v-if="domicilioEmisor">{{ domicilioEmisor }}</span>
          </div>
        </div>
        <div class="document-card">
          <span>{{ tituloTipo }}</span>
          <strong>{{ folio }}</strong>
          <div class="document-meta"><div><label>Fecha de emisión</label><b>{{ valorFecha(doc.fechaEmision || doc.createdAt) }}</b></div><div><label>UUID fiscal</label><b class="mono">{{ doc.uuidFiscal || '—' }}</b></div><div><label>Estado</label><em :class="`print-status-${doc.estado}`">{{ doc.estado === 'cancelada' ? 'CANCELADA' : doc.estado === 'timbrada' ? 'TIMBRADA' : String(doc.estado || '').toUpperCase() }}</em></div></div>
        </div>
      </header>
      <div v-if="doc.estado === 'error' && doc.mensajePac" class="print-alert print-alert-error"><strong>No se pudo timbrar</strong><span>{{ doc.mensajePac }}</span></div>
      <div v-else-if="doc.estado === 'cancelada'" class="print-alert print-alert-cancelled"><strong>Comprobante cancelado ante el SAT</strong><span>{{ doc.fechaCancelacion ? `Cancelado el ${valorFecha(doc.fechaCancelacion)}` : 'Sin efectos fiscales' }}</span></div>
      <div v-if="doc.hasXml && !printReady" class="print-alert print-alert-error no-print">No se pudo preparar el QR desde el XML timbrado. Descarga el PDF oficial del PAC desde el detalle de la factura.</div>

      <section class="receptor-section"><h2>Datos del receptor</h2><div class="recipient-grid"><div class="recipient-column"><div><label>Razón social</label><strong>{{ doc.receptorNombre || '—' }}</strong></div><div><label>RFC</label><strong>{{ doc.receptorRfc || '—' }}</strong></div><div><label>Régimen fiscal</label><strong>{{ catalogoLabel(REGIMENES_FISCALES, doc.receptorRegimenFiscal) }}</strong></div></div><div class="recipient-column"><div><label>Código postal</label><strong>{{ doc.receptorCodigoPostal || '—' }}</strong></div><div><label>Uso de CFDI</label><strong>{{ catalogoLabel(USOS_CFDI, doc.usoCfdi) }}</strong></div><div><label>Correo electrónico</label><strong>{{ doc.receptorCorreo || '—' }}</strong></div></div></div></section>

      <section v-if="detail.relacionado" class="relation-banner"><strong>CFDI relacionado:</strong> {{ detail.relacionado.folio != null ? `${detail.relacionado.folio}` : 'Borrador' }} · {{ detail.relacionado.receptorNombre }} <span>({{ doc.tipoRelacion || '01' }})</span></section>

      <section v-if="doc.tipo !== 'P'" class="concepts-section"><table><thead><tr><th>Clave SAT</th><th>Descripción</th><th>Unidad</th><th>Cant.</th><th>P. unitario</th><th>Descuento</th><th>Importe</th></tr></thead><tbody><tr v-for="concepto in detail.conceptos" :key="concepto.orden"><td class="mono">{{ concepto.claveProdServ || '—' }}</td><td>{{ concepto.descripcion || '—' }}</td><td>{{ concepto.claveUnidad || '—' }}</td><td>{{ concepto.cantidad ?? '—' }}</td><td class="amount">{{ formatoDinero(concepto.valorUnitario, doc.moneda) }}</td><td class="amount">{{ formatoDinero(concepto.descuento || 0, doc.moneda) }}</td><td class="amount strong">{{ formatoDinero(concepto.importe, doc.moneda) }}</td></tr></tbody></table></section>

      <section v-if="doc.tipo === 'P' && detail.pagos.length" class="concepts-section"><h2>Documentos relacionados con el pago</h2><table><thead><tr><th>UUID</th><th>Serie/Folio</th><th>Moneda</th><th>Parcialidad</th><th>Saldo anterior</th><th>Importe pagado</th><th>Saldo insoluto</th></tr></thead><tbody><tr v-for="pago in detail.pagos" :key="pago.id"><td class="mono">{{ pago.uuidFiscal || pago.relacionado?.uuidFiscal || '—' }}</td><td>{{ pago.relacionado?.folio || '—' }}</td><td>{{ pago.monedaDr || doc.moneda }}</td><td>{{ pago.numParcialidad || '—' }}</td><td class="amount">{{ formatoDinero(pago.impSaldoAnt, pago.monedaDr) }}</td><td class="amount">{{ formatoDinero(pago.impPagado, pago.monedaDr) }}</td><td class="amount">{{ formatoDinero(pago.impSaldoIns, pago.monedaDr) }}</td></tr></tbody></table></section>

      <section class="totals-section"><div class="totals"><div><span>Subtotal</span><strong>{{ formatoDinero(doc.subtotal, doc.moneda) }}</strong></div><div><span>Descuento</span><strong>−{{ formatoDinero(doc.descuento, doc.moneda) }}</strong></div><div v-for="(impuesto, index) in (doc.impuestos?.traslados ?? [])" :key="`traslado-${index}`"><span>Impuestos trasladados<span v-if="impuesto.tasaOCuota"> (IVA {{ (Number(impuesto.tasaOCuota) * 100).toFixed(0) }}%)</span></span><strong>{{ formatoDinero(impuesto.importe, doc.moneda) }}</strong></div><div v-for="(retencion, index) in (doc.impuestos?.retenciones ?? [])" :key="`retencion-${index}`"><span>Retenciones</span><strong>−{{ formatoDinero(retencion.importe, doc.moneda) }}</strong></div><div class="grand-total"><span>Total ({{ doc.moneda }})</span><strong>{{ formatoDinero(doc.total, doc.moneda) }}</strong></div></div></section>

      <section class="payment-section"><h2>Información de pago</h2><div class="payment-grid"><div><label>Forma de pago</label><strong>{{ doc.formaPago ? catalogoLabel(FORMAS_PAGO, doc.formaPago) : '—' }}</strong></div><div><label>Método de pago</label><strong>{{ doc.metodoPago === 'PUE' ? 'Pago en una sola exhibición (PUE)' : doc.metodoPago === 'PPD' ? 'Pago en parcialidades o diferido (PPD)' : doc.metodoPago || '—' }}</strong></div><div><label>Moneda</label><strong>{{ doc.moneda === 'MXN' ? 'Peso mexicano (MXN)' : doc.moneda || '—' }}</strong></div><div><label>Condiciones de pago</label><strong>{{ doc.condicionesPago || '—' }}</strong></div><div><label>Exportación</label><strong>{{ catalogoLabel(EXPORTACION, doc.exportacion) }}</strong></div></div></section>

      <section v-if="doc.hasXml" class="legal-section"><div class="certificates"><div><label>Sello digital del CFDI</label><span>{{ stamp.selloCfd || '—' }}</span></div><div><label>Sello del SAT</label><span>{{ stamp.selloSat || '—' }}</span></div><div><label>Certificado del emisor</label><span>{{ stamp.noCertificado || '—' }}</span></div><div><label>Certificado del SAT</label><span>{{ stamp.noCertificadoSat || '—' }}</span></div><div><label>Fecha y hora de certificación</label><span>{{ stamp.fechaTimbrado ? valorFecha(stamp.fechaTimbrado) : valorFecha(doc.fechaTimbrado) }}</span></div></div><div v-if="qrDataUrl" class="qr-column"><img :src="qrDataUrl" alt="Código QR para verificar el CFDI en el SAT" /><p>Verifica este comprobante<br />en el portal del SAT</p></div></section>

      <div v-if="doc.estado === 'cancelada'" class="cancelled-watermark">CANCELADA</div>
      <footer class="paper-footer"><span>{{ doc.hasXml ? 'Este documento es una representación impresa de un CFDI.' : 'Vista preliminar. Este documento no tiene validez fiscal.' }}</span><span>Página 1 de 1 <b>Generado con Flow</b></span></footer>
    </article>
  </div>
</template>

<style>
@page { size: letter; margin: 0; }
.print-shell, .print-shell * { box-sizing: border-box; }
.print-shell { min-height: 100vh; padding: 18px 0 36px; background: #f5f8fa; color: #33475b; font-family: Inter, Arial, sans-serif; }
.print-toolbar { display: flex; justify-content: space-between; width: 816px; margin: 0 auto 14px; }
.print-toolbar a, .print-toolbar button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #cbd6e2; border-radius: 4px; background: #fff; padding: 8px 11px; color: #33475b; font: 600 12px Inter, Arial, sans-serif; text-decoration: none; cursor: pointer; }
.print-toolbar button { border-color: #ff7a59; background: #ff7a59; color: #fff; }
.print-toolbar button:disabled { opacity: .55; cursor: not-allowed; }
.invoice-paper { display: flex; flex-direction: column; width: 816px; min-height: 1056px; margin: 0 auto; padding: 36px 42px 26px; background: #fff; box-shadow: 0 2px 14px #33475b20; font-size: 10px; line-height: 1.35; }
.test-ribbon { margin: -18px -24px 18px; border: 1px solid #f1dfb4; border-radius: 4px; background: #fef0d2; padding: 8px 12px; color: #b3720a; font-size: 10px; font-weight: 700; text-align: center; }
.paper-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
.issuer-block { width: 380px; min-width: 0; }
.logo-row { display: flex; align-items: center; gap: 10px; }
.brand-mark { display: grid; place-items: center; flex: none; width: 36px; height: 36px; overflow: hidden; border-radius: 4px; background: #eaf3f6; color: #0091ae; font-size: 14px; font-weight: 800; }
.brand-mark img { width: 100%; height: 100%; object-fit: contain; }
.app-name { display: block; color: #33475b; font-size: 14px; line-height: 1.15; }
.company-name { display: block; margin-top: 2px; color: #33475b; font-size: 12px; font-weight: 700; }
.issuer-copy { display: grid; gap: 4px; max-width: 340px; margin-top: 12px; color: #516f90; font-size: 10px; }
.issuer-copy strong { color: #516f90; font-weight: 600; }
.document-card { flex: none; width: 280px; border-radius: 6px; background: #eaf3f6; padding: 14px 16px; }
.document-card > span { display: block; color: #0091ae; font-size: 11px; font-weight: 700; text-transform: uppercase; }
.document-card > strong { display: block; margin-top: 4px; color: #33475b; font-size: 19px; }
.document-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; margin-top: 13px; }
.document-meta > div:nth-child(2) { grid-column: 2; grid-row: 1 / 3; }
.document-meta label { display: block; color: #516f90; font-size: 9px; }
.document-meta b { display: block; margin-top: 3px; color: #33475b; font-size: 10px; font-weight: 600; overflow-wrap: anywhere; }
.document-meta em { display: inline-block; margin-top: 3px; border-radius: 999px; background: #ccf1de; padding: 4px 8px; color: #0a7a4f; font-size: 9px; font-style: normal; font-weight: 800; }
.document-meta em.print-status-borrador { background: #eaf0f6; color: #516f90; }
.document-meta em.print-status-error { background: #fbe0dd; color: #c7391f; }
.document-meta em.print-status-timbrando { background: #e5f5f8; color: #0091ae; }
.document-meta em.print-status-cancelada { background: #eaf0f6; color: #516f90; }
.print-alert { display: grid; gap: 4px; margin-top: 12px; border-radius: 4px; padding: 9px 12px; }
.print-alert-error { background: #fbe0dd; color: #c7391f; }
.print-alert-cancelled { background: #eaf0f6; color: #516f90; }
.receptor-section { margin-top: 22px; }
.receptor-section h2, .payment-section h2 { margin: 0 0 8px; color: #33475b; font-size: 12px; font-weight: 700; }
.recipient-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; border: 1px solid #e5eaf0; border-radius: 6px; background: #fafbfc; padding: 14px; }
.recipient-column { display: grid; align-content: start; gap: 12px; }
.recipient-grid label, .payment-grid label, .certificates label { display: block; color: #516f90; font-size: 9px; font-weight: 700; text-transform: uppercase; }
.recipient-grid strong, .payment-grid strong { display: block; margin-top: 4px; color: #33475b; font-size: 10px; font-weight: 600; overflow-wrap: anywhere; }
.relation-banner { margin-top: 12px; border: 1px solid #cbd6e2; border-radius: 4px; padding: 9px 12px; color: #516f90; }
.concepts-section { margin-top: 22px; }
.concepts-section h2 { margin: 0 0 8px; font-size: 12px; }
.concepts-section table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
.concepts-section thead { background: #eaf3f6; }
.concepts-section th { padding: 9px 6px; color: #33475b; font-size: 9px; font-weight: 700; text-align: left; }
.concepts-section th:nth-child(1) { width: 70px; } .concepts-section th:nth-child(2) { width: auto; } .concepts-section th:nth-child(3) { width: 55px; } .concepts-section th:nth-child(4) { width: 50px; } .concepts-section th:nth-child(5) { width: 85px; } .concepts-section th:nth-child(6) { width: 80px; } .concepts-section th:nth-child(7) { width: 90px; }
.concepts-section th:nth-child(n+4) { text-align: right; }
.concepts-section td { padding: 11px 6px; color: #516f90; vertical-align: top; overflow-wrap: anywhere; }
.concepts-section tbody tr:nth-child(even) { background: #f7f9fa; }
.concepts-section td:nth-child(n+4) { text-align: right; }
.concepts-section td.amount { white-space: nowrap; }
.concepts-section td.strong { color: #33475b; font-weight: 700; }
.mono { font-family: 'Courier New', monospace; font-size: 9px !important; }
.totals-section { display: flex; justify-content: flex-end; margin-top: 16px; }
.totals { width: 260px; }
.totals > div { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; color: #516f90; }
.totals strong { color: #33475b; font-weight: 600; white-space: nowrap; }
.totals .grand-total { margin-top: 5px; border-top: 1px solid #33475b; padding-top: 9px; color: #33475b; font-size: 12px; font-weight: 700; }
.totals .grand-total strong { color: #ff7a59; font-size: 15px; }
.payment-section { margin-top: 18px; border: 1px solid #e5eaf0; border-radius: 6px; background: #fafbfc; padding: 14px; }
.payment-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px 20px; }
.legal-section { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 16px; margin-top: 18px; border-top: 1px solid #e5eaf0; padding-top: 12px; }
.certificates { display: grid; align-content: start; gap: 9px; }
.certificates span { display: block; margin-top: 3px; color: #8da1b5; font: 9px/1.35 'Courier New', monospace; overflow-wrap: anywhere; }
.qr-column { display: grid; justify-items: center; align-content: start; gap: 7px; }
.qr-column img { width: 110px; height: 110px; background: #fff; image-rendering: pixelated; }
.qr-column p { margin: 0; color: #8da1b5; font-size: 9px; text-align: center; }
.cancelled-watermark { margin-top: 14px; color: #8da1b5; font-size: 24px; font-weight: 800; letter-spacing: .2em; text-align: center; }
.paper-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: auto; border-top: 1px solid #e5eaf0; padding-top: 10px; color: #8da1b5; font-size: 9px; }
.paper-footer b { margin-left: 12px; font-weight: 500; }
.print-loading, .print-error { display: grid; place-items: center; min-height: 100vh; color: #516f90; font: 14px Inter, Arial, sans-serif; }
@media (max-width: 850px) { .print-shell { overflow-x: auto; padding: 10px; } .print-toolbar { min-width: 816px; } .invoice-paper { margin-left: 0; } }
@media print { html, body { margin: 0; background: #fff; } .no-print { display: none !important; } .print-shell { overflow: visible; min-height: 0; padding: 0; background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; } .invoice-paper { width: 816px; min-height: 1056px; margin: 0; box-shadow: none; } .concepts-section tr, .receptor-section, .payment-section, .legal-section { break-inside: avoid; } }
</style>

import { randomUUID } from 'node:crypto'
import type {
  PacCancelInput,
  PacPaymentStampInput,
  PacProvider,
  PacStampInput,
  PacStampResult,
  PacStatusResult
} from '~/server/utils/pac/provider'

// Laboratorio local de CFDI (pedido del usuario, 2026-09-15: "ocupo un lab
// gratuito porque Facturapi me pide registro si o si"). Provider `lab`:
// implementa PacProvider SIMULANDO el timbrado por completo (UUID, XML con
// estructura CFDI 4.0 + TFD, PDF descargable) sin llamar a ningún servicio
// externo — sirve para desarrollo, pruebas del flujo completo y demos.
//
// Reglas de honestidad:
// - El XML lleva un comentario explícito de LABORATORIO y SelloSAT simulado:
//   estos documentos NO tienen valor fiscal y ningún validador del SAT los
//   daría por buenos.
// - Solo funciona con sandbox=true (ver getPacProvider): imposible emitir
//   "documentos de laboratorio" con la organización en modo producción.
// - Stateless: fetchBinaries/getStatus regeneran binarios a partir del UUID
//   embebido en el providerDocumentId (`lab-{uuid}`), sin conceptos — suficiente
//   para ejercitar el recovery (adopción), que es lo que el lab prueba.

const money = (n: number) => n.toFixed(2)
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function conceptosXml(input: PacStampInput): string {
  const conceptos = input.conceptos
    .map(
      (c) =>
        `    <cfdi:Concepto ClaveProdServ="${xmlEsc(c.claveProdServ)}" ClaveUnidad="${xmlEsc(c.claveUnidad)}" Cantidad="${c.cantidad}" Descripcion="${xmlEsc(c.descripcion)}" ValorUnitario="${c.valorUnitario}" Descuento="${money(c.descuento)}" Importe="${money(c.importe)}" ObjetoImp="02">` +
        c.traslados
          .map(
            (t) =>
              `<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${money(t.base)}" Impuesto="${t.clave}" TipoFactor="${t.tipoFactor}" TasaOCuota="${t.tasaOCuota}" Importe="${money(t.importe)}"/></cfdi:Traslados></cfdi:Impuestos>`
          )
          .join('') +
        `</cfdi:Concepto>`
    )
    .join('\n')
  return `<cfdi:Conceptos>\n${conceptos}\n  </cfdi:Conceptos>`
}

function totalesXml(subtotal: number, trasladoTotal: number, retencionTotal: number): string {
  if (trasladoTotal <= 0 && retencionTotal <= 0) return ''
  const traslados = trasladoTotal > 0 ? `<cfdi:Traslados><cfdi:Traslado Base="${money(subtotal)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${money(trasladoTotal)}"/></cfdi:Traslados>` : ''
  const retenciones = retencionTotal > 0 ? `<cfdi:Retenciones><cfdi:Retencion Impuesto="002" Importe="${money(retencionTotal)}"/></cfdi:Retenciones>` : ''
  return `  <cfdi:Impuestos TotalImpuestosTrasladados="${money(trasladoTotal)}" TotalImpuestosRetenidos="${money(retencionTotal)}">${traslados}${retenciones}</cfdi:Impuestos>`
}

function tfd(uuid: string, stampedAt: Date): string {
  return `  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" Version="1.1" UUID="${uuid}" FechaTimbrado="${stampedAt.toISOString()}" SelloCFD="LABORATORIO-FLOWERP" NoCertificadoSAT="LAB0000000000000000000" SelloSAT="SIMULADO-LABORATORIO-FLOWERP" RfcProvCertif="LAB010101AAA"/>
  </cfdi:Complemento>`
}

function buildInvoiceXml(input: PacStampInput, uuid: string, stampedAt: Date, subtotal: number, trasladoTotal: number, retencionTotal: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- LABORATORIO FlowERP: documento SIMULADO, sin valor fiscal. No fue timbrado por un PAC autorizado. -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="4.0" Serie="${xmlEsc(input.serie)}" Folio="${input.folio}" Fecha="${stampedAt.toISOString()}" FormaPago="${input.formaPago ?? '99'}" MetodoPago="${input.metodoPago}" Moneda="${input.moneda}" SubTotal="${money(subtotal)}" Total="${money(subtotal + trasladoTotal - retencionTotal)}" Exportacion="${input.exportacion}" LugarExpedicion="${xmlEsc(input.emisor.codigoPostal)}" Sello="LABORATORIO" NoCertificado="LAB0000000000000000000">
  <cfdi:Emisor Rfc="${xmlEsc(input.emisor.rfc)}" Nombre="${xmlEsc(input.emisor.nombre)}" RegimenFiscal="${xmlEsc(input.emisor.regimenFiscal)}"/>
  <cfdi:Receptor Rfc="${xmlEsc(input.receptor.rfc)}" Nombre="${xmlEsc(input.receptor.nombre)}" DomicilioFiscalReceptor="${xmlEsc(input.receptor.codigoPostal)}" RegimenFiscalReceptor="${xmlEsc(input.receptor.regimenFiscal)}" UsoCFDI="${xmlEsc(input.usoCfdi)}"/>
${conceptosXml(input)}
${totalesXml(subtotal, trasladoTotal, retencionTotal)}
${tfd(uuid, stampedAt)}
</cfdi:Comprobante>
`
}

function buildPaymentXml(input: PacPaymentStampInput, uuid: string, stampedAt: Date): string {
  const doctos = input.doctos
    .map(
      (d) =>
        `      <pago20:DoctoRelacionado IdDocumento="${d.uuidFiscal}" NumParcialidad="${d.numParcialidad ?? 1}" ImpSaldoAnt="${money(d.impSaldoAnt)}" ImpPagado="${money(d.impPagado)}" ImpSaldoIns="${money(d.impSaldoIns)}" MonedaDR="${d.monedaDr}" EquivalenciaDR="${d.tipoCambioDr ?? 1}"/>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- LABORATORIO FlowERP: documento SIMULADO, sin valor fiscal. No fue timbrado por un PAC autorizado. -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="${xmlEsc(input.serie)}" Folio="${input.folio}" Fecha="${stampedAt.toISOString()}" Total="${money(input.montoTotal)}" SubTotal="${money(input.montoTotal)}" Moneda="${input.moneda}" Exportacion="01" LugarExpedicion="${xmlEsc(input.emisor.codigoPostal)}" Sello="LABORATORIO">
  <cfdi:Emisor Rfc="${xmlEsc(input.emisor.rfc)}" Nombre="${xmlEsc(input.emisor.nombre)}" RegimenFiscal="${xmlEsc(input.emisor.regimenFiscal)}"/>
  <cfdi:Receptor Rfc="${xmlEsc(input.receptor.rfc)}" Nombre="${xmlEsc(input.receptor.nombre)}" DomicilioFiscalReceptor="${xmlEsc(input.receptor.codigoPostal)}" RegimenFiscalReceptor="${xmlEsc(input.receptor.regimenFiscal)}" UsoCFDI="P01"/>
  <cfdi:Complemento>
    <pago20:Pagos xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="2.0">
      <pago20:Totales MontoTotalPagos="${money(input.montoTotal)}"/>
      <pago20:Pago FechaPago="${input.fechaPago.toISOString()}" FormaDePagoP="${xmlEsc(input.formaPago)}" MonedaP="${input.moneda}">
${doctos}
      </pago20:Pago>
    </pago20:Pagos>
${tfd(uuid, stampedAt)}
  </cfdi:Complemento>
</cfdi:Comprobante>
`
}

// PDF mínimo válido (1 página, Helvetica) escrito a mano — sin dependencias.
// Suficiente para descarga/adjuntos/correos del lab; no es una representación
// impresa bonita (esa la da el PAC real).
function buildLabPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const body = [`BT /F1 13 Tf 40 760 Td (${esc(title)}) Tj ET`, 'BT /F1 10 Tf 12 TL 40 730 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefPos = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

export class MockLabProvider implements PacProvider {
  readonly name = 'lab'

  async verifyCredentials(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Laboratorio local FlowERP activo (sin PAC externo)' }
  }

  async stamp(input: PacStampInput): Promise<PacStampResult> {
    const uuid = randomUUID().toUpperCase()
    const stampedAt = new Date()
    const subtotal = input.conceptos.reduce((acc, c) => acc + c.importe - c.descuento, 0)
    const trasladoTotal = input.conceptos.reduce((acc, c) => acc + c.traslados.reduce((a, t) => a + t.importe, 0), 0)
    const retencionTotal = input.conceptos.reduce((acc, c) => acc + c.retenciones.reduce((a, r) => a + r.importe, 0), 0)
    const xml = buildInvoiceXml(input, uuid, stampedAt, subtotal, trasladoTotal, retencionTotal)
    const pdf = buildLabPdf(`CFDI de laboratorio ${input.serie}-${input.folio}`, [
      `UUID (simulado): ${uuid}`,
      `Emisor: ${input.emisor.nombre} (${input.emisor.rfc})`,
      `Receptor: ${input.receptor.nombre} (${input.receptor.rfc})`,
      `SubTotal: ${money(subtotal)}  Total: ${money(subtotal + trasladoTotal - retencionTotal)} ${input.moneda}`,
      '',
      'Documento SIMULADO por el laboratorio local de FlowERP.',
      'No tiene valor fiscal ni sello real del SAT.'
    ])
    return { uuidFiscal: uuid, providerDocumentId: `lab-${uuid}`, fechaTimbrado: stampedAt, xml: Buffer.from(xml, 'utf8'), pdf }
  }

  async stampPayment(input: PacPaymentStampInput): Promise<PacStampResult> {
    const uuid = randomUUID().toUpperCase()
    const stampedAt = new Date()
    const xml = buildPaymentXml(input, uuid, stampedAt)
    const pdf = buildLabPdf(`Complemento de pago de laboratorio ${input.serie}-${input.folio}`, [
      `UUID (simulado): ${uuid}`,
      `Fecha de pago: ${input.fechaPago.toLocaleString('es-MX')}`,
      `Monto total: ${money(input.montoTotal)} ${input.moneda}`,
      `Documentos relacionados: ${input.doctos.length}`,
      '',
      'Documento SIMULADO por el laboratorio local de FlowERP.'
    ])
    return { uuidFiscal: uuid, providerDocumentId: `lab-${uuid}`, fechaTimbrado: stampedAt, xml: Buffer.from(xml, 'utf8'), pdf }
  }

  /** Regenera binarios desde el UUID embebido en el id (`lab-{uuid}`), sin conceptos (stateless). */
  async fetchBinaries(providerDocumentId: string): Promise<{ xml: Buffer; pdf: Buffer }> {
    const uuid = providerDocumentId.startsWith('lab-') ? providerDocumentId.slice(4).toUpperCase() : providerDocumentId.toUpperCase()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- LABORATORIO FlowERP: binarios REGENERADOS para recovery, sin conceptos. -->\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">\n${tfd(uuid, new Date())}\n</cfdi:Comprobante>\n`
    const pdf = buildLabPdf(`CFDI de laboratorio (regenerado)`, [`UUID (simulado): ${uuid}`, 'Binarios regenerados por el recovery del laboratorio.'])
    return { xml: Buffer.from(xml, 'utf8'), pdf }
  }

  async cancel(_input: PacCancelInput): Promise<void> {
    // El lab acepta toda cancelación (stateless): el estado real lo lleva cfdi_documents.
  }

  async getStatus(providerDocumentId: string): Promise<PacStatusResult> {
    const uuid = providerDocumentId.startsWith('lab-') ? providerDocumentId.slice(4).toUpperCase() : null
    return { state: uuid ? 'vigente' : 'desconocido', uuidFiscal: uuid }
  }

  async findBySerieFolio(): Promise<{ uuidFiscal: string; providerDocumentId: string } | null> {
    // Stateless: el lab no recuerda timbrados previos por serie+folio.
    return null
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import type { db } from '~/server/db'
import { cfdiConceptos, cfdiDocuments, cfdiEvents, cfdiPaymentDocs, cfdiSeries } from '~/server/db/schema'
import { assignNextFolio } from '~/server/utils/cfdiFolio'
import { CfdiDocumentError, CfdiDocumentNotFoundError, mapConceptoRow, round2 } from '~/server/utils/cfdiDocuments'
import { buildStampInput, snapshotEmisor, validarReceptorParaTimbrar, type EmisorSnapshot } from '~/server/utils/cfdi/payloadBuilder'
import type { PacPaymentStampInput, PacProvider, PacStampInput, PacStampResult } from '~/server/utils/pac/provider'
import { PacProviderError } from '~/server/utils/pac/provider'
import { createTransporter, resolveSmtpConfig, SmtpNotConfiguredError } from '~/server/utils/mailer'

// Fases D/F/G de DOCS/HU_Timbrado_CFDI_PAC.md: el motor de timbrado.
//
// Reglas de oro (comentadas también en cfdiFolio.ts):
// 1. La validación completa del documento ocurre ANTES de consumir folio —
//    un error de datos no gasta la secuencia.
// 2. El folio se consume en la transición a `timbrando`, dentro de la misma
//    transacción (lock de fila del documento + lock de la serie).
// 3. La llamada al PAC ocurre FUERA de toda transacción (red lenta no debe
//    retener locks).
// 4. Un intento previo con `pacDocumentId` conocido SIEMPRE se verifica por
//    getStatus antes de volver a timbrar; si el PAC dice "vigente", se ADOPTA
//    el timbrado (descarga de binarios) en vez de stampar de nuevo — es la
//    única defensa real contra doble timbrado tras un crash.
// 5. Un intento previo muerto SIN pacDocumentId (timeout antes de respuesta)
//    se verifica best-effort por findBySerieFolio antes de reusar el folio.
// 6. Todo intento/verificación/cancelación queda en cfdi_events (append-only).

type Tx = typeof db

export class CfdiStampError extends CfdiDocumentError {}

function storageDir(): string {
  return process.env.FILES_STORAGE_DIR ? path.resolve(process.env.FILES_STORAGE_DIR) : path.resolve(process.cwd(), 'uploads')
}

function binaryKey(tenantId: string, docId: string, kind: 'xml' | 'pdf'): string {
  return path.join('cfdi', tenantId, `${docId}.${kind}`)
}

async function logEvent(tx: Tx, tenantId: string, documentId: string, tipo: string, detalle: Record<string, unknown>, userId: string | null) {
  await tx.insert(cfdiEvents).values({ tenantId, documentId, tipo, detalle, createdBy: userId })
}

function storeCfdiBinaries(tenantId: string, docId: string, xml: Buffer, pdf: Buffer): { xmlKey: string; pdfKey: string } {
  const xmlKey = binaryKey(tenantId, docId, 'xml')
  const pdfKey = binaryKey(tenantId, docId, 'pdf')
  // clave determinista por documento: re-adopcion/reintento simplemente sobrescribe
  fs.mkdirSync(path.dirname(path.join(storageDir(), xmlKey)), { recursive: true })
  fs.writeFileSync(path.join(storageDir(), xmlKey), xml)
  fs.writeFileSync(path.join(storageDir(), pdfKey), pdf)
  return { xmlKey, pdfKey }
}

export function loadCfdiBinary(tenantId: string, docId: string, kind: 'xml' | 'pdf'): { fullPath: string; fileName: string } | null {
  const key = binaryKey(tenantId, docId, kind)
  const fullPath = path.join(storageDir(), key)
  if (!fs.existsSync(fullPath)) return null
  return { fullPath, fileName: `${docId}.${kind}` }
}

export interface StampSummary {
  id: string
  estado: string
  folio: number | null
  uuidFiscal: string | null
}

async function adoptDocument(tenantId: string, documentId: string, result: PacStampResult & { adoptado?: boolean }, userId: string | null): Promise<StampSummary> {
  const { xmlKey, pdfKey } = storeCfdiBinaries(tenantId, documentId, result.xml, result.pdf)
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(cfdiDocuments)
      .set({
        estado: 'timbrada',
        uuidFiscal: result.uuidFiscal,
        fechaTimbrado: result.fechaTimbrado,
        xmlStorageKey: xmlKey,
        pdfStorageKey: pdfKey,
        pacDocumentId: result.providerDocumentId,
        mensajePac: null,
        updatedAt: new Date()
      })
      .where(and(eq(cfdiDocuments.id, documentId), eq(cfdiDocuments.tenantId, tenantId)))
      .returning({ id: cfdiDocuments.id, estado: cfdiDocuments.estado, folio: cfdiDocuments.folio, uuidFiscal: cfdiDocuments.uuidFiscal })
    await logEvent(tx, tenantId, documentId, 'timbrado_ok', { uuid: result.uuidFiscal, adoptado: Boolean(result.adoptado) }, userId)
    return row
  })
}

async function buildPaymentInput(tx: Tx, tenantId: string, docId: string, serieLetter: string, folio: number, emisor: EmisorSnapshot, receptor: PacStampInput['receptor'], fechaPago: Date | null, formaPago: string | null, moneda: string): Promise<PacPaymentStampInput> {
  if (!fechaPago) throw new CfdiDocumentError('El complemento de pago necesita fecha de pago')
  if (!formaPago) throw new CfdiDocumentError('El complemento de pago necesita forma de pago (catálogo SAT)')
  const pagos = await tx
    .select({ fila: cfdiPaymentDocs, rel: cfdiDocuments, relSerie: cfdiSeries.serie })
    .from(cfdiPaymentDocs)
    .innerJoin(cfdiDocuments, eq(cfdiDocuments.id, cfdiPaymentDocs.relatedCfdiId))
    .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
    .where(and(eq(cfdiPaymentDocs.documentId, docId), eq(cfdiPaymentDocs.tenantId, tenantId)))
  if (!pagos.length) throw new CfdiDocumentError('El complemento no tiene documentos relacionados')
  const doctos = pagos.map((p) => ({
    uuidFiscal: p.rel.uuidFiscal!,
    serie: p.relSerie,
    folio: p.rel.folio ?? 0,
    monedaDr: p.fila.monedaDr,
    tipoCambioDr: p.fila.tipoCambioDr != null ? Number(p.fila.tipoCambioDr) : null,
    numParcialidad: p.fila.numParcialidad,
    impSaldoAnt: Number(p.fila.impSaldoAnt),
    impPagado: Number(p.fila.impPagado),
    impSaldoIns: Number(p.fila.impSaldoIns)
  }))
  const montoTotal = round2(doctos.reduce((acc, d) => acc + d.impPagado, 0))
  return { serie: serieLetter, folio, fechaPago, formaPago, montoTotal, moneda, emisor, receptor, doctos }
}

/**
 * Timbra (o re-intenta/adopta) un documento. `provider` se inyecta: el
 * endpoint lo resuelve con getPacProvider(tenantId) y los tests con un fake.
 */
export async function stampDocument(tenantId: string, documentId: string, userId: string | null, provider: PacProvider): Promise<StampSummary> {
  // --- 1. Pre-lectura sin lock + recovery de intentos anteriores -----------
  const pre = await withTenant(tenantId, async (tx) => {
    const [doc] = await tx
      .select({ documento: cfdiDocuments, serieLetter: cfdiSeries.serie })
      .from(cfdiDocuments)
      .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
      .where(and(eq(cfdiDocuments.id, documentId), eq(cfdiDocuments.tenantId, tenantId)))
      .limit(1)
    return doc ?? null
  })
  if (!pre) throw new CfdiDocumentNotFoundError()
  const doc0 = pre.documento
  if (doc0.estado === 'timbrada') throw new CfdiStampError('El documento ya está timbrado', 409)
  if (doc0.estado === 'cancelada') throw new CfdiStampError('El documento está cancelado; ya no se puede timbrar', 409)

  if (doc0.pacDocumentId) {
    const status = await provider.getStatus(doc0.pacDocumentId)
    await withTenant(tenantId, (tx) => logEvent(tx, tenantId, documentId, 'verificacion_getstatus', { state: status.state, uuid: status.uuidFiscal }, userId))
    if (status.state === 'vigente' && status.uuidFiscal) {
      const binaries = await provider.fetchBinaries(doc0.pacDocumentId)
      return adoptDocument(tenantId, documentId, { ...binaries, uuidFiscal: status.uuidFiscal, providerDocumentId: doc0.pacDocumentId, fechaTimbrado: doc0.fechaTimbrado ?? new Date(), adoptado: true }, userId)
    }
    if (status.state === 'cancelado') throw new CfdiStampError('El PAC reporta este documento como cancelado', 409)
    if (status.state === 'en_proceso') throw new CfdiStampError('El intento anterior sigue en proceso en el PAC; vuelve a intentar en unos minutos', 409)
    // desconocido: el PAC no lo tiene — se puede re-timbrar con el mismo folio
  } else if (doc0.folio != null && provider.findBySerieFolio) {
    // Intento anterior muerto SIN providerDocumentId (timeout antes de
    // respuesta): antes de reusar el folio, preguntar al PAC por serie+folio.
    const found = await provider.findBySerieFolio(pre.serieLetter, doc0.folio).catch(() => null)
    if (found?.uuidFiscal && found.providerDocumentId) {
      const binaries = await provider.fetchBinaries(found.providerDocumentId)
      return adoptDocument(tenantId, documentId, { ...binaries, uuidFiscal: found.uuidFiscal, providerDocumentId: found.providerDocumentId, fechaTimbrado: new Date(), adoptado: true }, userId)
    }
  }

  // --- 2. Validación estricta ANTES de consumir folio -----------------------
  validarReceptorParaTimbrar(doc0)
  if (doc0.tipo !== 'P') {
    const hayConceptos = await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(cfdiConceptos).where(eq(cfdiConceptos.documentId, documentId))
      return (row?.n ?? 0) > 0
    })
    if (!hayConceptos) throw new CfdiDocumentError('El documento no tiene conceptos; no se puede timbrar')
  }

  // --- 3. Transición a `timbrando` + folio + snapshot emisor (una tx) -------
  const stampInput = await withTenant(tenantId, async (tx) => {
    const [locked] = await tx.select().from(cfdiDocuments).where(and(eq(cfdiDocuments.id, documentId), eq(cfdiDocuments.tenantId, tenantId))).for('update').limit(1)
    if (!locked) throw new CfdiDocumentNotFoundError()
    if (locked.estado === 'timbrada') throw new CfdiStampError('El documento ya está timbrado', 409)
    if (locked.estado === 'cancelada') throw new CfdiStampError('El documento está cancelado', 409)

    const [serie] = await tx.select().from(cfdiSeries).where(eq(cfdiSeries.id, locked.serieId)).limit(1)
    if (!serie) throw new CfdiDocumentNotFoundError('La serie del documento ya no existe')

    let folio = locked.folio
    if (folio == null) {
      folio = await assignNextFolio(tx, serie.id)
      await logEvent(tx, tenantId, documentId, 'folio_asignado', { folio, serie: serie.serie }, userId)
    }
    const emisor = await snapshotEmisor(tx, tenantId, serie)
    const intentos = locked.intentos + 1
    await tx
      .update(cfdiDocuments)
      .set({
        estado: 'timbrando',
        folio,
        intentos,
        emisorRfc: emisor.rfc,
        emisorNombre: emisor.nombre,
        emisorRegimenFiscal: emisor.regimenFiscal,
        emisorCodigoPostal: emisor.codigoPostal,
        pacProvider: provider.name,
        updatedAt: new Date()
      })
      .where(eq(cfdiDocuments.id, documentId))
    await logEvent(tx, tenantId, documentId, 'intento_timbrado', { folio, intento: intentos }, userId)

    const docConFolio = { ...locked, folio }
    if (locked.tipo === 'P') {
      return buildPaymentInput(
        tx,
        tenantId,
        documentId,
        serie.serie,
        folio,
        emisor,
        { rfc: locked.receptorRfc!, nombre: locked.receptorNombre!, codigoPostal: locked.receptorCodigoPostal!, regimenFiscal: locked.receptorRegimenFiscal!, correo: locked.receptorCorreo },
        locked.fechaPago,
        locked.formaPago,
        locked.moneda
      )
    }
    const conceptoRows = await tx.select().from(cfdiConceptos).where(eq(cfdiConceptos.documentId, documentId))
    const conceptos = conceptoRows.map(mapConceptoRow)
    let relacionadoUuid: string | null = null
    if (locked.cfdiRelacionadoId) {
      const [rel] = await tx.select({ uuidFiscal: cfdiDocuments.uuidFiscal }).from(cfdiDocuments).where(eq(cfdiDocuments.id, locked.cfdiRelacionadoId)).limit(1)
      relacionadoUuid = rel?.uuidFiscal ?? null
    }
    return buildStampInput(docConFolio, serie, emisor, conceptos, relacionadoUuid)
  })

  // --- 4. Llamada al PAC fuera de transacción -------------------------------
  try {
    const result = doc0.tipo === 'P' ? await provider.stampPayment(stampInput as PacPaymentStampInput) : await provider.stamp(stampInput as PacStampInput)
    return await adoptDocument(tenantId, documentId, result, userId)
  } catch (err) {
    const message = err instanceof PacProviderError ? err.message : 'Error inesperado al timbrar; verifica el documento e intenta de nuevo'
    await withTenant(tenantId, async (tx) => {
      await tx.update(cfdiDocuments).set({ estado: 'error', mensajePac: message, updatedAt: new Date() }).where(eq(cfdiDocuments.id, documentId))
      await logEvent(tx, tenantId, documentId, 'error_pac', { message, retryable: err instanceof PacProviderError ? err.retryable : false }, userId)
    })
    throw new CfdiStampError(message, 422)
  }
}

export interface CancelInput {
  motivo: '01' | '02' | '03' | '04'
  folioSustitucion?: string | null
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function cancelDocument(tenantId: string, documentId: string, userId: string | null, provider: PacProvider, input: CancelInput): Promise<StampSummary> {
  // Validaciones + evento de solicitud en una tx
  const target = await withTenant(tenantId, async (tx) => {
    const [doc] = await tx.select().from(cfdiDocuments).where(and(eq(cfdiDocuments.id, documentId), eq(cfdiDocuments.tenantId, tenantId))).for('update').limit(1)
    if (!doc) throw new CfdiDocumentNotFoundError()
    if (doc.estado !== 'timbrada') throw new CfdiStampError('Solo se cancela ante el SAT un documento timbrado', 409)
    if (!doc.uuidFiscal || !doc.pacDocumentId) throw new CfdiStampError('El documento no tiene los datos del PAC necesarios para cancelar', 409)
    if (input.motivo === '01') {
      // Regla SAT: el motivo 01 ("emitido con errores CON relación") exige el
      // UUID del CFDI sustituto, que además debe existir y estar timbrado.
      const sustituto = input.folioSustitucion?.trim()
      if (!sustituto || !UUID_REGEX.test(sustituto)) throw new CfdiDocumentError('El motivo 01 requiere el UUID fiscal del comprobante sustituto')
      const [rel] = await tx
        .select({ id: cfdiDocuments.id })
        .from(cfdiDocuments)
        .where(and(eq(cfdiDocuments.tenantId, tenantId), eq(cfdiDocuments.uuidFiscal, sustituto.toUpperCase()), eq(cfdiDocuments.estado, 'timbrada')))
        .limit(1)
      if (!rel || rel.id === documentId) throw new CfdiDocumentError('El comprobante sustituto no existe o no está timbrado en esta organización')
    }
    await logEvent(tx, tenantId, documentId, 'cancelacion_solicitada', { motivo: input.motivo, folioSustitucion: input.folioSustitucion ?? null }, userId)
    return { providerDocumentId: doc.pacDocumentId, uuidFiscal: doc.uuidFiscal }
  })

  try {
    await provider.cancel({ providerDocumentId: target.providerDocumentId, motivo: input.motivo, folioSustitucion: input.motivo === '01' ? input.folioSustitucion!.trim().toUpperCase() : null })
  } catch (err) {
    const message = err instanceof PacProviderError ? err.message : 'Error inesperado al cancelar'
    await withTenant(tenantId, (tx) => logEvent(tx, tenantId, documentId, 'error_pac', { fase: 'cancelacion', message }, userId))
    throw new CfdiStampError(message, 422)
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(cfdiDocuments)
      .set({ estado: 'cancelada', updatedAt: new Date() })
      .where(and(eq(cfdiDocuments.id, documentId), eq(cfdiDocuments.tenantId, tenantId)))
      .returning({ id: cfdiDocuments.id, estado: cfdiDocuments.estado, folio: cfdiDocuments.folio, uuidFiscal: cfdiDocuments.uuidFiscal })
    await logEvent(tx, tenantId, documentId, 'cancelacion_confirmada', { motivo: input.motivo }, userId)
    return row
  })
}

// --- Fase G: envío del CFDI por correo --------------------------------------

export async function sendCfdiEmail(tenantId: string, documentId: string, para?: string | null): Promise<{ para: string }> {
  const doc = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ documento: cfdiDocuments, serieLetter: cfdiSeries.serie })
      .from(cfdiDocuments)
      .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
      .where(and(eq(cfdiDocuments.id, documentId), eq(cfdiDocuments.tenantId, tenantId)))
      .limit(1)
    return row ?? null
  })
  if (!doc) throw new CfdiDocumentNotFoundError()
  if (doc.documento.estado !== 'timbrada') throw new CfdiStampError('Solo se envía por correo un documento timbrado', 409)

  const destino = (para?.trim() || doc.documento.receptorCorreo || '').trim()
  if (!destino || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) throw new CfdiDocumentError('Indica un correo de destino válido')

  const xml = doc.documento.xmlStorageKey ? loadCfdiBinary(tenantId, documentId, 'xml') : null
  const pdf = doc.documento.pdfStorageKey ? loadCfdiBinary(tenantId, documentId, 'pdf') : null
  if (!xml || !pdf) throw new CfdiStampError('Los archivos timbrados ya no están en disco; no se puede enviar', 409)

  let smtp
  try {
    smtp = await resolveSmtpConfig(tenantId)
  } catch (err) {
    if (err instanceof SmtpNotConfiguredError) throw new CfdiStampError('Configura el correo saliente en Ajustes → API e integraciones', 422)
    throw err
  }

  const folioTexto = `${doc.serieLetter}-${String(doc.documento.folio ?? 0).padStart(6, '0')}`
  const uuidCorto = doc.documento.uuidFiscal ?? ''
  const transporter = createTransporter(smtp)
  await transporter.sendMail({
    from: smtp.fromName ? `"${smtp.fromName}" <${smtp.from}>` : smtp.from,
    replyTo: smtp.replyTo,
    to: destino,
    subject: `CFDI ${folioTexto} de ${doc.documento.emisorNombre ?? 'tu proveedor'}`,
    html: `<p>Hola, ${doc.documento.receptorNombre ?? ''}:</p><p>Adjuntamos el comprobante fiscal digital <strong>${folioTexto}</strong> (UUID ${uuidCorto}) en sus versiones XML y PDF.</p><p>Saludos.</p>`,
    attachments: [
      { filename: `${folioTexto}_${uuidCorto}.xml`.replace(/\s/g, ''), contentType: 'application/xml', content: fs.readFileSync(xml.fullPath) },
      { filename: `${folioTexto}_${uuidCorto}.pdf`.replace(/\s/g, ''), contentType: 'application/pdf', content: fs.readFileSync(pdf.fullPath) }
    ]
  })
  await withTenant(tenantId, (tx) => logEvent(tx, tenantId, documentId, 'email_enviado', { para: destino }, null))
  return { para: destino }
}

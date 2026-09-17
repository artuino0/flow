import { eq } from 'drizzle-orm'
import type { db } from '~/server/db'
import { tenants } from '~/server/db/schema'
import { CfdiDocumentError, type ConceptoComputado } from '~/server/utils/cfdiDocuments'
import { RFC_REGEX_SRC } from '~/utils/cfdiCatalogos'
import type { PacConcepto, PacStampInput } from '~/server/utils/pac/provider'

type Tx = typeof db

// Fase D de DOCS/HU_Timbrado_CFDI_PAC.md: armado del payload neutro de
// timbrado desde el documento fijo + snapshot del emisor. TODO lo que el SAT
// exige se valida acá con mensajes accionables ANTES de consumir folio o
// llamar al PAC (error de validación no consume folio — regla de cfdiFolio.ts).
// El emisor se snapshotea desde tenants.fiscalData (ERD-61/62, "Datos fiscales"
// de Ajustes) + tenants.name como razón social de respaldo.

type DocumentRow = {
  id: string
  tipo: string // 'I' | 'E' | 'P' (text en schema; se acota al armar el PacStampInput)
  folio: number | null
  usoCfdi: string | null
  formaPago: string | null
  metodoPago: string
  moneda: string
  tipoCambio: string | null
  exportacion: string
  receptorRfc: string | null
  receptorNombre: string | null
  receptorCodigoPostal: string | null
  receptorRegimenFiscal: string | null
  receptorCorreo: string | null
  fechaPago: Date | null
  observaciones: string | null
  cfdiRelacionadoId: string | null
  tipoRelacion: string | null
}

type SerieRow = { serie: string; lugarExpedicion: string }

export interface EmisorSnapshot {
  rfc: string
  nombre: string
  regimenFiscal: string
  codigoPostal: string
}

const RFC_REGEX = new RegExp(RFC_REGEX_SRC)

export async function snapshotEmisor(tx: Tx, tenantId: string, serie: SerieRow): Promise<EmisorSnapshot> {
  const [tenant] = await tx.select({ name: tenants.name, fiscalData: tenants.fiscalData }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const fiscal = (tenant?.fiscalData ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const emisor = {
    rfc: str(fiscal.rfc),
    nombre: str(fiscal.razonSocial) ?? tenant?.name ?? null,
    regimenFiscal: str(fiscal.regimenFiscal),
    codigoPostal: str(fiscal.codigoPostal) ?? serie.lugarExpedicion
  }
  const faltantes: string[] = []
  if (!emisor.rfc || !RFC_REGEX.test(emisor.rfc)) faltantes.push('RFC')
  if (!emisor.nombre) faltantes.push('razón social')
  if (!emisor.regimenFiscal) faltantes.push('régimen fiscal')
  if (!emisor.codigoPostal) faltantes.push('código postal')
  if (faltantes.length) {
    throw new CfdiDocumentError(`Faltan datos fiscales del emisor: ${faltantes.join(', ')}. Complétalos en Ajustes → Organización → Datos fiscales.`)
  }
  return emisor as EmisorSnapshot
}

export function validarReceptorParaTimbrar(doc: DocumentRow) {
  const faltantes: string[] = []
  if (!doc.receptorRfc || !RFC_REGEX.test(doc.receptorRfc)) faltantes.push('RFC del receptor')
  if (!doc.receptorNombre) faltantes.push('nombre del receptor')
  if (!doc.receptorCodigoPostal) faltantes.push('código postal del receptor')
  if (!doc.receptorRegimenFiscal) faltantes.push('régimen fiscal del receptor')
  if (!doc.usoCfdi) faltantes.push('uso de CFDI')
  if (faltantes.length) {
    throw new CfdiDocumentError(`Faltan datos para timbrar: ${faltantes.join(', ')}`)
  }
}

export function buildStampInput(doc: DocumentRow & { folio: number }, serie: SerieRow, emisor: EmisorSnapshot, conceptos: ConceptoComputado[], relacionadoUuid: string | null): PacStampInput {
  if (!conceptos.length && doc.tipo !== 'P') {
    throw new CfdiDocumentError('El documento no tiene conceptos; no se puede timbrar')
  }
  const pacConceptos: PacConcepto[] = conceptos.map((c) => ({
    claveProdServ: c.claveProdServ,
    claveUnidad: c.claveUnidad,
    cantidad: c.cantidad,
    descripcion: c.descripcion,
    valorUnitario: c.valorUnitario,
    descuento: c.descuento,
    importe: c.importe,
    traslados: c.impuestos.traslados.map((t) => ({ base: t.base, clave: t.impuesto, tipoFactor: t.tipoFactor, tasaOCuota: t.tasaOCuota, importe: t.importe })),
    retenciones: c.impuestos.retenciones.map((r) => ({ base: r.base, clave: r.impuesto, tipoFactor: r.tipoFactor, tasaOCuota: r.tasaOCuota, importe: r.importe }))
  }))
  return {
    serie: serie.serie,
    folio: doc.folio,
    tipo: doc.tipo as 'I' | 'E' | 'P',
    usoCfdi: doc.usoCfdi!,
    formaPago: doc.formaPago,
    metodoPago: doc.metodoPago as 'PUE' | 'PPD',
    moneda: doc.moneda,
    tipoCambio: doc.tipoCambio != null ? Number(doc.tipoCambio) : null,
    exportacion: doc.exportacion as '01' | '02' | '03',
    emisor,
    receptor: {
      rfc: doc.receptorRfc!,
      nombre: doc.receptorNombre!,
      codigoPostal: doc.receptorCodigoPostal!,
      regimenFiscal: doc.receptorRegimenFiscal!,
      correo: doc.receptorCorreo
    },
    conceptos: pacConceptos,
    ...(doc.cfdiRelacionadoId && relacionadoUuid && doc.tipoRelacion ? { relacionado: { uuidFiscal: relacionadoUuid, tipoRelacion: doc.tipoRelacion } } : {}),
    ...(doc.fechaPago ? { fechaPago: doc.fechaPago } : {}),
    observaciones: doc.observaciones
  }
}

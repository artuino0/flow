import { getFullPacSettings, PacNotConfiguredError } from '~/server/utils/pacSettings'
import { FacturapiProvider } from '~/server/utils/pac/facturapi'
import { MockLabProvider } from '~/server/utils/pac/mockLab'

// Fase B de DOCS/HU_Timbrado_CFDI_PAC.md: abstraccion del PAC. El motor de
// timbrado (fase D) habla SOLO con esta interfaz - cambiar o agregar
// proveedor (SW Sapien, etc.) es implementar la interfaz y registrarla en
// getPacProvider(), sin tocar endpoints ni UI.

export type CfdiTipo = 'I' | 'E' | 'P'

export interface PacImpuestoLinea {
  base: number
  clave: string // '002' IVA | '003' IEPS
  tipoFactor: 'Tasa' | 'Cuota' | 'Exento'
  tasaOCuota: number // 0.16 = 16%
  importe: number
}

export interface PacConcepto {
  claveProdServ: string
  claveUnidad: string
  cantidad: number
  descripcion: string
  valorUnitario: number
  descuento: number
  importe: number
  traslados: PacImpuestoLinea[]
  retenciones: PacImpuestoLinea[]
}

/** Entrada neutra de timbrado: el payload CFDI 4.0 ya validado/cuadrado por el builder (fase D). */
export interface PacStampInput {
  serie: string
  folio: number
  tipo: CfdiTipo
  usoCfdi: string
  formaPago: string | null
  metodoPago: 'PUE' | 'PPD'
  moneda: string
  tipoCambio: number | null
  exportacion: '01' | '02' | '03'
  emisor: { rfc: string; nombre: string; regimenFiscal: string; codigoPostal: string }
  receptor: { rfc: string; nombre: string; codigoPostal: string; regimenFiscal: string; correo?: string | null }
  conceptos: PacConcepto[]
  relacionado?: { uuidFiscal: string; tipoRelacion: string }
  fechaPago?: Date | null
  observaciones?: string | null
}

export interface PacStampResult {
  uuidFiscal: string
  fechaTimbrado: Date
  xml: Buffer
  pdf: Buffer
  providerDocumentId: string
}

export interface PacCancelInput {
  providerDocumentId: string
  motivo: '01' | '02' | '03' | '04'
  folioSustitucion?: string | null // uuid del CFDI sustituto (obligatorio con motivo 01, regla SAT)
}

export interface PacPaymentDocLine {
  uuidFiscal: string
  serie: string
  folio: number
  monedaDr: string
  tipoCambioDr: number | null
  numParcialidad: number | null
  impSaldoAnt: number
  impPagado: number
  impSaldoIns: number
}

/** Entrada neutra de un complemento de pagos 2.0 (documento tipo P). */
export interface PacPaymentStampInput {
  serie: string
  folio: number
  fechaPago: Date
  formaPago: string
  montoTotal: number
  moneda: string
  emisor: { rfc: string; nombre: string; regimenFiscal: string; codigoPostal: string }
  receptor: { rfc: string; nombre: string; codigoPostal: string; regimenFiscal: string; correo?: string | null }
  doctos: PacPaymentDocLine[]
}

export type PacDocumentState = 'vigente' | 'cancelado' | 'en_proceso' | 'desconocido'

export interface PacStatusResult {
  state: PacDocumentState
  uuidFiscal: string | null
  raw?: unknown
}

export class PacProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean = false
  ) {
    super(message)
  }
}

export interface PacProvider {
  readonly name: string
  /** Prueba de conexion ligera (endpoint de configuracion "Probar conexion"). */
  verifyCredentials(): Promise<{ ok: boolean; message: string }>
  /** Timbra y devuelve UUID + binarios. NUNCA reintentar a ciegas (fase D: recovery por getStatus). */
  stamp(input: PacStampInput): Promise<PacStampResult>
  /** Timbra un complemento de pagos 2.0 (documento tipo P). */
  stampPayment(input: PacPaymentStampInput): Promise<PacStampResult>
  /** Re-descarga XML/PDF de un comprobante YA timbrado (recovery/adopcion). */
  fetchBinaries(providerDocumentId: string): Promise<{ xml: Buffer; pdf: Buffer }>
  cancel(input: PacCancelInput): Promise<void>
  getStatus(providerDocumentId: string): Promise<PacStatusResult>
  /**
   * Busqueda por serie+folio del emisor - red de seguridad anti doble timbrado
   * cuando un intento anterior murio sin devolver providerDocumentId (timeout).
   * Opcional: null si el provider no la soporta.
   */
  findBySerieFolio?(serie: string, folio: number): Promise<{ uuidFiscal: string; providerDocumentId: string } | null>
}

/**
 * Resuelve el proveedor configurado del tenant (API key descifrada). Lanza
 * PacNotConfiguredError si falta configuracion - los endpoints la traducen a
 * 422 con mensaje accionable. El provider 'lab' (laboratorio local, sin PAC
 * externo) solo funciona con sandbox=true: una organizacion en modo
 * produccion jamas puede emitir documentos simulados por accidente.
 */
export async function getPacProvider(tenantId: string): Promise<PacProvider> {
  const settings = await getFullPacSettings(tenantId)
  switch (settings.provider) {
    case 'facturapi':
      return new FacturapiProvider({ apiKey: settings.apiKey })
    case 'lab':
      if (!settings.sandbox) {
        throw new PacNotConfiguredError('El laboratorio local solo funciona en modo pruebas; cambia el modo o configura un PAC real')
      }
      return new MockLabProvider()
    default:
      throw new PacNotConfiguredError(`Proveedor PAC no soportado: ${settings.provider}`)
  }
}

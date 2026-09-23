import type {
  PacCancelInput,
  PacPaymentStampInput,
  PacProvider,
  PacStampInput,
  PacStampResult,
  PacStatusResult
} from '~/server/utils/pac/provider'
import { PacProviderError } from '~/server/utils/pac/provider'

// Adaptador Facturapi (API v2) - primer proveedor del
// dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md, fase B). Auth: Bearer
// token. Las API keys de prueba de Facturapi timbran en Test con la MISMA base
// URL - el prefijo sk_test_ determina el ambiente y el flag
// sandbox de tenant_pac_settings es informativo/para la UI, el modo real lo
// determina la key.
//
// IMPORTANTE (fase D): el mapeo del body y los paths de la respuesta estan
// escritos contra la documentacion publica de Facturapi v2 y quedan
// PENDIENTES DE VERIFICACION contra el sandbox real antes de dar la fase por
// buena. Todo lo incierto esta aislado en toFacturapiBody() y parseStamp
// Response() - si el sandbox muestra otra forma, se ajustan SOLO esas dos
// funciones sin tocar interfaz, endpoints ni motor de timbrado.
//
// Seguridad: nunca incluir la API key en mensajes de error ni en logs (el
// logger estructurado de Nitro loggea statusMessage - mantenerlo libre de
// credenciales y de bodies de respuesta crudos).

const BASE_URL = 'https://www.facturapi.io'
const TIMEOUT_MS = 30_000

async function requestJson(method: string, url: string, apiKey: string, body?: unknown): Promise<{ status: number; data: any }> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    // Red/timeout: NO sabemos si el PAC timbro - retryable a nivel HTTP pero
    // la fase D debe resolver por getStatus antes de reintentar (nunca a ciegas).
    throw new PacProviderError(`No se pudo contactar a Facturapi (${(err as Error).message})`, true)
  }
  let data: any = null
  try {
    data = await response.json()
  } catch {
    // respuesta sin JSON (502 de proxy, etc.) - data queda null
  }
  return { status: response.status, data }
}

function describeError(status: number, data: any): string {
  if (status === 401 || status === 403) return 'Credenciales de Facturapi rechazadas (401/403)'
  const raw = data?.message ?? (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.message ?? JSON.stringify(e)).join('; ') : null)
  return typeof raw === 'string' && raw ? raw.slice(0, 500) : `Facturapi respondio ${status}`
}

/** Mapeo CFDI 4.0 neutro -> body Facturapi v2 (ver nota de verificacion arriba). */
function toFacturapiBody(input: PacStampInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: input.tipo,
    customer: {
      legal_name: input.receptor.nombre,
      tax_id: input.receptor.rfc,
      tax_system: input.receptor.regimenFiscal,
      address: { zip: input.receptor.codigoPostal, country: 'MEX' },
      ...(input.receptor.correo ? { email: input.receptor.correo } : {})
    },
    items: input.conceptos.map((c) => ({
      quantity: c.cantidad,
      product: {
        description: c.descripcion,
        product_key: c.claveProdServ,
        price: c.valorUnitario,
        unit_key: c.claveUnidad,
        tax_included: false,
        ...(c.descuento > 0 ? { discount: c.descuento } : {}),
        taxes: [
        ...c.traslados.map((t) => ({ type: t.clave === '003' ? 'IEPS' : 'IVA', rate: t.tasaOCuota, withholding: false })),
        ...c.retenciones.map((t) => ({ type: t.clave === '003' ? 'IEPS' : 'IVA', rate: t.tasaOCuota, withholding: true }))
        ]
      }
    })),
    use: input.usoCfdi,
    payment_form: input.formaPago ?? '99',
    payment_method: input.metodoPago,
    currency: input.moneda,
    ...(input.tipoCambio != null ? { exchange_rate: input.tipoCambio } : {}),
    series: input.serie,
    folio_number: input.folio,
    ...(input.exportacion !== '01' ? { exportation: input.exportacion } : {})
  }
  if (input.relacionado) {
    body.related = { uuid: input.relacionado.uuidFiscal, relationship: input.relacionado.tipoRelacion }
  }
  return body
}

async function downloadBuffer(url: string, apiKey: string, what: string): Promise<Buffer> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw new PacProviderError(`No se pudo descargar el ${what} timbrado (${(err as Error).message})`, true)
  }
  if (!response.ok) {
    throw new PacProviderError(`Facturapi respondio ${response.status} al descargar el ${what}`, true)
  }
  return Buffer.from(await response.arrayBuffer())
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class FacturapiProvider implements PacProvider {
  readonly name = 'facturapi'

  constructor(private readonly config: { apiKey: string }) {}

  async verifyCredentials(): Promise<{ ok: boolean; message: string }> {
    try {
      // Las llaves de organización (sk_test_/sk_live_) solo pueden consultar
      // su propia organización en /me. El listado /organizations requiere una
      // User Key (sk_user_); aceptar ambas facilita la configuración inicial.
      const endpoint = this.config.apiKey.startsWith('sk_user_')
        ? `${BASE_URL}/v2/organizations`
        : `${BASE_URL}/v2/organizations/me`
      const { status, data } = await requestJson('GET', endpoint, this.config.apiKey)
      if (status === 200) {
        const org = Array.isArray(data) ? data[0] : data?.data?.[0] ?? data
        const nombre = org?.legal_name ?? org?.name
        return { ok: true, message: nombre ? `Conectado con Facturapi (${nombre})` : 'Conectado con Facturapi' }
      }
      return { ok: false, message: describeError(status, data) }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  async stamp(input: PacStampInput): Promise<PacStampResult> {
    const { status, data } = await requestJson('POST', `${BASE_URL}/v2/invoices`, this.config.apiKey, toFacturapiBody(input))
    if (status !== 200 && status !== 201) {
      throw new PacProviderError(describeError(status, data), status >= 500)
    }
    return await this.parseStampResponse(data)
  }

  /**
   * Complemento de pagos 2.0 (fase E). VERIFICAR CONTRA SANDBOX: el endpoint y
   * el mapeo del body son los documentados publicamente para complementos en
   * Facturapi v2, pero al escribir esto la docs no fue alcanzable; si el
   * sandbox muestra otra forma, se ajusta SOLO esta funcion (el motor, los
   * documentos P y cfdi_payment_docs no cambian).
   */
  async stampPayment(input: PacPaymentStampInput): Promise<PacStampResult> {
    const body = {
      type: 'payment',
      folio: { series: input.serie, number: input.folio },
      receiver: {
        taxId: input.receptor.rfc,
        legalName: input.receptor.nombre,
        zip: input.receptor.codigoPostal,
        taxSystem: input.receptor.regimenFiscal,
        ...(input.receptor.correo ? { email: input.receptor.correo } : {})
      },
      payment: {
        date: input.fechaPago.toISOString(),
        form: input.formaPago,
        currency: input.moneda,
        total: input.montoTotal
      },
      related_documents: input.doctos.map((d) => ({
        uuid: d.uuidFiscal,
        series: d.serie,
        folio: d.folio,
        currency: d.monedaDr,
        ...(d.tipoCambioDr != null ? { exchange_rate: d.tipoCambioDr } : {}),
        ...(d.numParcialidad != null ? { installment: d.numParcialidad } : {}),
        last_balance: d.impSaldoAnt,
        paid: d.impPagado,
        new_balance: d.impSaldoIns
      }))
    }
    const { status, data } = await requestJson('POST', `${BASE_URL}/v2/invoices`, this.config.apiKey, body)
    if (status !== 200 && status !== 201) {
      throw new PacProviderError(describeError(status, data), status >= 500)
    }
    return await this.parseStampResponse(data)
  }

  async fetchBinaries(providerDocumentId: string): Promise<{ xml: Buffer; pdf: Buffer }> {
    const { status, data } = await requestJson('GET', `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}`, this.config.apiKey)
    if (status !== 200) throw new PacProviderError(describeError(status, data), status >= 500)
    const xmlUrl = data?.documents?.xml ?? data?.files?.xml ?? `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}/xml`
    const pdfUrl = data?.documents?.pdf ?? data?.files?.pdf ?? `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}/pdf`
    const [xml, pdf] = await Promise.all([
      downloadBuffer(xmlUrl, this.config.apiKey, 'XML'),
      downloadBuffer(pdfUrl, this.config.apiKey, 'PDF')
    ])
    return { xml, pdf }
  }

  /** VERIFICAR CONTRA SANDBOX (fase D): parametros de filtrado por serie+folio. */
  async findBySerieFolio(serie: string, folio: number): Promise<{ uuidFiscal: string; providerDocumentId: string } | null> {
    const params = new URLSearchParams({ series: serie, folio: String(folio) })
    const { status, data } = await requestJson('GET', `${BASE_URL}/v2/invoices?${params.toString()}`, this.config.apiKey)
    if (status !== 200) return null
    const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
    const match = items.find((i: any) => typeof i?.uuid === 'string' && i.uuid)
    if (!match) return null
    return { uuidFiscal: match.uuid, providerDocumentId: String(match._id ?? '') }
  }

  private async parseStampResponse(data: any): Promise<PacStampResult> {
    let responseData = data
    let uuidFiscal = typeof responseData?.uuid === 'string' && responseData.uuid ? responseData.uuid : null
    let providerDocumentId = typeof responseData?.id === 'string' ? responseData.id : typeof responseData?._id === 'string' ? responseData._id : null
    // Facturapi puede responder 202/pending: el CFDI se está recuperando y
    // todavía no trae UUID. Consultamos el recurso creado antes de declarar
    // fallo; la API documenta que el intento asíncrono puede tardar.
    if (!uuidFiscal && providerDocumentId) {
      for (let attempt = 0; attempt < 10 && !uuidFiscal; attempt++) {
        await sleep(1500)
        const current = await requestJson('GET', `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}`, this.config.apiKey)
        if (current.status >= 200 && current.status < 300 && current.data) {
          responseData = current.data
          uuidFiscal = typeof responseData.uuid === 'string' && responseData.uuid ? responseData.uuid : null
          if (responseData.status === 'failed') break
        }
      }
    }
    if (!uuidFiscal || !providerDocumentId) {
      throw new PacProviderError(responseData?.status === 'failed' ? 'Facturapi marcó el comprobante como fallido' : 'Facturapi aún no devolvió el UUID fiscal del timbrado', true)
    }
    const xmlUrl = responseData?.documents?.xml ?? responseData?.files?.xml ?? `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}/xml`
    const pdfUrl = responseData?.documents?.pdf ?? responseData?.files?.pdf ?? `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}/pdf`
    // Descarga en paralelo; si una falla el error es retryable y la fase D
    // resuelve por getStatus + re-descarga (el timbrado YA ocurrio, el folio
    // y el uuid estan del lado del PAC - nunca re-timbrar a ciegas).
    const [xml, pdf] = await Promise.all([
      downloadBuffer(xmlUrl, this.config.apiKey, 'XML'),
      downloadBuffer(pdfUrl, this.config.apiKey, 'PDF')
    ])
    const fechaRaw = responseData?.stamp?.date ?? responseData?.stamp?.fecha ?? responseData?.date ?? responseData?.created_at
    return {
      uuidFiscal,
      providerDocumentId,
      fechaTimbrado: fechaRaw ? new Date(fechaRaw) : new Date(),
      xml,
      pdf
    }
  }

  async cancel(input: PacCancelInput): Promise<void> {
    // La validacion de motivo 01 + folioSustitucion vive en el motor
    // (cfdi/timbrado.ts); aca solo se transmite lo que el motor ya valido.
    const params = new URLSearchParams({ motive: input.motivo })
    if (input.folioSustitucion) params.set('substitute', input.folioSustitucion)
    const { status, data } = await requestJson(
      'DELETE',
      `${BASE_URL}/v2/invoices/${encodeURIComponent(input.providerDocumentId)}?${params.toString()}`,
      this.config.apiKey
    )
    if (status !== 200 && status !== 204) {
      throw new PacProviderError(describeError(status, data), status >= 500)
    }
  }

  async getStatus(providerDocumentId: string): Promise<PacStatusResult> {
    const { status, data } = await requestJson('GET', `${BASE_URL}/v2/invoices/${encodeURIComponent(providerDocumentId)}`, this.config.apiKey)
    if (status === 404) return { state: 'desconocido', uuidFiscal: null, raw: data }
    if (status !== 200) throw new PacProviderError(describeError(status, data), status >= 500)
    const canceled = Boolean(data?.canceled) || data?.status === 'canceled'
    const uuidFiscal = typeof data?.uuid === 'string' ? data.uuid : null
    return {
      state: canceled ? 'cancelado' : uuidFiscal ? 'vigente' : 'en_proceso',
      uuidFiscal,
      raw: { status: data?.status, canceled: Boolean(data?.canceled) }
    }
  }
}

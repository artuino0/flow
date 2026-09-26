import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type * as CfdiDocumentsModule from '../../server/utils/cfdiDocuments'
import type * as TimbradoModule from '../../server/utils/cfdi/timbrado'
import { getStoredObject, setStoredObjectAdapter, type StoredObjectAdapter } from '../../server/utils/objectStorage'
import type {
  PacCancelInput,
  PacPaymentStampInput,
  PacProvider,
  PacStampInput,
  PacStampResult,
  PacStatusResult,
  PacProviderError as PacProviderErrorType
} from '../../server/utils/pac/provider'

// OJO: CERO imports de valor de módulos del server en el tope del archivo —
// cualquier import estático carga server/db ANTES de que beforeAll fije
// APP_DATABASE_URL y el cliente queda apuntando a la base de desarrollo
// (localhost:5433). PacProviderError se captura dinámicamente en beforeAll.
let PacProviderError: typeof PacProviderErrorType

// Fases D/F/G de DOCS/HU_Timbrado_CFDI_PAC.md: el motor de timbrado contra
// Postgres real + disco temporal, con un PacProvider FALSO inyectado (la
// interfaz existe justo para esto — el endpoint real usa getPacProvider).
// Cubre las reglas de oro del motor: validación antes de consumir folio,
// folio consumido-vs-reutilizado según el tipo de fallo, adopción vía
// getStatus (anti doble timbrado tras crash), inmutabilidad del timbrado,
// cancelación SAT con motivo 01+sustituto y binarios a disco.

const TENANT = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let storageDir: string
let docs: typeof CfdiDocumentsModule
let timbrado: typeof TimbradoModule

let serieI: string
let serieCancel: string

class FakeProvider implements PacProvider {
  readonly name = 'fake'
  stampCalls = 0
  stampPaymentCalls = 0
  cancelCalls = 0
  getStatusCalls = 0
  lastStampInput: PacStampInput | null = null
  lastPaymentInput: PacPaymentStampInput | null = null
  mode: 'ok' | 'fail' = 'ok'
  failRetryable = false
  statusResponse: PacStatusResult = { state: 'vigente', uuidFiscal: 'ADOPTED-0000-0000-0000-000000000000' }

  async verifyCredentials() { return { ok: true, message: 'fake' } }
  async stamp(input: PacStampInput): Promise<PacStampResult> {
    this.stampCalls++
    this.lastStampInput = input
    if (this.mode === 'fail') throw new PacProviderError('CFDI20048: No se pudo timbrar (fake)', this.failRetryable)
    return { uuidFiscal: randomUUID().toUpperCase(), providerDocumentId: `prov-${this.stampCalls}`, fechaTimbrado: new Date(), xml: Buffer.from('<xml fake/>'), pdf: Buffer.from('%PDF fake') }
  }
  async stampPayment(input: PacPaymentStampInput): Promise<PacStampResult> {
    this.stampPaymentCalls++
    this.lastPaymentInput = input
    if (this.mode === 'fail') throw new PacProviderError('Complemento rechazado (fake)', this.failRetryable)
    return { uuidFiscal: randomUUID().toUpperCase(), providerDocumentId: `prov-p-${this.stampPaymentCalls}`, fechaTimbrado: new Date(), xml: Buffer.from('<xml pago fake/>'), pdf: Buffer.from('%PDF pago fake') }
  }
  async fetchBinaries() { return { xml: Buffer.from('<xml adoptado/>'), pdf: Buffer.from('%PDF adoptado') } }
  async cancel(_input: PacCancelInput) { this.cancelCalls++ }
  async getStatus() { this.getStatusCalls++; return this.statusResponse }
  async findBySerieFolio() { return null }
}

const receptorOk = { rfc: 'XAXX010101000', nombre: 'Empacadora del Norte SA de CV', codigoPostal: '64000', regimenFiscal: '601', correo: 'compras@norte.mx' }

function conceptoIva16(cantidad = 2, valorUnitario = 100) {
  return {
    claveProdServ: '10101010',
    claveUnidad: 'H87',
    cantidad,
    descripcion: 'Caja de aguacate Hass',
    valorUnitario,
    descuento: 0,
    traslado: { clave: '002' as const, tipoFactor: 'Tasa' as const, tasa: 0.16 },
    retencion: null
  }
}

async function createDoc(overrides: Record<string, unknown> = {}) {
  const parsed = docs.documentoCreateSchema.parse({
    serieId: serieI,
    tipo: 'I',
    receptor: receptorOk,
    usoCfdi: 'G01',
    formaPago: '03',
    metodoPago: 'PUE',
    moneda: 'MXN',
    exportacion: '01',
    descuentoDocumento: 0,
    conceptos: [conceptoIva16()],
    ...overrides
  })
  return docs.createDocument(TENANT, null, parsed)
}

async function eventTipos(documentId: string): Promise<string[]> {
  const detail = await docs.getDocumentDetail(TENANT, documentId)
  return detail.events.map((e) => e.tipo)
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name, country) values (${TENANT}, 'Empacadora A', 'MX')`
  // Datos fiscales del emisor (ERD-62) — snapshotEmisor los exige
  await admin`update tenants set fiscal_data = ${admin.json({ razonSocial: 'Empacadora A SA de CV', rfc: 'EMP010101AAA', regimenFiscal: '601', codigoPostal: '20110' })} where id = ${TENANT}`

  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-cfdi-timbrado-'))
  process.env.FILES_STORAGE_DIR = storageDir
  // SMTP deliberadamente ausente: el test de correo espera SmtpNotConfigured
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) delete process.env[key]
  process.env.APP_DATABASE_URL = testDb.appUrl

  ;({ PacProviderError } = await import('../../server/utils/pac/provider'))
  docs = await import('../../server/utils/cfdiDocuments')
  timbrado = await import('../../server/utils/cfdi/timbrado')
  const s1 = await docs.createSerie(TENANT, { serie: 'A', tipoComprobante: 'I', lugarExpedicion: '20110' })
  serieI = s1.id
  const s2 = await docs.createSerie(TENANT, { serie: 'C', tipoComprobante: 'I', lugarExpedicion: '20110' })
  serieCancel = s2.id
}, 60_000)

afterAll(async () => {
  await admin.end()
  fs.rmSync(storageDir, { recursive: true, force: true })
  delete process.env.FILES_STORAGE_DIR
  await testDb.stop()
})

describe('stampDocument: camino feliz', () => {
  it('timbra, consume folio, guarda binarios y deja auditoría', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    const res = await timbrado.stampDocument(TENANT, id, null, provider)

    expect(res.estado).toBe('timbrada')
    expect(res.folio).toBe(1)
    expect(res.uuidFiscal).toBeTruthy()
    expect(provider.stampCalls).toBe(1)
    // payload armado por el builder
    expect(provider.lastStampInput?.emisor.rfc).toBe('EMP010101AAA')
    expect(provider.lastStampInput?.receptor.rfc).toBe('XAXX010101000')
    expect(provider.lastStampInput?.folio).toBe(1)
    expect(provider.lastStampInput?.conceptos[0]?.traslados[0]?.importe).toBe(32)

    const detail = await docs.getDocumentDetail(TENANT, id)
    expect(detail.documento.uuidFiscal).toBe(res.uuidFiscal)
    expect(detail.documento.xmlStorageKey).toBeTruthy()
    expect(detail.documento.xmlStorageKey).toMatch(new RegExp(`^tenants/${TENANT}/cfdi/`))
    expect((await getStoredObject(detail.documento.xmlStorageKey!)).toString('utf8')).toBe('<xml fake/>')
    expect((await timbrado.loadCfdiBinary(TENANT, id, 'pdf'))?.body.toString('utf8')).toBe('%PDF fake')
    expect(await eventTipos(id)).toEqual(expect.arrayContaining(['folio_asignado', 'intento_timbrado', 'timbrado_ok']))

    const [serie] = await admin`select next_folio from cfdi_series where id = ${serieI}`
    expect(serie.next_folio).toBe(2)
  })

  it('guarda y lee XML/PDF mediante el adaptador remoto en memoria sin borrar los CFDI', async () => {
    const objects = new Map<string, Buffer>()
    const adapter: StoredObjectAdapter = {
      async put({ key, body }) { objects.set(key, Buffer.from(body)) },
      async get(key) { const body = objects.get(key); if (!body) throw new Error('missing'); return Buffer.from(body) },
      async delete(key) { objects.delete(key) }
    }
    setStoredObjectAdapter(adapter)
    try {
      const { id } = await createDoc()
      await timbrado.stampDocument(TENANT, id, null, new FakeProvider())
      expect((await timbrado.loadCfdiBinary(TENANT, id, 'xml'))?.body.toString()).toBe('<xml fake/>')
      expect((await timbrado.loadCfdiBinary(TENANT, id, 'pdf'))?.body.toString()).toBe('%PDF fake')
      expect(objects.size).toBe(2)
    } finally { setStoredObjectAdapter(null) }
  })

  it('doble timbrado: 409 sin volver a llamar al PAC', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    await timbrado.stampDocument(TENANT, id, null, provider)
    await expect(timbrado.stampDocument(TENANT, id, null, provider)).rejects.toThrow(/ya está timbrado/)
    expect(provider.stampCalls).toBe(1)
  })

  it('validación ANTES de consumir folio: receptor incompleto no gasta secuencia', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc({ receptor: { ...receptorOk, rfc: '' } })
    await expect(timbrado.stampDocument(TENANT, id, null, provider)).rejects.toThrow(/RFC del receptor/)
    expect(provider.stampCalls).toBe(0)
    const detail = await docs.getDocumentDetail(TENANT, id)
    expect(detail.documento.folio).toBeNull()
    expect(detail.documento.estado).toBe('borrador')
    expect(detail.events).toHaveLength(0)
  })

  it('emisor sin datos fiscales: error claro que manda a Ajustes, sin consumir folio', async () => {
    const provider = new FakeProvider()
    await admin`update tenants set fiscal_data = '{}' where id = ${TENANT}`
    const { id } = await createDoc()
    await expect(timbrado.stampDocument(TENANT, id, null, provider)).rejects.toThrow(/datos fiscales del emisor/)
    await admin`update tenants set fiscal_data = ${admin.json({ razonSocial: 'Empacadora A SA de CV', rfc: 'EMP010101AAA', regimenFiscal: '601', codigoPostal: '20110' })} where id = ${TENANT}`
  })
})

describe('stampDocument: fallo del PAC y reutilización de folio', () => {
  it('error del PAC → estado error + mensaje; el reintento REUTILIZA el mismo folio', async () => {
    const provider = new FakeProvider()
    provider.mode = 'fail'
    const { id } = await createDoc({ serieId: serieCancel })
    await expect(timbrado.stampDocument(TENANT, id, null, provider)).rejects.toThrow(/CFDI20048/)

    let detail = await docs.getDocumentDetail(TENANT, id)
    expect(detail.documento.estado).toBe('error')
    expect(detail.documento.mensajePac).toContain('CFDI20048')
    expect(detail.documento.folio).toBe(1)
    expect(await eventTipos(id)).toEqual(expect.arrayContaining(['folio_asignado', 'error_pac']))

    provider.mode = 'ok'
    const res = await timbrado.stampDocument(TENANT, id, null, provider)
    expect(res.estado).toBe('timbrada')
    expect(res.folio).toBe(1) // mismo folio: el PAC rechazó, nunca existió ese CFDI
    const [serie] = await admin`select next_folio from cfdi_series where id = ${serieCancel}`
    expect(serie.next_folio).toBe(2) // consumido UNA sola vez
  })
})

describe('stampDocument: recovery anti doble timbrado', () => {
  it('con pacDocumentId previo, verifica getStatus y ADOPTA el timbrado sin volver a stampar', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    await timbrado.stampDocument(TENANT, id, null, provider) // folio 2 de la serie A

    // Simula crash post-timbrado: otro documento con intento muerto del lado PAC
    // (folio 90 a mano: libre, sin chocar con el unique (tenant, serie, folio))
    const { id: crashed } = await createDoc()
    await admin`update cfdi_documents set estado = 'timbrando', folio = 90, pac_document_id = 'prov-crash' where id = ${crashed}`
    const [serieBefore] = await admin`select next_folio from cfdi_series where id = ${serieI}`

    const stampsBefore = provider.stampCalls
    const res = await timbrado.stampDocument(TENANT, crashed, null, provider)
    expect(res.estado).toBe('timbrada')
    expect(res.uuidFiscal).toBe('ADOPTED-0000-0000-0000-000000000000')
    expect(provider.stampCalls).toBe(stampsBefore) // NO se volvió a timbrar
    expect(provider.getStatusCalls).toBe(1)
    const detail = await docs.getDocumentDetail(TENANT, crashed)
    expect(await eventTipos(crashed)).toEqual(expect.arrayContaining(['verificacion_getstatus', 'timbrado_ok']))
    expect(fs.readFileSync(path.join(storageDir, detail.documento.xmlStorageKey!), 'utf8')).toBe('<xml adoptado/>')
    const [serieAfter] = await admin`select next_folio from cfdi_series where id = ${serieI}`
    expect(serieAfter.next_folio).toBe(serieBefore.next_folio) // sin folio nuevo
  })

  it('si el PAC reporta cancelado, no se puede volver a timbrar', async () => {
    const provider = new FakeProvider()
    provider.statusResponse = { state: 'cancelado', uuidFiscal: null }
    const { id } = await createDoc()
    await admin`update cfdi_documents set estado = 'error', folio = 91, pac_document_id = 'prov-x' where id = ${id}`
    await expect(timbrado.stampDocument(TENANT, id, null, provider)).rejects.toThrow(/cancelado/)
  })
})

describe('cancelDocument (fase F)', () => {
  it('motivo 03: timbrada → cancelada con eventos de solicitud y confirmación', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    await timbrado.stampDocument(TENANT, id, null, provider)
    const res = await timbrado.cancelDocument(TENANT, id, null, provider, { motivo: '03' })
    expect(res.estado).toBe('cancelada')
    expect(provider.cancelCalls).toBe(1)
    expect(await eventTipos(id)).toEqual(expect.arrayContaining(['cancelacion_solicitada', 'cancelacion_confirmada']))
  })

  it('motivo 01 exige UUID sustituto que exista timbrado en el tenant', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    await timbrado.stampDocument(TENANT, id, null, provider)

    await expect(timbrado.cancelDocument(TENANT, id, null, provider, { motivo: '01' })).rejects.toThrow(/sustituto/)
    await expect(timbrado.cancelDocument(TENANT, id, null, provider, { motivo: '01', folioSustitucion: randomUUID() })).rejects.toThrow(/no existe o no está timbrado/)

    // sustituto válido: otra factura timbrada
    const { id: sustituto } = await createDoc()
    const stamp = await timbrado.stampDocument(TENANT, sustituto, null, provider)
    const res = await timbrado.cancelDocument(TENANT, id, null, provider, { motivo: '01', folioSustitucion: stamp.uuidFiscal! })
    expect(res.estado).toBe('cancelada')
  })

  it('borrador no se cancela (409) y el PAC no se llama', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    await expect(timbrado.cancelDocument(TENANT, id, null, provider, { motivo: '03' })).rejects.toThrow(/Solo se cancela/)
    expect(provider.cancelCalls).toBe(0)
  })
})

describe('sendCfdiEmail (fase G)', () => {
  it('sin SMTP configurado: error accionable, no 500', async () => {
    const provider = new FakeProvider()
    const { id } = await createDoc()
    await timbrado.stampDocument(TENANT, id, null, provider)
    await expect(timbrado.sendCfdiEmail(TENANT, id, 'compras@norte.mx')).rejects.toThrow(/correo saliente/i)
  })

  it('documento no timbrado no se envía', async () => {
    const { id } = await createDoc()
    await expect(timbrado.sendCfdiEmail(TENANT, id, 'x@y.mx')).rejects.toThrow(/Solo se envía/)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { adminRecordTest } from '../helpers/recordActorFixture'
import type * as CfdiDocumentsModule from '../../server/utils/cfdiDocuments'
import type * as ComplementoModule from '../../server/utils/cfdi/complementoPagos'
import type * as TimbradoModule from '../../server/utils/cfdi/timbrado'
import type { PacProvider, PacPaymentStampInput, PacStampInput, PacStampResult, PacProviderError as PacProviderErrorType } from '../../server/utils/pac/provider'

// OJO: CERO imports de valor de módulos del server en el tope del archivo —
// cualquier import estático carga server/db ANTES de que beforeAll fije
// APP_DATABASE_URL y el cliente queda apuntando a la base de desarrollo
// (localhost:5433). PacProviderError se captura dinámicamente en beforeAll.
let PacProviderError: typeof PacProviderErrorType

// Fase E de DOCS/HU_Timbrado_CFDI_PAC.md: el complemento de pagos 2.0 nace de
// un cobro APLICADO del mundo dinámico (cobros_cliente + aplicaciones_cobro),
// y cada aplicación debe apuntar a una CxC con factura tipo I TIMBRADA en el
// dominio fijo, vinculada por source_record_id. Postgres real + provider fake.

const TENANT = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let storageDir: string
let docs: typeof CfdiDocumentsModule
let complementoMod: typeof ComplementoModule
let timbrado: typeof TimbradoModule

let serieI: string
let serieP: string
let entityCobros: string
let entityAplicaciones: string
let entityCxc: string

class FakeProvider implements PacProvider {
  readonly name = 'fake'
  stampCalls = 0
  stampPaymentCalls = 0
  lastPaymentInput: PacPaymentStampInput | null = null
  mode: 'ok' | 'fail' = 'ok'
  async verifyCredentials() { return { ok: true, message: 'fake' } }
  async stamp(_input: PacStampInput): Promise<PacStampResult> {
    this.stampCalls++
    return { uuidFiscal: randomUUID().toUpperCase(), providerDocumentId: `prov-${this.stampCalls}`, fechaTimbrado: new Date(), xml: Buffer.from('<xml/>'), pdf: Buffer.from('%PDF') }
  }
  async stampPayment(input: PacPaymentStampInput): Promise<PacStampResult> {
    this.stampPaymentCalls++
    this.lastPaymentInput = input
    if (this.mode === 'fail') throw new PacProviderError('Complemento rechazado (fake)')
    return { uuidFiscal: randomUUID().toUpperCase(), providerDocumentId: `prov-p-${this.stampPaymentCalls}`, fechaTimbrado: new Date(), xml: Buffer.from('<xml pago/>'), pdf: Buffer.from('%PDF pago') }
  }
  async fetchBinaries() { return { xml: Buffer.from('<xml/>'), pdf: Buffer.from('%PDF') } }
  async cancel() {}
  async getStatus() { return { state: 'vigente' as const, uuidFiscal: null } }
}

const receptorOk = { rfc: 'XAXX010101000', nombre: 'Empacadora del Norte SA de CV', codigoPostal: '64000', regimenFiscal: '601', correo: null }

function concepto(cantidad: number, valorUnitario = 100) {
  return { claveProdServ: '10101010', claveUnidad: 'H87', cantidad, descripcion: 'Aguacate Hass', valorUnitario, descuento: 0, traslado: { clave: '002' as const, tipoFactor: 'Tasa' as const, tasa: 0.16 }, retencion: null }
}

/** Factura tipo I timbrada (simulada por SQL) vinculada a una CxC dinámica. */
async function facturaTimbrada(cxcRecordId: string, cantidad: number, folio: number) {
  const parsed = docs.documentoCreateSchema.parse({
    serieId: serieI,
    tipo: 'I',
    receptor: receptorOk,
    usoCfdi: 'G01',
    formaPago: null,
    metodoPago: 'PPD', // a crédito: se paga en parcialidades → complemento
    moneda: 'MXN',
    exportacion: '01',
    descuentoDocumento: 0,
    conceptos: [concepto(cantidad)],
    sourceRecordId: cxcRecordId
  })
  const { id } = await docs.createDocument(TENANT, null, parsed)
  await admin`update cfdi_documents set estado = 'timbrada', uuid_fiscal = ${randomUUID().toUpperCase()}, folio = ${folio}, fecha_timbrado = now() where id = ${id}`
  return id
}

async function makeRecord(entityId: string, customData: Record<string, unknown>): Promise<string> {
  const [row] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${entityId}, ${admin.json(customData as never)}) returning id`
  return row.id as string
}

async function makeCobroAplicado(aplicaciones: Array<{ cxcId: string; monto: number }>, extra: Record<string, unknown> = {}) {
  const cobroId = await makeRecord(entityCobros, { folio: 'COB-' + Math.floor(Math.random() * 1e6), fecha: '2026-09-10', monto: aplicaciones.reduce((a, b) => a + b.monto, 0), moneda: 'MXN', estado: 'aplicado', referencia: 'SPEI 123', ...extra })
  for (const app of aplicaciones) {
    await makeRecord(entityAplicaciones, { cobro: cobroId, cuenta_por_cobrar: app.cxcId, fecha: '2026-09-10', monto: app.monto })
  }
  return cobroId
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name, country) values (${TENANT}, 'Empacadora A', 'MX')`
  await admin`update tenants set fiscal_data = ${admin.json({ razonSocial: 'Empacadora A SA de CV', rfc: 'EMP010101AAA', regimenFiscal: '601', codigoPostal: '20110' })} where id = ${TENANT}`

  const e1 = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Cobros de clientes', 'cobros_cliente') returning id`
  entityCobros = e1[0].id as string
  const e2 = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Aplicaciones de cobro', 'aplicaciones_cobro') returning id`
  entityAplicaciones = e2[0].id as string
  const e3 = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Cuentas por cobrar', 'cuentas_por_cobrar') returning id`
  entityCxc = e3[0].id as string

  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-cfdi-complemento-'))
  process.env.FILES_STORAGE_DIR = storageDir
  process.env.APP_DATABASE_URL = testDb.appUrl

  ;({ PacProviderError } = await import('../../server/utils/pac/provider'))
  docs = await import('../../server/utils/cfdiDocuments')
  complementoMod = await import('../../server/utils/cfdi/complementoPagos')
  timbrado = await import('../../server/utils/cfdi/timbrado')
  const s1 = await docs.createSerie(TENANT, { serie: 'A', tipoComprobante: 'I', lugarExpedicion: '20110' })
  serieI = s1.id
  const s2 = await docs.createSerie(TENANT, { serie: 'CP', tipoComprobante: 'P', lugarExpedicion: '20110' })
  serieP = s2.id
}, 60_000)

afterAll(async () => {
  await admin.end()
  fs.rmSync(storageDir, { recursive: true, force: true })
  delete process.env.FILES_STORAGE_DIR
  await testDb.stop()
})

describe('generarComplementoDesdeCobro', () => {
  it('construye el documento P con sus DoctoRelacionado, saldos y parcialidades', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc1 = await makeRecord(entityCxc, { folio: 'CXC-1', total: 1160, moneda: 'MXN', estado: 'vigente' })
    const cxc2 = await makeRecord(entityCxc, { folio: 'CXC-2', total: 580, moneda: 'MXN', estado: 'vigente' })
    await facturaTimbrada(cxc1, 10, 1) // total 1160 (1000 + IVA 160)
    await facturaTimbrada(cxc2, 5, 2) // total 580
    const cobroId = await makeCobroAplicado([{ cxcId: cxc1, monto: 100 }, { cxcId: cxc2, monto: 50 }])

    const { id } = await complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobroId, formaPago: '03' })
    const detail = await docs.getDocumentDetail(TENANT, id)
    expect(detail.documento.tipo).toBe('P')
    expect(detail.documento.estado).toBe('borrador')
    expect(Number(detail.documento.total)).toBe(150)
    expect(detail.documento.metodoPago).toBe('PUE')
    expect(detail.documento.formaPago).toBe('03')
    expect(detail.documento.usoCfdi).toBe('P01')
    expect(detail.documento.receptorRfc).toBe(receptorOk.rfc) // copiado de la factura relacionada
    expect(detail.documento.sourceRecordId).toBe(cobroId)
    expect(detail.conceptos).toHaveLength(0) // el complemento no lleva conceptos
    expect(detail.pagos).toHaveLength(2)

    const porUuid = Object.fromEntries(detail.pagos.map((p) => [p.relacionado.uuidFiscal, p]))
    const montos = detail.pagos.map((p) => Number(p.impPagado)).sort((a, b) => a - b)
    expect(montos).toEqual([50, 100])
    for (const p of detail.pagos) {
      expect(p.numParcialidad).toBe(1)
      expect(p.impSaldoIns).toBeTruthy()
    }
    expect(porUuid).toBeTruthy()

    // Timbrado tipo P con el provider fake
    const provider = new FakeProvider()
    const res = await timbrado.stampDocument(TENANT, id, null, provider)
    expect(res.estado).toBe('timbrada')
    expect(provider.stampPaymentCalls).toBe(1)
    expect(provider.stampCalls).toBe(0) // NO usó el stamp de facturas
    expect(provider.lastPaymentInput?.doctos).toHaveLength(2)
    expect(provider.lastPaymentInput?.montoTotal).toBe(150)
    expect(provider.lastPaymentInput?.formaPago).toBe('03')
  }))

  it('segundo pago parcial: parcialidad 2 y saldo anterior descontado', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc = await makeRecord(entityCxc, { folio: 'CXC-3', total: 1160, moneda: 'MXN' })
    await facturaTimbrada(cxc, 10, 3)
    const cobro1 = await makeCobroAplicado([{ cxcId: cxc, monto: 100 }])
    const { id: p1 } = await complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobro1, formaPago: '03' })
    const cobro2 = await makeCobroAplicado([{ cxcId: cxc, monto: 200 }])
    const { id: p2 } = await complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobro2, formaPago: '03' })

    const d1 = await docs.getDocumentDetail(TENANT, p1)
    const d2 = await docs.getDocumentDetail(TENANT, p2)
    expect(d1.pagos[0].numParcialidad).toBe(1)
    expect(Number(d1.pagos[0].impSaldoAnt)).toBe(1160)
    expect(d2.pagos[0].numParcialidad).toBe(2)
    expect(Number(d2.pagos[0].impSaldoAnt)).toBe(1060) // 1160 − 100 ya documentados
    expect(Number(d2.pagos[0].impSaldoIns)).toBe(860)
  }))

  it('cobro no aplicado: se rechaza', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc = await makeRecord(entityCxc, { folio: 'CXC-4', total: 100 })
    const cobroId = await makeRecord(entityCobros, { fecha: '2026-09-10', monto: 100, moneda: 'MXN', estado: 'borrador' })
    await makeRecord(entityAplicaciones, { cobro: cobroId, cuenta_por_cobrar: cxc, monto: 100 })
    await expect(complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobroId, formaPago: '03' })).rejects.toThrow(/aplicado/)
  }))

  it('CxC sin factura timbrada asociada: error accionable (422)', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc = await makeRecord(entityCxc, { folio: 'CXC-5', total: 100 })
    const cobroId = await makeCobroAplicado([{ cxcId: cxc, monto: 100 }])
    await expect(complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobroId, formaPago: '03' })).rejects.toThrow(/no tiene una factura timbrada/)
  }))

  it('aplicación que excede el saldo pendiente: se rechaza', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc = await makeRecord(entityCxc, { folio: 'CXC-6', total: 116 })
    await facturaTimbrada(cxc, 1, 4) // total 116
    const cobroId = await makeCobroAplicado([{ cxcId: cxc, monto: 5000 }])
    await expect(complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobroId, formaPago: '03' })).rejects.toThrow(/excede el saldo/)
  }))

  it('sin forma de pago (ni en body ni en el método del cobro): se rechaza', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc = await makeRecord(entityCxc, { folio: 'CXC-7', total: 116 })
    await facturaTimbrada(cxc, 1, 5)
    const cobroId = await makeCobroAplicado([{ cxcId: cxc, monto: 50 }])
    await expect(complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobroId })).rejects.toThrow(/forma de pago/)
  }))

  it('serie P explícita de otro tipo: se rechaza', adminRecordTest(() => TENANT, () => admin, async () => {
    const cxc = await makeRecord(entityCxc, { folio: 'CXC-8', total: 116 })
    await facturaTimbrada(cxc, 1, 6)
    const cobroId = await makeCobroAplicado([{ cxcId: cxc, monto: 50 }])
    await expect(complementoMod.generarComplementoDesdeCobro(TENANT, null, { cobroRecordId: cobroId, formaPago: '03', serieId: serieI })).rejects.toThrow(/no es de comprobantes tipo P/)
  }))
})

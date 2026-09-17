import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type * as CfdiDocumentsModule from '../../server/utils/cfdiDocuments'

// Fase C de DOCS/HU_Timbrado_CFDI_PAC.md: CRUD del dominio fiscal fijo contra
// Postgres real. Prueba las garantías que viven en la base y en el dominio:
// totales calculados por el servidor (nunca declarados por el cliente),
// inmutabilidad fiscal (timbrado no se edita ni se borra), validaciones SAT y
// aislamiento RLS entre tenants.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let mod: typeof CfdiDocumentsModule

let serieI: string
let serieE: string

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
  // Por el mismo Zod que usan los endpoints: las validaciones de forma
  // (ClaveProdServ 8 dígitos, RFC, catálogos) viven en el schema.
  const parsed = mod.documentoCreateSchema.parse({
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
  return mod.createDocument(TENANT_A, null, parsed)
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Empacadora A')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Empacadora B')`
  process.env.APP_DATABASE_URL = testDb.appUrl
  mod = await import('../../server/utils/cfdiDocuments')
  const s1 = await mod.createSerie(TENANT_A, { serie: 'A', tipoComprobante: 'I', lugarExpedicion: '20110' })
  serieI = s1.id
  const s2 = await mod.createSerie(TENANT_A, { serie: 'NC', tipoComprobante: 'E', lugarExpedicion: '20110' })
  serieE = s2.id
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('Series fiscales', () => {
  it('crea y lista series; duplicada (misma letra+tipo) se rechaza con 409', async () => {
    const series = await mod.listSeries(TENANT_A)
    expect(series.length).toBe(2)
    expect(series.find((s) => s.serie === 'A')?.nextFolio).toBe(1)
    await expect(mod.createSerie(TENANT_A, { serie: 'A', tipoComprobante: 'I', lugarExpedicion: '20110' })).rejects.toThrow(/Ya existe/)
    // Misma letra, otro tipo: permitido (secuencias independientes)
    const s3 = await mod.createSerie(TENANT_A, { serie: 'A', tipoComprobante: 'P', lugarExpedicion: '20110' })
    expect(s3.id).toBeTruthy()
  })

  it('valida serie (solo mayúsculas/números) y CP de 5 dígitos', () => {
    expect(mod.serieCreateSchema.safeParse({ serie: 'a-1', tipoComprobante: 'I', lugarExpedicion: '20110' }).success).toBe(false)
    expect(mod.serieCreateSchema.safeParse({ serie: 'F2', tipoComprobante: 'I', lugarExpedicion: '2011' }).success).toBe(false)
    const ok = mod.serieCreateSchema.safeParse({ serie: 'f2', tipoComprobante: 'I', lugarExpedicion: '20110' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.serie).toBe('F2') // normaliza a mayúsculas
  })
})

describe('Documentos: creación y totales calculados por el servidor', () => {
  it('crea borrador con totales e impuestos computados (2×100 + IVA 16% = 232)', async () => {
    const { id } = await createDoc()
    const detail = await mod.getDocumentDetail(TENANT_A, id)
    expect(detail.documento.estado).toBe('borrador')
    expect(detail.documento.folio).toBeNull()
    expect(Number(detail.documento.subtotal)).toBe(200)
    expect(Number(detail.documento.total)).toBe(232)
    const traslado = (detail.documento.impuestos as any).traslados[0]
    expect(traslado.impuesto).toBe('002')
    expect(traslado.tasaOCuota).toBe(0.16)
    expect(traslado.importe).toBe(32)
    expect(detail.conceptos).toHaveLength(1)
    expect(detail.serie.serie).toBe('A')
  })

  it('agrupa traslados de varios conceptos por clave/tasa y aplica descuento global', async () => {
    const { id } = await createDoc({
      descuentoDocumento: 32,
      conceptos: [conceptoIva16(1, 100), conceptoIva16(1, 100), { ...conceptoIva16(1, 100), traslado: { clave: '002', tipoFactor: 'Tasa', tasa: 0 } }]
    })
    const detail = await mod.getDocumentDetail(TENANT_A, id)
    // 300 de importe; IVA 16% sobre 200 = 32; tasa 0% sobre 100 = 0; total = 300 - 32(desc global) + 32 = 300
    expect(Number(detail.documento.subtotal)).toBe(300)
    expect(Number(detail.documento.total)).toBe(300)
    const traslados = (detail.documento.impuestos as any).traslados
    expect(traslados).toHaveLength(2) // 16% y 0% agrupados por separado
  })

  it('rechaza serie de otro tipo, ClaveProdServ inválida y uso de CFDI fuera de catálogo', async () => {
    await expect(createDoc({ serieId: serieE })).rejects.toThrow(/tipo E/)
    await expect(createDoc({ conceptos: [{ ...conceptoIva16(), claveProdServ: '123' }] })).rejects.toThrow()
    await expect(createDoc({ usoCfdi: 'ZZZ' })).rejects.toThrow()
  })

  it('tipo E exige CFDI relacionado timbrado; tipo I lo acepta opcionalmente', async () => {
    await expect(createDoc({ serieId: serieE, tipo: 'E', relacionado: null })).rejects.toThrow(/debe relacionar/)

    // factura timbrada (simulada por SQL) para relacionar
    const { id: facturaId } = await createDoc()
    await admin`update cfdi_documents set estado = 'timbrada', uuid_fiscal = ${randomUUID().toUpperCase()}, folio = 900, fecha_timbrado = now() where id = ${facturaId}`
    const { id: notaId } = await createDoc({ serieId: serieE, tipo: 'E', usoCfdi: 'G02', conceptos: [{ ...conceptoIva16(), cantidad: 1 }], relacionado: { documentId: facturaId, tipoRelacion: '01' } })
    const detail = await mod.getDocumentDetail(TENANT_A, notaId)
    expect(detail.documento.tipo).toBe('E')
    expect(detail.relacionado?.id).toBe(facturaId)
    // relacionar un borrador se rechaza
    const { id: otraId } = await createDoc()
    await expect(createDoc({ serieId: serieE, tipo: 'E', relacionado: { documentId: otraId, tipoRelacion: '01' } })).rejects.toThrow(/ya timbrado/)
  })
})

describe('Documentos: inmutabilidad fiscal', () => {
  it('borrador se edita y recalcula totales; timbrado NO (409)', async () => {
    const { id } = await createDoc()
    await mod.updateDocument(TENANT_A, null, id, { conceptos: [conceptoIva16(3, 50)] })
    const detail = await mod.getDocumentDetail(TENANT_A, id)
    expect(Number(detail.documento.subtotal)).toBe(150)
    expect(Number(detail.documento.total)).toBe(174) // 150 + 24 IVA

    await admin`update cfdi_documents set estado = 'timbrada', uuid_fiscal = ${randomUUID().toUpperCase()}, folio = 901 where id = ${id}`
    await expect(mod.updateDocument(TENANT_A, null, id, { observaciones: 'hack' })).rejects.toThrow(/inmutabilidad fiscal/)
  })

  it('borrador sin folio se elimina; timbrado no se elimina nunca', async () => {
    const { id } = await createDoc()
    await mod.deleteDocument(TENANT_A, id)
    await expect(mod.getDocumentDetail(TENANT_A, id)).rejects.toThrow()

    const { id: timbrado } = await createDoc()
    await admin`update cfdi_documents set estado = 'timbrada', uuid_fiscal = ${randomUUID().toUpperCase()}, folio = 902 where id = ${timbrado}`
    await expect(mod.deleteDocument(TENANT_A, timbrado)).rejects.toThrow(/cancelan ante el SAT/)
  })
})

describe('Documentos: listado y RLS', () => {
  it('filtra por estado y busca por folio exacto', async () => {
    const todas = await mod.listDocuments(TENANT_A, { page: 1, pageSize: 50 } as any)
    const timbradas = await mod.listDocuments(TENANT_A, { page: 1, pageSize: 50, estado: 'timbrada' } as any)
    expect(timbradas.total).toBeGreaterThan(0)
    expect(timbradas.total).toBeLessThan(todas.total)
    expect(timbradas.rows.every((r) => r.estado === 'timbrada')).toBe(true)

    const porFolio = await mod.listDocuments(TENANT_A, { page: 1, pageSize: 50, q: '902' } as any)
    expect(porFolio.total).toBe(1)
  })

  it('RLS: el tenant B no ve ni puede leer los documentos del tenant A', async () => {
    const { id } = await createDoc()
    const listaB = await mod.listDocuments(TENANT_B, { page: 1, pageSize: 50 } as any)
    expect(listaB.total).toBe(0)
    await expect(mod.getDocumentDetail(TENANT_B, id)).rejects.toThrow()
    await expect(mod.updateDocument(TENANT_B, null, id, { observaciones: 'x' })).rejects.toThrow()
    await expect(mod.deleteDocument(TENANT_B, id)).rejects.toThrow()
  })
})

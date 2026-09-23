import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type * as CfdiDocumentsModule from '../../server/utils/cfdiDocuments'
import type * as TimbradoModule from '../../server/utils/cfdi/timbrado'
import type * as PacSettingsModule from '../../server/utils/pacSettings'
import type { getPacProvider as GetPacProvider } from '../../server/utils/pac/provider'

// Laboratorio local de CFDI (pedido del usuario, 2026-09-15: "ocupo un lab
// gratuito porque Facturapi me pide registro si o si"). Prueba el provider
// 'lab' de punta a punta SIN ningún servicio externo: getPacProvider lo
// resuelve sin API key, timbra generando UUID/XML/PDF simulados, y el motor
// completo (stampDocument/cancelDocument) funciona igual que con un PAC real.
// Mismos patrones que cfdiTimbrado.test.ts (Postgres real + disco temporal).

const TENANT = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let storageDir: string
let docs: typeof CfdiDocumentsModule
let timbrado: typeof TimbradoModule
let pacSettings: typeof PacSettingsModule
let getPacProvider: typeof GetPacProvider

let serieI: string

const receptorOk = { rfc: 'XAXX010101000', nombre: 'Cliente de Prueba SA de CV', codigoPostal: '64000', regimenFiscal: '601', correo: 'prueba@lab.mx' }

function conceptoIva16() {
  return {
    claveProdServ: '10101010',
    claveUnidad: 'H87',
    cantidad: 2,
    descripcion: 'Caja de aguacate Hass',
    valorUnitario: 100,
    descuento: 0,
    traslado: { clave: '002' as const, tipoFactor: 'Tasa' as const, tasa: 0.16 },
    retencion: null
  }
}

async function createDoc() {
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
    conceptos: [conceptoIva16()]
  })
  return docs.createDocument(TENANT, null, parsed)
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name, country) values (${TENANT}, 'Lab Tenant', 'MX')`
  await admin`update tenants set fiscal_data = ${admin.json({ razonSocial: 'Laboratorio Flow SA de CV', rfc: 'LAB010101AAA', regimenFiscal: '601', codigoPostal: '20110' })} where id = ${TENANT}`

  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-cfdi-lab-'))
  process.env.FILES_STORAGE_DIR = storageDir
  process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key'
  process.env.APP_DATABASE_URL = testDb.appUrl

  docs = await import('../../server/utils/cfdiDocuments')
  timbrado = await import('../../server/utils/cfdi/timbrado')
  pacSettings = await import('../../server/utils/pacSettings')
  ;({ getPacProvider } = await import('../../server/utils/pac/provider'))

  const s = await docs.createSerie(TENANT, { serie: 'LAB', tipoComprobante: 'I', lugarExpedicion: '20110' })
  serieI = s.id
}, 60_000)

afterAll(async () => {
  await admin.end()
  fs.rmSync(storageDir, { recursive: true, force: true })
  delete process.env.FILES_STORAGE_DIR
  delete process.env.SETTINGS_ENCRYPTION_KEY
  await testDb.stop()
})

describe('Laboratorio local: configuración sin secretos', () => {
  it('provider "lab" se guarda sin API key y getPacProvider lo resuelve', async () => {
    await pacSettings.upsertPacSettings(TENANT, null, { provider: 'lab' })
    const summary = await pacSettings.getPacSummary(TENANT)
    expect(summary?.provider).toBe('lab')
    expect(summary?.hasApiKey).toBe(false)
    expect(summary?.sandbox).toBe(true) // lab fuerza sandbox

    const provider = await getPacProvider(TENANT)
    expect(provider.name).toBe('lab')
    const test = await provider.verifyCredentials()
    expect(test.ok).toBe(true)
    expect(test.message).toMatch(/Laboratorio local/i)
  })

  it('el lab queda bloqueado si el tenant pasa a modo producción', async () => {
    await admin`update tenant_pac_settings set sandbox = false where tenant_id = ${TENANT}`
    await expect(getPacProvider(TENANT)).rejects.toThrow(/solo funciona en modo pruebas/)
    await admin`update tenant_pac_settings set sandbox = true where tenant_id = ${TENANT}`
  })
})

describe('Laboratorio local: timbrado simulado de punta a punta', () => {
  it('timbra una factura real del dominio fijo: UUID, XML marcado como lab y PDF válido', async () => {
    const provider = await getPacProvider(TENANT)
    const { id } = await createDoc()
    const res = await timbrado.stampDocument(TENANT, id, null, provider)

    expect(res.estado).toBe('timbrada')
    expect(res.folio).toBe(1)
    expect(res.uuidFiscal).toMatch(/^[0-9A-F-]{36}$/)

    const detail = await docs.getDocumentDetail(TENANT, id)
    expect(detail.documento.pacProvider).toBe('lab')
    expect(detail.documento.emisorRfc).toBe('LAB010101AAA')
    expect(detail.events.map((e) => e.tipo)).toEqual(expect.arrayContaining(['folio_asignado', 'intento_timbrado', 'timbrado_ok']))

    // XML: estructura CFDI 4.0 + marca de laboratorio + datos del documento
    const xmlPath = path.join(storageDir, detail.documento.xmlStorageKey!)
    const xml = fs.readFileSync(xmlPath, 'utf8')
    expect(xml).toContain('LABORATORIO Flow')
    expect(xml).toContain(`UUID="${res.uuidFiscal}"`)
    expect(xml).toContain('Serie="LAB"')
    expect(xml).toContain('Folio="1"')
    expect(xml).toContain('Total="232.00"') // 200 + IVA 32: coherente con el dominio
    expect(xml).toContain('ClaveProdServ="10101010"')
    expect(xml).toContain(receptorOk.rfc)

    // PDF: binario válido (mágico %PDF) y descargable por el motor
    const pdfPath = path.join(storageDir, detail.documento.pdfStorageKey!)
    const pdf = fs.readFileSync(pdfPath)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.subarray(pdf.length - 6).toString()).toContain('%%EOF')

    // Doble timbrado sigue protegido aunque el PAC sea simulado
    await expect(timbrado.stampDocument(TENANT, id, null, provider)).rejects.toThrow(/ya está timbrado/)
  })

  it('el recovery por getStatus funciona con el lab (adopción sin re-timbrar)', async () => {
    const provider = await getPacProvider(TENANT)
    const { id } = await createDoc()
    const first = await timbrado.stampDocument(TENANT, id, null, provider)

    // Simula intento colgado: el documento vuelve a timbrando conservando su pacDocumentId
    await admin`update cfdi_documents set estado = 'timbrando' where id = ${id}`
    const again = await timbrado.stampDocument(TENANT, id, null, provider)
    expect(again.estado).toBe('timbrada')
    expect(again.uuidFiscal).toBe(first.uuidFiscal) // adoptado, no re-timbrado
  })

  it('la cancelación ante el "SAT simulado" funciona igual que con un PAC real', async () => {
    const provider = await getPacProvider(TENANT)
    const { id } = await createDoc()
    await timbrado.stampDocument(TENANT, id, null, provider)
    const res = await timbrado.cancelDocument(TENANT, id, null, provider, { motivo: '03' })
    expect(res.estado).toBe('cancelada')
    const detail = await docs.getDocumentDetail(TENANT, id)
    expect(detail.events.map((e) => e.tipo)).toEqual(expect.arrayContaining(['cancelacion_solicitada', 'cancelacion_confirmada']))
  })
})

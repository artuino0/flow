import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { cfdiDocuments, cfdiEvents, cfdiSeries } from '../../server/db/schema'
import type {
  assignNextFolio as AssignNextFolio,
  CfdiSerieUnavailableError as CfdiSerieUnavailableErrorType
} from '../../server/utils/cfdiFolio'
import type { withTenant as WithTenant } from '../../server/db'

// Dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md, fase A). Prueba contra
// Postgres REAL porque las dos garantias centrales viven en la base: (1) el
// folio atomico por row-lock de cfdi_series (mismo criterio que
// incrementalField.test.ts: un mock de drizzle no simula concurrencia real) y
// (2) el aislamiento RLS por tenant (HU-ERD-12, patron rlsTenantIsolation
// .test.ts) + constraints CHECK/uniques parciales + trigger append-only de
// cfdi_events (migracion 0049).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let assignNextFolio: typeof AssignNextFolio
let CfdiSerieUnavailableError: typeof CfdiSerieUnavailableErrorType
let withTenant: typeof WithTenant

let serieAI: string // tenant A, serie 'A', tipo I
let serieAP: string // tenant A, serie 'A', tipo P (misma letra, otro tipo: secuencias independientes)
let serieBInactiva: string // tenant B, inactiva
let serieAConcurrencia: string // dedicada al test de concurrencia

async function makeSerie(tenantId: string, serie: string, tipo: 'I' | 'E' | 'P', estado = 'activa'): Promise<string> {
  const [row] = await admin`
    insert into cfdi_series (tenant_id, serie, tipo_comprobante, lugar_expedicion, estado)
    values (${tenantId}, ${serie}, ${tipo}, '20110', ${estado})
    returning id
  `
  return row.id as string
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Empacadora A')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Empacadora B')`

  serieAI = await makeSerie(TENANT_A, 'A', 'I')
  serieAP = await makeSerie(TENANT_A, 'A', 'P')
  serieBInactiva = await makeSerie(TENANT_A, 'X', 'I', 'inactiva')

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ assignNextFolio, CfdiSerieUnavailableError } = await import('../../server/utils/cfdiFolio'))
  ;({ withTenant } = await import('../../server/db'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('assignNextFolio: folio atomico por serie (Postgres real)', () => {
  it('asigna folios secuenciales partiendo de 1', async () => {
    const f1 = await withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieAI))
    const f2 = await withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieAI))
    expect(f1).toBe(1)
    expect(f2).toBe(2)
  })

  it('misma letra de serie pero distinto tipo de comprobante = secuencias independientes', async () => {
    const p1 = await withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieAP))
    expect(p1).toBe(1)
    // La serie I ya va en 2 por los tests anteriores; la P arranco en 1.
    const i3 = await withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieAI))
    expect(i3).toBe(3)
  })

  it('bajo concurrencia (15 transacciones paralelas) no duplica ni salta folios', async () => {
    serieAConcurrencia = await makeSerie(TENANT_A, 'C', 'I')
    const results = await Promise.all(
      Array.from({ length: 15 }, () => withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieAConcurrencia)))
    )
    expect(new Set(results).size).toBe(15)
    expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })

  it('serie inexistente lanza CfdiSerieUnavailableError', async () => {
    await expect(withTenant(TENANT_A, (tx) => assignNextFolio(tx, randomUUID()))).rejects.toBeInstanceOf(
      CfdiSerieUnavailableError
    )
  })

  it('serie inactiva no consume folio y lanza error', async () => {
    await expect(withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieBInactiva))).rejects.toBeInstanceOf(
      CfdiSerieUnavailableError
    )
  })

  it('RLS: con el tenant A activo, una serie del tenant B es invisible (no consume folio ajeno)', async () => {
    const serieOtroTenant = await makeSerie(TENANT_B, 'A', 'I')
    await expect(withTenant(TENANT_A, (tx) => assignNextFolio(tx, serieOtroTenant))).rejects.toBeInstanceOf(
      CfdiSerieUnavailableError
    )
    const [row] = await admin`select next_folio from cfdi_series where id = ${serieOtroTenant}`
    expect(row.next_folio).toBe(1) // intacto
  })
})

describe('cfdi_documents: RLS, CHECKs y uniques parciales', () => {
  it('un SELECT sin WHERE tenant_id solo devuelve documentos del tenant activo', async () => {
    await withTenant(TENANT_A, (tx) => tx.insert(cfdiDocuments).values({ tenantId: TENANT_A, serieId: serieAI, tipo: 'I' }))
    await withTenant(TENANT_B, async (tx) => {
      const [serieB] = await tx.insert(cfdiSeries).values({ tenantId: TENANT_B, serie: 'B', tipoComprobante: 'I', lugarExpedicion: '20110' }).returning({ id: cfdiSeries.id })
      await tx.insert(cfdiDocuments).values({ tenantId: TENANT_B, serieId: serieB.id, tipo: 'I' })
    })

    const visiblesA = await withTenant(TENANT_A, (tx) => tx.select({ id: cfdiDocuments.id }).from(cfdiDocuments))
    const total = await admin`select count(*)::int as n from cfdi_documents`
    expect(visiblesA.length).toBeLessThan(total[0].n)
    expect(visiblesA.length).toBeGreaterThan(0)
    // Todo lo visible pertenece al tenant A (comprobado fila por fila).
    for (const row of visiblesA) {
      const [doc] = await admin`select tenant_id from cfdi_documents where id = ${row.id}`
      expect(doc.tenant_id).toBe(TENANT_A)
    }
  })

  it('CHECK de estado: un valor fuera de la maquina de estados se rechaza', async () => {
    await expect(
      admin`insert into cfdi_documents (tenant_id, serie_id, tipo, estado) values (${TENANT_A}, ${serieAI}, 'I', 'inventado')`
    ).rejects.toThrow()
  })

  it('uuid_fiscal: multiples NULL conviven (borradores) pero un UUID duplicado se rechaza', async () => {
    const uuid = randomUUID().toUpperCase()
    await admin`insert into cfdi_documents (tenant_id, serie_id, tipo, uuid_fiscal) values (${TENANT_A}, ${serieAI}, 'I', ${uuid})`
    await admin`insert into cfdi_documents (tenant_id, serie_id, tipo, uuid_fiscal) values (${TENANT_A}, ${serieAI}, 'I', NULL)`
    await expect(
      admin`insert into cfdi_documents (tenant_id, serie_id, tipo, uuid_fiscal) values (${TENANT_A}, ${serieAI}, 'I', ${uuid})`
    ).rejects.toThrow()
  })

  it('folio: dos borradores sin folio conviven; (tenant, serie, folio) duplicado se rechaza', async () => {
    await admin`insert into cfdi_documents (tenant_id, serie_id, tipo, folio) values (${TENANT_A}, ${serieAP}, 'P', 100)`
    await expect(
      admin`insert into cfdi_documents (tenant_id, serie_id, tipo, folio) values (${TENANT_A}, ${serieAP}, 'P', 100)`
    ).rejects.toThrow()
    // Mismo folio 100 en OTRA serie si pasa (la unique es por serie).
    await admin`insert into cfdi_documents (tenant_id, serie_id, tipo, folio) values (${TENANT_A}, ${serieAI}, 'I', 100)`
  })
})

describe('cfdi_events: auditoria append-only (trigger de 0049)', () => {
  it('INSERT funciona; UPDATE y DELETE son rechazados por el trigger', async () => {
    const [doc] = await admin`insert into cfdi_documents (tenant_id, serie_id, tipo) values (${TENANT_A}, ${serieAI}, 'I') returning id`
    const [ev] = await admin`insert into cfdi_events (tenant_id, document_id, tipo, detalle) values (${TENANT_A}, ${doc.id}, 'intento_timbrado', '{}'::jsonb) returning id`

    await expect(admin`update cfdi_events set tipo = 'timbrado_ok' where id = ${ev.id}`).rejects.toThrow(/append-only/)
    await expect(admin`delete from cfdi_events where id = ${ev.id}`).rejects.toThrow(/append-only/)

    const [sigue] = await admin`select tipo from cfdi_events where id = ${ev.id}`
    expect(sigue.tipo).toBe('intento_timbrado')
  })
})

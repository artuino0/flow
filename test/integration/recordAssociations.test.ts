import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

const TENANT = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let withTenant: typeof import('../../server/db').withTenant
let util: typeof import('../../server/utils/recordAssociations')
let periodoDef: string
let selfDef: string
let periodo: string
let emp1: string
let emp2: string
let empDeleted: string
let emp3: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT}, 'T')`
  const [periodos] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Periodos', 'periodos') returning id`
  const [empleados] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Empleados', 'empleados') returning id`
  const rec = async (entityId: string, data: object, deleted = false) => (await admin`insert into records (tenant_id, entity_id, custom_data, deleted_at) values (${TENANT}, ${entityId}, ${admin.json(data as never)}, ${deleted ? new Date() : null}) returning id`)[0]!.id as string
  periodo = await rec(periodos!.id, { nombre: 'Quincena 1' })
  emp1 = await rec(empleados!.id, { nombre: 'Ana' })
  emp2 = await rec(empleados!.id, { nombre: 'Luis' })
  emp3 = await rec(empleados!.id, { nombre: 'Eva' })
  empDeleted = await rec(empleados!.id, { nombre: 'Borrado' }, true)
  const [d1] = await admin`insert into relation_definitions (tenant_id, name, source_entity_id, target_entity_id) values (${TENANT}, 'Periodo - Empleados', ${periodos!.id}, ${empleados!.id}) returning id`
  const [d2] = await admin`insert into relation_definitions (tenant_id, name, source_entity_id, target_entity_id) values (${TENANT}, 'Empleado refiere', ${empleados!.id}, ${empleados!.id}) returning id`
  periodoDef = d1!.id
  selfDef = d2!.id
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ withTenant } = await import('../../server/db'))
  util = await import('../../server/utils/recordAssociations')
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

const link = (relationDefinitionId: string, sourceRecordId: string, targetRecordId: string) =>
  withTenant(TENANT, tx => util.createRecordRelation(tx, { tenantId: TENANT, relationDefinitionId, sourceRecordId, targetRecordId }))

describe('createRecordRelation (Postgres real)', () => {
  it('crea vínculos y rechaza el duplicado', async () => {
    await link(periodoDef, periodo, emp1)
    await link(periodoDef, periodo, emp2)
    await expect(link(periodoDef, periodo, emp1)).rejects.toBeInstanceOf(util.DuplicateRecordRelationError)
    const rows = await admin`select 1 from record_relations where relation_definition_id = ${periodoDef}`
    expect(rows).toHaveLength(2)
  })

  it('serializa peticiones concurrentes idénticas: solo una gana', async () => {
    const results = await Promise.allSettled([link(periodoDef, periodo, emp3), link(periodoDef, periodo, emp3), link(periodoDef, periodo, emp3)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected' && r.reason instanceof util.DuplicateRecordRelationError)).toHaveLength(2)
  })

  it('rechaza registros eliminados, de otro tipo y orientación equivocada', async () => {
    await expect(link(periodoDef, periodo, empDeleted)).rejects.toBeInstanceOf(util.RecordRelationValidationError)
    await expect(link(periodoDef, emp1, periodo)).rejects.toBeInstanceOf(util.RecordRelationValidationError)
  })

  it('relación reflexiva: rechaza auto-vínculo y el vínculo inverso', async () => {
    await expect(link(selfDef, emp1, emp1)).rejects.toBeInstanceOf(util.RecordRelationValidationError)
    await link(selfDef, emp1, emp2)
    await expect(link(selfDef, emp2, emp1)).rejects.toBeInstanceOf(util.DuplicateRecordRelationError)
  })

  it('índice único a nivel de base de datos', async () => {
    await expect(admin`insert into record_relations (tenant_id, relation_definition_id, source_record_id, target_record_id) values (${TENANT}, ${periodoDef}, ${periodo}, ${emp1})`).rejects.toMatchObject({ code: '23505' })
  })
})

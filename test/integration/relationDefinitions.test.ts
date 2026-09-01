import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  listRelationDefinitions as ListRelationDefinitions,
  createRelationDefinition as CreateRelationDefinition,
  updateRelationDefinition as UpdateRelationDefinition,
  deleteRelationDefinition as DeleteRelationDefinition,
  DuplicateRelationNameError as DuplicateRelationNameErrorType,
  RelationEntityNotFoundError as RelationEntityNotFoundErrorType
} from '../../server/utils/relationDefinitions'

// HU-ERD-77: prueba server/utils/relationDefinitions.ts contra un Postgres
// real (embedded-postgres, misma infraestructura de HU-ERD-29) - cierra la
// brecha documentada en ERD-10/ERD-19: hasta esta HU no existia NINGUNA forma
// de crear una fila en relation_definitions (POST /api/relations siempre
// esperaba un relationDefinitionId ya existente, sin decir de donde saldria).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let listRelationDefinitions: typeof ListRelationDefinitions
let createRelationDefinition: typeof CreateRelationDefinition
let updateRelationDefinition: typeof UpdateRelationDefinition
let deleteRelationDefinition: typeof DeleteRelationDefinition
let DuplicateRelationNameError: typeof DuplicateRelationNameErrorType
let RelationEntityNotFoundError: typeof RelationEntityNotFoundErrorType

let productoresId: string
let recepcionesId: string
let entityOtroTenantId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  const [productores] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Productores', 'productores') returning id`
  productoresId = productores.id as string
  const [recepciones] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Recepciones', 'recepciones') returning id`
  recepcionesId = recepciones.id as string

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`
  const [otro] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_B}, 'Clientes', 'clientes') returning id`
  entityOtroTenantId = otro.id as string

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ listRelationDefinitions, createRelationDefinition, updateRelationDefinition, deleteRelationDefinition, DuplicateRelationNameError, RelationEntityNotFoundError } =
    await import('../../server/utils/relationDefinitions'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('relationDefinitions (Postgres real)', () => {
  it('createRelationDefinition crea la definicion y la resuelve con nombres de entidad', async () => {
    const def = await createRelationDefinition(TENANT_A, { name: 'Recepcion pertenece a Productor', sourceEntityId: recepcionesId, targetEntityId: productoresId })
    expect(def).toMatchObject({
      name: 'Recepcion pertenece a Productor',
      sourceEntityId: recepcionesId,
      sourceEntitySlug: 'recepciones',
      targetEntityId: productoresId,
      targetEntitySlug: 'productores',
      linkCount: 0
    })
  })

  it('rechaza un nombre duplicado dentro del mismo tenant', async () => {
    await expect(
      createRelationDefinition(TENANT_A, { name: 'Recepcion pertenece a Productor', sourceEntityId: recepcionesId, targetEntityId: productoresId })
    ).rejects.toBeInstanceOf(DuplicateRelationNameError)
  })

  it('rechaza una entidad que no existe en el tenant (ni la propia ni de otro tenant)', async () => {
    await expect(
      createRelationDefinition(TENANT_A, { name: 'Otra relacion', sourceEntityId: recepcionesId, targetEntityId: randomUUID() })
    ).rejects.toBeInstanceOf(RelationEntityNotFoundError)

    await expect(
      createRelationDefinition(TENANT_A, { name: 'Otra relacion mas', sourceEntityId: recepcionesId, targetEntityId: entityOtroTenantId })
    ).rejects.toBeInstanceOf(RelationEntityNotFoundError)
  })

  it('permite origen y destino iguales (relacion de una entidad consigo misma)', async () => {
    const def = await createRelationDefinition(TENANT_A, { name: 'Productor referido por Productor', sourceEntityId: productoresId, targetEntityId: productoresId })
    expect(def.sourceEntityId).toBe(productoresId)
    expect(def.targetEntityId).toBe(productoresId)
  })

  it('listRelationDefinitions filtra por entityId (origen O destino) y no cruza tenants', async () => {
    const all = await listRelationDefinitions(TENANT_A)
    expect(all.length).toBeGreaterThanOrEqual(2)

    const forProductores = await listRelationDefinitions(TENANT_A, productoresId)
    expect(forProductores.every((d) => d.sourceEntityId === productoresId || d.targetEntityId === productoresId)).toBe(true)

    const forOtroTenant = await listRelationDefinitions(TENANT_B)
    expect(forOtroTenant).toEqual([])
  })

  it('updateRelationDefinition renombra; deleteRelationDefinition bloquea si hay vinculos y borra si no', async () => {
    const created = await createRelationDefinition(TENANT_A, { name: 'Temporal', sourceEntityId: recepcionesId, targetEntityId: productoresId })

    const renamed = await updateRelationDefinition(TENANT_A, created.id, { name: 'Renombrada' })
    expect(renamed?.name).toBe('Renombrada')

    const [sourceRecord] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${recepcionesId}, '{}') returning id`
    const [targetRecord] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${productoresId}, '{}') returning id`
    await admin`insert into record_relations (tenant_id, relation_definition_id, source_record_id, target_record_id) values (${TENANT_A}, ${created.id}, ${sourceRecord.id}, ${targetRecord.id})`

    const blocked = await deleteRelationDefinition(TENANT_A, created.id)
    expect(blocked).toEqual({ status: 'has-links', linkCount: 1 })

    await admin`delete from record_relations where relation_definition_id = ${created.id}`
    const deleted = await deleteRelationDefinition(TENANT_A, created.id)
    expect(deleted).toEqual({ status: 'deleted' })

    const notFound = await deleteRelationDefinition(TENANT_A, created.id)
    expect(notFound).toEqual({ status: 'not-found' })
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { importRecords as ImportRecords, TooManyImportRowsError as TooManyImportRowsErrorType } from '../../server/utils/csvImport'
import { withRecordActor } from '../../server/utils/recordActorContext'

// HU-ERD-80: prueba server/utils/csvImport.ts contra un Postgres real
// (embedded-postgres, misma infraestructura de HU-ERD-29) - en particular:
// resolucion de columnas relation por TEXTO (no uuid), ambiguedad/no-encontrado
// como error de fila (no una excepcion global), coercion number/boolean/
// multiselect desde string de CSV, y la semantica de import PARCIAL
// (insertedCount + errors conviven en un mismo resultado).

const TENANT_A = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let importRecords: typeof ImportRecords
let TooManyImportRowsError: typeof TooManyImportRowsErrorType

let productoresId: string
let recepcionesId: string
let importerId: string
let importerRoleId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  const [role] = await admin`insert into roles (tenant_id, name) values (${TENANT_A}, 'Importador') returning id`
  importerRoleId = role.id
  const [person] = await admin`insert into people (email, password_hash, full_name) values (${'importador+' + TENANT_A + '@test.local'}, 'x', 'Importador') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${TENANT_A}, ${importerRoleId}, ${person.id}) returning id`
  importerId = user.id

  const [productores] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Productores', 'productores') returning id`
  productoresId = productores.id as string
  await admin`insert into entity_fields (entity_id, name, label, data_type, is_required) values (${productoresId}, 'nombre', 'Nombre', 'text', true)`

  const workflow = { enabled: true, field: 'estado', initial: 'borrador', states: { borrador: { locked: false, editableFields: [] }, cerrado: { locked: true, editableFields: [] } }, transitions: [{ from: 'borrador', to: 'cerrado', roles: 'all' }], rules: [] }
  const [recepciones] = await admin`insert into entities (tenant_id, name, slug, workflow_config) values (${TENANT_A}, 'Recepciones', 'recepciones', ${admin.json(workflow as never)}) returning id`
  recepcionesId = recepciones.id as string
  await admin`
    insert into entity_fields (entity_id, name, label, data_type, is_required, validation_rules)
    values
      (${recepcionesId}, 'folio', 'Folio', 'text', true, '{}'),
      (${recepcionesId}, 'estado', 'Estado', 'select', true, ${admin.json({ options: [{ value: 'borrador', label: 'Borrador' }, { value: 'cerrado', label: 'Cerrado' }] })}),
      (${recepcionesId}, 'productor', 'Productor', 'relation', true, ${admin.json({ relationEntity: 'productores' })}),
      (${recepcionesId}, 'kilos_recibidos', 'Kilos recibidos', 'number', false, '{}'),
      (${recepcionesId}, 'es_organico', 'Es organico', 'boolean', false, '{}'),
      (
        ${recepcionesId},
        'etiquetas',
        'Etiquetas',
        'multiselect',
        false,
        ${admin.json({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })}
      )
  `

  // Dos productores con nombres distintos, y dos con el MISMO nombre (para
  // probar el caso de ambiguedad).
  await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${productoresId}, ${admin.json({ nombre: 'Rancho El Aguacate' })})`
  await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${productoresId}, ${admin.json({ nombre: 'Rancho Duplicado' })})`
  await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${productoresId}, ${admin.json({ nombre: 'Rancho Duplicado' })})`

  process.env.APP_DATABASE_URL = testDb.appUrl
  const imported = await import('../../server/utils/csvImport')
  TooManyImportRowsError = imported.TooManyImportRowsError
  importRecords = (tenantId, entityId, rows) => withRecordActor({ userId: importerId, roleId: importerRoleId }, () => imported.importRecords(tenantId, entityId, rows))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('csvImport (Postgres real)', () => {
  it('resuelve una columna relation por texto (case-insensitive) y coerciona number/boolean/multiselect', async () => {
    const result = await importRecords(TENANT_A, recepcionesId, [
      { folio: 'R-001', productor: 'rancho el aguacate', kilos_recibidos: '120.5', es_organico: 'si', etiquetas: 'a, b' }
    ])

    expect(result.errors).toEqual([])
    expect(result.insertedCount).toBe(1)

    const [row] = await admin`select custom_data, created_by from records where tenant_id = ${TENANT_A} and entity_id = ${recepcionesId} and custom_data->>'folio' = 'R-001'`
    expect(row.created_by).toBe(importerId)
    expect(row.custom_data.folio).toBe('R-001')
    expect(row.custom_data.kilos_recibidos).toBe(120.5)
    expect(row.custom_data.es_organico).toBe(true)
    expect(row.custom_data.etiquetas).toEqual(['a', 'b'])
    expect(typeof row.custom_data.productor).toBe('string')
    expect(row.custom_data.estado).toBe('borrador')
  })

  it('ignora un estado explícito en CSV y aplica el estado inicial del flujo', async () => {
    const result = await importRecords(TENANT_A, recepcionesId, [
      { folio: 'R-ESTADO', estado: 'cerrado', productor: 'Rancho El Aguacate' }
    ])

    expect(result.errors).toEqual([])
    expect(result.insertedCount).toBe(1)
    const [row] = await admin`select custom_data from records where tenant_id = ${TENANT_A} and entity_id = ${recepcionesId} and custom_data->>'folio' = 'R-ESTADO'`
    expect(row.custom_data.estado).toBe('borrador')
  })

  it('reporta error de fila cuando el texto de la relacion no existe, sin bloquear las demas filas (import parcial)', async () => {
    const result = await importRecords(TENANT_A, recepcionesId, [
      { folio: 'R-002', productor: 'Productor que no existe' },
      { folio: 'R-003', productor: 'Rancho El Aguacate' }
    ])

    expect(result.insertedCount).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ row: 2 })
    expect(result.errors[0].error).toContain('no se encontro')
  })

  it('reporta error de fila cuando el texto de la relacion es ambiguo (coincide con mas de un registro)', async () => {
    const result = await importRecords(TENANT_A, recepcionesId, [{ folio: 'R-004', productor: 'Rancho Duplicado' }])

    expect(result.insertedCount).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toContain('mas de un registro')
  })

  it('reporta error de fila (via el schema Zod dinamico) cuando falta una columna obligatoria', async () => {
    const result = await importRecords(TENANT_A, recepcionesId, [{ productor: 'Rancho El Aguacate' }])

    expect(result.insertedCount).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(2)
  })

  it('rechaza un import con mas filas que el maximo permitido', async () => {
    const tooMany = Array.from({ length: 2001 }, (_, i) => ({ folio: `R-${i}`, productor: 'Rancho El Aguacate' }))
    await expect(importRecords(TENANT_A, recepcionesId, tooMany)).rejects.toBeInstanceOf(TooManyImportRowsError)
  })
})

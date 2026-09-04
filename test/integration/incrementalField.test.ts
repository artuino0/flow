import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  generateIncrementalValue as GenerateIncrementalValue,
  MissingIncrementalPrefixError as MissingIncrementalPrefixErrorType,
  IncrementalFieldRow
} from '../../server/utils/incrementalField'
import type { withTenant as WithTenant } from '../../server/db'

// Pedido directo del usuario (2026-09-04): campo "Incremental", auto-numerico
// y opcionalmente prefijado por un campo de texto de una relacion (ver
// comentario largo en server/utils/incrementalField.ts). Este archivo prueba
// generateIncrementalValue() contra un Postgres real (no unit test con datos
// falsos) porque su garantia central - "un contador INDEPENDIENTE por cada
// valor de prefijo, sin duplicados aun con inserts concurrentes" - depende
// del row-locking real de `INSERT ... ON CONFLICT DO UPDATE` sobre
// entity_field_counters, algo que un mock de drizzle no puede simular con
// fidelidad (mismo criterio que moduleEntityFields.test.ts/dashboardMetrics.
// test.ts: HU-ERD-29).

const TENANT_A = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let generateIncrementalValue: typeof GenerateIncrementalValue
let MissingIncrementalPrefixError: typeof MissingIncrementalPrefixErrorType
let withTenant: typeof WithTenant

let entityMercado: string
let entityPiezas: string
let mercadoNacionalId: string
let mercadoExtranjeroId: string
let mercadoSinCodigoId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`

  const [merc] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Mercado', 'mercado') returning id`
  entityMercado = merc.id as string
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityMercado}, 'codigo', 'Código', 'text')`

  const [piez] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Piezas', 'piezas') returning id`
  entityPiezas = piez.id as string

  const [nacional] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityMercado}, ${admin.json({ codigo: 'N' })}) returning id`
  mercadoNacionalId = nacional.id as string
  const [extranjero] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityMercado}, ${admin.json({ codigo: 'E' })}) returning id`
  mercadoExtranjeroId = extranjero.id as string
  const [sinCodigo] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityMercado}, '{}') returning id`
  mercadoSinCodigoId = sinCodigo.id as string

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ generateIncrementalValue, MissingIncrementalPrefixError } = await import('../../server/utils/incrementalField'))
  ;({ withTenant } = await import('../../server/db'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

async function makeIncrementalField(name: string, validationRules: Record<string, unknown>): Promise<IncrementalFieldRow> {
  const [row] = await admin`
    insert into entity_fields (entity_id, name, label, data_type, validation_rules)
    values (${entityPiezas}, ${name}, ${name}, 'incremental', ${admin.json(validationRules as never)})
    returning id, name, validation_rules
  `
  return { id: row.id as string, name: row.name as string, validationRules: row.validation_rules }
}

describe('generateIncrementalValue (Postgres real)', () => {
  it('genera valores secuenciales simples (sin prefijo), rellenados con ceros a la izquierda', async () => {
    const field = await makeIncrementalField('folio', { digits: 4 })
    const v1 = await withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, {}))
    const v2 = await withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, {}))
    expect(v1).toBe('0001')
    expect(v2).toBe('0002')
  })

  it('antepone el prefijo leido del campo de texto del registro relacionado, y mantiene un contador INDEPENDIENTE por cada valor de prefijo', async () => {
    const field = await makeIncrementalField('codigo_pieza', {
      digits: 3,
      prefixSource: { relationField: 'mercado', sourceField: 'codigo' }
    })

    const n1 = await withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: mercadoNacionalId }))
    const n2 = await withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: mercadoNacionalId }))
    // Intercalado con el prefijo "E": si el contador fuera global (no por
    // prefijo), esta llamada saltaria a 003 en vez de reiniciar en 001 - lo
    // que confirmaria el bug que el usuario explicitamente pidio evitar.
    const e1 = await withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: mercadoExtranjeroId }))
    const n3 = await withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: mercadoNacionalId }))

    expect(n1).toBe('N001')
    expect(n2).toBe('N002')
    expect(e1).toBe('E001')
    expect(n3).toBe('N003')
  })

  it('bajo insercion concurrente para el mismo prefijo, no genera numeros duplicados (row-locking real de Postgres)', async () => {
    const field = await makeIncrementalField('codigo_concurrente', {
      digits: 3,
      prefixSource: { relationField: 'mercado', sourceField: 'codigo' }
    })

    const results = await Promise.all(
      Array.from({ length: 15 }, () => withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: mercadoNacionalId })))
    )

    expect(new Set(results).size).toBe(15)
    expect(results.sort()).toEqual(Array.from({ length: 15 }, (_, i) => 'N' + String(i + 1).padStart(3, '0')).sort())
  })

  it('lanza MissingIncrementalPrefixError si el campo de relacion que da el prefijo esta vacio', async () => {
    const field = await makeIncrementalField('codigo_sin_relacion', {
      digits: 3,
      prefixSource: { relationField: 'mercado', sourceField: 'codigo' }
    })
    await expect(withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, {}))).rejects.toBeInstanceOf(MissingIncrementalPrefixError)
  })

  it('lanza MissingIncrementalPrefixError si el registro relacionado no tiene valor en el campo fuente del prefijo', async () => {
    const field = await makeIncrementalField('codigo_sin_valor_fuente', {
      digits: 3,
      prefixSource: { relationField: 'mercado', sourceField: 'codigo' }
    })
    await expect(
      withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: mercadoSinCodigoId }))
    ).rejects.toBeInstanceOf(MissingIncrementalPrefixError)
  })

  it('lanza MissingIncrementalPrefixError si el registro relacionado no existe', async () => {
    const field = await makeIncrementalField('codigo_relacion_inexistente', {
      digits: 3,
      prefixSource: { relationField: 'mercado', sourceField: 'codigo' }
    })
    await expect(
      withTenant(TENANT_A, (tx) => generateIncrementalValue(tx, TENANT_A, field, { mercado: randomUUID() }))
    ).rejects.toBeInstanceOf(MissingIncrementalPrefixError)
  })
})

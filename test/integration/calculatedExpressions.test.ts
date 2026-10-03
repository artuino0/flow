import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { adminRecordTest } from '../helpers/recordActorFixture'

// Campos calculados con expresiones (varios campos, condicionales) y acumulados
// con filtro/avg/min/max, contra un Postgres real.
const TENANT = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let fields: typeof import('../../server/utils/moduleEntityFields')
let calc: typeof import('../../server/utils/calculatedFields')
let db: typeof import('../../server/db')

let movimientosId: string
let productosId: string
let productoA: string
let productoB: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT}, 'T')`
  productosId = (await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Productos', 'productos') returning id`)[0]!.id as string
  movimientosId = (await admin`insert into entities (tenant_id, name, slug) values (${TENANT}, 'Movimientos', 'movimientos') returning id`)[0]!.id as string
  process.env.APP_DATABASE_URL = testDb.appUrl
  fields = await import('../../server/utils/moduleEntityFields')
  calc = await import('../../server/utils/calculatedFields')
  db = await import('../../server/db')

  const f = (entityId: string, name: string, dataType: string, validationRules: Record<string, unknown> = {}) =>
    fields.createEntityField(TENANT, entityId, { name, label: name, dataType, validationRules, isRequired: false })
  await f(productosId, 'nombre', 'text')
  await f(movimientosId, 'tipo', 'select', { options: [{ value: 'entrada', label: 'Entrada' }, { value: 'salida', label: 'Salida' }] })
  await f(movimientosId, 'cantidad', 'number')
  await f(movimientosId, 'costo', 'currency')
  await f(movimientosId, 'producto', 'relation', { relationEntity: 'productos' })
  productoA = (await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${productosId}, ${admin.json({ nombre: 'A' })}) returning id`)[0]!.id as string
  productoB = (await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${productosId}, ${admin.json({ nombre: 'B' })}) returning id`)[0]!.id as string
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('campos calculados con expresión', () => {
  it('valida la expresión al crear el campo', async () => {
    const create = (name: string, expression: string) => fields.createEntityField(TENANT, movimientosId, {
      name, label: name, dataType: 'number', isRequired: false, validationRules: { calculation: { kind: 'expression', expression } }
    })
    await expect(create('e1', 'cantidad +')).rejects.toBeInstanceOf(fields.InvalidValidationRulesError)
    await expect(create('e2', 'inexistente * 2')).rejects.toThrow(/inexistente/)
    await expect(create('e3', 'e3 + 1')).rejects.toThrow(/sí mismo/)
    await create('con_signo', "SI(tipo = 'salida'; -cantidad; cantidad)")
    await create('importe', 'con_signo * costo')
  })

  it('evalúa encadenando campos calculados y condicionales', async () => {
    const salida = await db.withTenant(TENANT, tx => calc.applyCalculatedFields(tx, TENANT, movimientosId, { tipo: 'salida', cantidad: 4, costo: '2.50' }))
    expect(salida.con_signo).toBe(-4)
    expect(salida.importe).toBe(-10)
    const entrada = await db.withTenant(TENANT, tx => calc.applyCalculatedFields(tx, TENANT, movimientosId, { tipo: 'entrada', cantidad: 4, costo: '2.50' }))
    expect(entrada.con_signo).toBe(4)
  })
})

describe('acumulados con filtro y más funciones', () => {
  it('suma solo lo que cumple el filtro y calcula avg/min/max; existencias = entradas - salidas', adminRecordTest(() => TENANT, () => admin, async () => {
    const add = async (producto: string, tipo: string, cantidad: number) => {
      const data = await db.withTenant(TENANT, tx => calc.applyCalculatedFields(tx, TENANT, movimientosId, { producto, tipo, cantidad, costo: '1.00' }))
      await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT}, ${movimientosId}, ${admin.json(data as never)})`
    }
    await add(productoA, 'entrada', 10)
    await add(productoA, 'entrada', 5)
    await add(productoA, 'salida', 3)
    await add(productoB, 'entrada', 7)

    const rollup = (name: string, aggregate: string, extra: Record<string, unknown> = {}) => fields.createEntityField(TENANT, productosId, {
      name, label: name, dataType: 'number', isRequired: false,
      validationRules: { calculation: { kind: 'rollup', aggregate, sourceEntity: 'movimientos', relationField: 'producto', valueField: 'cantidad', ...extra } }
    })
    await rollup('solo_entradas', 'sum', { filter: { field: 'tipo', operator: 'eq', value: 'entrada' } })
    await rollup('existencia', 'sum', { valueField: 'con_signo' })
    await rollup('promedio', 'avg')
    await rollup('minimo', 'min')
    await rollup('maximo', 'max')
    await rollup('salidas', 'count', { valueField: undefined, filter: { field: 'tipo', operator: 'neq', value: 'entrada' } })

    const a = await db.withTenant(TENANT, tx => calc.applyCalculatedFields(tx, TENANT, productosId, { nombre: 'A' }, productoA))
    expect(a.solo_entradas).toBe(15)
    expect(a.existencia).toBe(12) // 10 + 5 - 3
    expect(a.promedio).toBeCloseTo(6, 5) // (10 + 5 + 3) / 3
    expect(a.minimo).toBe(3)
    expect(a.maximo).toBe(10)
    expect(a.salidas).toBe(1)
    const b = await db.withTenant(TENANT, tx => calc.applyCalculatedFields(tx, TENANT, productosId, { nombre: 'B' }, productoB))
    expect(b.existencia).toBe(7)
  }))

  it('rechaza filtros con campos inexistentes', async () => {
    await expect(fields.createEntityField(TENANT, productosId, {
      name: 'malo', label: 'malo', dataType: 'number', isRequired: false,
      validationRules: { calculation: { kind: 'rollup', aggregate: 'sum', sourceEntity: 'movimientos', relationField: 'producto', valueField: 'cantidad', filter: { field: 'nope', operator: 'eq', value: 'x' } } }
    })).rejects.toThrow(/filtrar/)
  })
})

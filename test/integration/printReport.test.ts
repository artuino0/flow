import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { executePrintReport as ExecutePrintReport, PrintReportError as PrintReportErrorType } from '../../server/utils/printReport'

// ERD-88: prueba server/utils/printReport.ts (DSL + motor de ejecucion) contra
// un Postgres real. Escenario modelado sobre el reporte de "empaque" mostrado
// por el usuario: un Lote (costo_total a repartir) tiene muchos Bultos (kilos,
// y a su vez cada bulto tiene un Tipo de embalaje via relacion forward) -
// exactamente la forma "base + 1 detalle 1:N + salto forward adicional desde
// el detalle" que motivo esta HU.

const TENANT_A = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let executePrintReport: typeof ExecutePrintReport
let PrintReportError: typeof PrintReportErrorType

let lotesId: string
let bultosId: string
let tiposId: string
let loteL1: string
let loteL2: string
let tipoT1: string
let tipoT2: string

async function createEntity(name: string, slug: string): Promise<string> {
  const [row] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, ${name}, ${slug}) returning id`
  return row.id as string
}

async function createField(entityId: string, name: string, label: string, dataType: string, validationRules: unknown = {}): Promise<void> {
  await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${entityId}, ${name}, ${label}, ${dataType}, ${JSON.stringify(validationRules)})`
}

async function createRecord(entityId: string, customData: Record<string, string | number>, deleted = false): Promise<string> {
  const [row] = deleted
    ? await admin`insert into records (tenant_id, entity_id, custom_data, deleted_at) values (${TENANT_A}, ${entityId}, ${admin.json(customData)}, now()) returning id`
    : await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityId}, ${admin.json(customData)}) returning id`
  return row.id as string
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  tiposId = await createEntity('Tipos de Embalaje', 'tipos-embalaje')
  lotesId = await createEntity('Lotes', 'lotes')
  bultosId = await createEntity('Bultos', 'bultos')

  await createField(tiposId, 'nombre', 'Nombre', 'text')
  await createField(lotesId, 'nombre', 'Nombre', 'text')
  await createField(lotesId, 'costo_total', 'Costo Total', 'number')
  await createField(bultosId, 'kilos', 'Kilos', 'number')
  await createField(bultosId, 'lote', 'Lote', 'relation', { relationEntity: 'lotes' })
  await createField(bultosId, 'tipo', 'Tipo de Embalaje', 'relation', { relationEntity: 'tipos-embalaje' })
  await createField(bultosId, 'embarcado', 'Embarcado', 'boolean')

  tipoT1 = await createRecord(tiposId, { nombre: 'Caja' })
  tipoT2 = await createRecord(tiposId, { nombre: 'Bolsa' })

  loteL1 = await createRecord(lotesId, { nombre: 'L1', costo_total: 300 })
  loteL2 = await createRecord(lotesId, { nombre: 'L2', costo_total: 100 })

  await createRecord(bultosId, { kilos: 10, lote: loteL1, tipo: tipoT1, embarcado: 'true' })
  await createRecord(bultosId, { kilos: 20, lote: loteL1, tipo: tipoT2, embarcado: 'false' })
  await createRecord(bultosId, { kilos: 30, lote: loteL1, tipo: tipoT1, embarcado: 'true' })
  await createRecord(bultosId, { kilos: 999, lote: loteL1, tipo: tipoT1, embarcado: 'true' }, true) // en la papelera - no debe contarse

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ executePrintReport, PrintReportError } = await import('../../server/utils/printReport'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('printReport (Postgres real)', () => {
  it('ejecuta un reporte agrupado con tabla relacionada: detalle + suma + reparto por condicion, sin contar registros en la papelera', async () => {
    const result = await executePrintReport(TENANT_A, {
      title: 'Bultos por Lote',
      baseEntity: 'lotes',
      includeDeletedBase: false,
      detail: { entitySlug: 'bultos', fieldName: 'lote', includeDeleted: false },
      groupBy: [{ side: 'base', forwardHops: [], field: 'nombre' }],
      columns: [
        { kind: 'detalle', key: 'kilos_bulto', label: 'Kilos', source: { side: 'detail', forwardHops: [], field: 'kilos' } },
        { kind: 'detalle', key: 'tipo_nombre', label: 'Tipo', source: { side: 'detail', forwardHops: ['tipo'], field: 'nombre' } },
        { kind: 'sumar', key: 'total_kilos', label: 'Total Kilos', source: { side: 'detail', forwardHops: [], field: 'kilos' } },
        {
          kind: 'repartir',
          key: 'kilos_embarque',
          label: 'Kilos por Embarque',
          source: { side: 'detail', forwardHops: [], field: 'kilos' },
          conditionSource: { side: 'detail', forwardHops: [], field: 'embarcado' },
          valueLabels: { true: 'Embarcados', false: 'No embarcados' }
        }
      ]
    })

    // 'repartir' expande a una columna de resultado por cada valor posible
    // del campo condicion (boolean -> true/false), no una sola columna.
    const pivotCols = result.columns.filter((c) => c.pivotOf === 'kilos_embarque')
    expect(pivotCols.map((c) => c.label).sort()).toEqual(['Embarcados', 'No embarcados'])
    const embarcadosKey = pivotCols.find((c) => c.label === 'Embarcados')!.key
    const noEmbarcadosKey = pivotCols.find((c) => c.label === 'No embarcados')!.key

    expect(result.groups).toHaveLength(2)

    const groupL1 = result.groups.find((g) => g.label === 'L1')
    expect(groupL1).toBeDefined()
    expect(groupL1!.rows).toHaveLength(3) // NO 4 - el bulto borrado logicamente no cuenta
    expect(groupL1!.subtotals.total_kilos).toBe(60)
    // cada fila impresa trae el pivot completo: el valor real en la columna
    // de SU condicion, y 0 en las demas (no un reparto proporcional)
    for (const row of groupL1!.rows) {
      expect(['Caja', 'Bolsa']).toContain(row.values.tipo_nombre)
      const emb = Number(row.values[embarcadosKey])
      const noEmb = Number(row.values[noEmbarcadosKey])
      expect(emb === 0 || noEmb === 0).toBe(true)
      expect(emb + noEmb).toBe(Number(row.values.kilos_bulto))
      // 'sumar' se comporta igual que las hojas de 'repartir': aparece en
      // CADA fila de detalle (no solo en el subtotal) - ver comentario
      // grande en printReport.ts sobre este comportamiento confirmado en
      // el mock A0UnX.
      expect(Number(row.values.total_kilos)).toBe(Number(row.values.kilos_bulto))
    }
    // subtotal del grupo: 10 + 30 embarcados, 20 no embarcados
    expect(groupL1!.subtotals[embarcadosKey]).toBe(40)
    expect(groupL1!.subtotals[noEmbarcadosKey]).toBe(20)

    const groupL2 = result.groups.find((g) => g.label === 'L2')
    expect(groupL2).toBeDefined()
    expect(groupL2!.rows).toHaveLength(0)
    expect(groupL2!.subtotals.total_kilos).toBe(0)
    expect(groupL2!.subtotals[embarcadosKey]).toBe(0)
    expect(groupL2!.subtotals[noEmbarcadosKey]).toBe(0)

    expect(result.grandTotals.total_kilos).toBe(60)
    expect(result.grandTotals[embarcadosKey]).toBe(40)
    expect(result.grandTotals[noEmbarcadosKey]).toBe(20)
  })

  it('rechaza repartir cuando el campo condicion esta en un lado distinto al del campo a repartir', async () => {
    await expect(
      executePrintReport(TENANT_A, {
        title: 'Invalido',
        baseEntity: 'lotes',
        includeDeletedBase: false,
        detail: { entitySlug: 'bultos', fieldName: 'lote', includeDeleted: false },
        groupBy: [],
        columns: [
          {
            kind: 'repartir',
            key: 'costo_repartido',
            label: 'Costo Repartido',
            source: { side: 'base', forwardHops: [], field: 'costo_total' },
            conditionSource: { side: 'detail', forwardHops: [], field: 'embarcado' }
          }
        ]
      })
    ).rejects.toBeInstanceOf(PrintReportError)
  })

  it('con includeDeleted:true en la tabla relacionada, cuenta tambien el bulto en la papelera', async () => {
    const result = await executePrintReport(TENANT_A, {
      title: 'Bultos por Lote (con papelera)',
      baseEntity: 'lotes',
      includeDeletedBase: false,
      detail: { entitySlug: 'bultos', fieldName: 'lote', includeDeleted: true },
      groupBy: [{ side: 'base', forwardHops: [], field: 'nombre' }],
      columns: [{ kind: 'sumar', key: 'total_kilos', label: 'Total Kilos', source: { side: 'detail', forwardHops: [], field: 'kilos' } }]
    })
    const groupL1 = result.groups.find((g) => g.label === 'L1')
    expect(groupL1!.subtotals.total_kilos).toBe(1059) // 10+20+30+999
  })

  it('reporte sin agrupar ni tabla relacionada: filas planas de la entidad base', async () => {
    const result = await executePrintReport(TENANT_A, {
      title: 'Lotes',
      baseEntity: 'lotes',
      includeDeletedBase: false,
      groupBy: [],
      columns: [
        { kind: 'detalle', key: 'nombre', label: 'Nombre', source: { side: 'base', forwardHops: [], field: 'nombre' } },
        { kind: 'sumar', key: 'costo', label: 'Costo', source: { side: 'base', forwardHops: [], field: 'costo_total' } }
      ]
    })
    expect(result.groups).toHaveLength(0)
    expect(result.ungroupedRows).toHaveLength(2)
    expect(result.grandTotals.costo).toBe(400)
    expect(result.ungroupedRows.map((r) => r.values.nombre).sort()).toEqual(['L1', 'L2'])
  })

  it('rechaza sumar/repartir sobre un campo no numerico', async () => {
    await expect(
      executePrintReport(TENANT_A, {
        title: 'Invalido',
        baseEntity: 'lotes',
        includeDeletedBase: false,
        groupBy: [],
        columns: [{ kind: 'sumar', key: 'nombre_sumado', label: 'Nombre', source: { side: 'base', forwardHops: [], field: 'nombre' } }]
      })
    ).rejects.toBeInstanceOf(PrintReportError)
  })

  it('rechaza una entidad base inexistente', async () => {
    await expect(
      executePrintReport(TENANT_A, {
        title: 'Invalido',
        baseEntity: 'no-existe',
        includeDeletedBase: false,
        groupBy: [],
        columns: [{ kind: 'detalle', key: 'x', label: 'X', source: { side: 'base', forwardHops: [], field: 'x' } }]
      })
    ).rejects.toBeInstanceOf(PrintReportError)
  })

  it('rechaza una tabla relacionada cuyo campo no apunta de vuelta a la entidad base', async () => {
    await expect(
      executePrintReport(TENANT_A, {
        title: 'Invalido',
        baseEntity: 'lotes',
        includeDeletedBase: false,
        detail: { entitySlug: 'bultos', fieldName: 'tipo', includeDeleted: false }, // 'tipo' apunta a tipos-embalaje, no a lotes
        groupBy: [],
        columns: [{ kind: 'detalle', key: 'kilos', label: 'Kilos', source: { side: 'detail', forwardHops: [], field: 'kilos' } }]
      })
    ).rejects.toBeInstanceOf(PrintReportError)
  })

  it('filtra por folio (incremental) con el texto exacto, con ceros a la izquierda y con prefijo, sin reventar el cast', async () => {
    const pedidosId = await createEntity('Pedidos', 'pedidos-folio')
    await createField(pedidosId, 'folio', 'Folio', 'incremental', { digits: 6 })
    await createField(pedidosId, 'nota', 'Nota', 'text')
    await createRecord(pedidosId, { folio: '000001', nota: 'uno' })
    await createRecord(pedidosId, { folio: '000002', nota: 'dos' })
    await createRecord(pedidosId, { folio: 'PED-000003', nota: 'tres' })
    const run = (value: string) => executePrintReport(TENANT_A, {
      title: 'Pedidos',
      baseEntity: 'pedidos-folio',
      includeDeletedBase: false,
      groupBy: [],
      filters: [{ source: { side: 'base', forwardHops: [], field: 'folio' }, value, operator: 'eq', recordId: false }],
      columns: [{ kind: 'detalle', key: 'nota', label: 'Nota', source: { side: 'base', forwardHops: [], field: 'nota' } }]
    })
    const notes = async (value: string) => (await run(value)).ungroupedRows.map((row) => row.values.nota)
    expect(await notes('000001')).toEqual(['uno'])
    expect(await notes('1')).toEqual(['uno']) // el filtro numérico de siempre sigue funcionando
    expect(await notes('PED-000003')).toEqual(['tres'])
  })
})

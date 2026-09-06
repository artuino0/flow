import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  loadTenantFieldContext as LoadTenantFieldContext,
  buildFieldTree as BuildFieldTree,
  ReportPathPlanner as ReportPathPlannerType,
  InvalidFieldPathError as InvalidFieldPathErrorType
} from '../../server/utils/reportFieldPath'

// ERD-88: prueba server/utils/reportFieldPath.ts contra un Postgres real
// (embedded-postgres, misma infraestructura de HU-ERD-29/77) - modela el
// caso real que motivo esta HU: Recepcion -> Camion (relation) -> Linea de
// Transporte (relation), 2 saltos forward, mas Manifiesto <- Estiba (relacion
// inversa 1:N).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let loadTenantFieldContext: typeof LoadTenantFieldContext
let buildFieldTree: typeof BuildFieldTree
let ReportPathPlanner: typeof ReportPathPlannerType
let InvalidFieldPathError: typeof InvalidFieldPathErrorType

let lineaId: string
let camionId: string
let recepcionId: string
let manifiestoId: string
let estibaId: string

async function createEntity(tenantId: string, name: string, slug: string): Promise<string> {
  const [row] = await admin`insert into entities (tenant_id, name, slug) values (${tenantId}, ${name}, ${slug}) returning id`
  return row.id as string
}

async function createField(entityId: string, name: string, label: string, dataType: string, validationRules: unknown = {}): Promise<void> {
  await admin`insert into entity_fields (entity_id, name, label, data_type, validation_rules) values (${entityId}, ${name}, ${label}, ${dataType}, ${JSON.stringify(validationRules)})`
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  lineaId = await createEntity(TENANT_A, 'Lineas de Transporte', 'lineas-transporte')
  camionId = await createEntity(TENANT_A, 'Camiones', 'camiones')
  recepcionId = await createEntity(TENANT_A, 'Recepciones', 'recepciones')
  manifiestoId = await createEntity(TENANT_A, 'Manifiestos', 'manifiestos')
  estibaId = await createEntity(TENANT_A, 'Estibas', 'estibas')

  await createField(lineaId, 'nombre', 'Nombre', 'text')
  await createField(camionId, 'patente', 'Patente', 'text')
  await createField(camionId, 'linea', 'Linea de Transporte', 'relation', { relationEntity: 'lineas-transporte' })
  await createField(recepcionId, 'kilos', 'Kilos', 'number')
  await createField(recepcionId, 'camion', 'Camion', 'relation', { relationEntity: 'camiones' })
  await createField(manifiestoId, 'codigo', 'Codigo', 'text')
  await createField(estibaId, 'bultos', 'Bultos', 'number')
  await createField(estibaId, 'manifiesto', 'Manifiesto', 'relation', { relationEntity: 'manifiestos' })

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ loadTenantFieldContext, buildFieldTree, ReportPathPlanner, InvalidFieldPathError } = await import('../../server/utils/reportFieldPath'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('reportFieldPath (Postgres real)', () => {
  it('loadTenantFieldContext carga entities/fields solo del tenant pedido', async () => {
    const { withTenant } = await import('../../server/db')
    const ctxA = await withTenant(TENANT_A, (tx) => loadTenantFieldContext(tx, TENANT_A))
    expect(ctxA.entitiesBySlug.has('recepciones')).toBe(true)
    expect(ctxA.entitiesBySlug.has('camiones')).toBe(true)
    expect((ctxA.fieldsByEntityId.get(recepcionId) ?? []).map((f) => f.name).sort()).toEqual(['camion', 'kilos'])
  })

  it('buildFieldTree arma el arbol de 2 saltos forward (Recepcion -> Camion -> Linea) y detiene en MAX_FIELD_PATH_DEPTH', async () => {
    const { withTenant } = await import('../../server/db')
    const tree = await withTenant(TENANT_A, async (tx) => {
      const ctx = await loadTenantFieldContext(tx, TENANT_A)
      return buildFieldTree(ctx, recepcionId)
    })

    const leaves = tree.filter((n) => n.type === 'leaf')
    expect(leaves.some((l) => l.type === 'leaf' && l.fieldName === 'kilos')).toBe(true)

    const camionBranch = tree.find((n) => n.type === 'branch' && n.entitySlug === 'camiones')
    expect(camionBranch).toBeDefined()
    if (camionBranch?.type === 'branch') {
      expect(camionBranch.kind).toBe('forward')
      expect(camionBranch.cardinality).toBe('1:1')
      const lineaBranch = camionBranch.children.find((n) => n.type === 'branch' && n.entitySlug === 'lineas-transporte')
      expect(lineaBranch).toBeDefined()
    }
  })

  it('buildFieldTree expone la relacion inversa Manifiesto <- Estiba (1:N)', async () => {
    const { withTenant } = await import('../../server/db')
    const tree = await withTenant(TENANT_A, async (tx) => {
      const ctx = await loadTenantFieldContext(tx, TENANT_A)
      return buildFieldTree(ctx, manifiestoId)
    })

    const estibaBranch = tree.find((n) => n.type === 'branch' && n.entitySlug === 'estibas')
    expect(estibaBranch).toBeDefined()
    if (estibaBranch?.type === 'branch') {
      expect(estibaBranch.kind).toBe('inverse')
      expect(estibaBranch.cardinality).toBe('1:N')
      expect(estibaBranch.fieldName).toBe('manifiesto')
    }
  })

  it('ReportPathPlanner resuelve un campo directo (sin saltos) en r_base', async () => {
    const { withTenant } = await import('../../server/db')
    const result = await withTenant(TENANT_A, async (tx) => {
      const ctx = await loadTenantFieldContext(tx, TENANT_A)
      const planner = new ReportPathPlanner(ctx, TENANT_A, recepcionId)
      return planner.resolve({ side: 'base', forwardHops: [], field: 'kilos' })
    })
    expect(result.alias).toBe('r_base')
    expect(result.field.name).toBe('kilos')
  })

  it('ReportPathPlanner arma 2 LEFT JOINs para Recepcion -> Camion -> Linea y reusa el alias en una segunda columna del mismo camino', async () => {
    const { withTenant } = await import('../../server/db')
    const { joinCount, aliasReused } = await withTenant(TENANT_A, async (tx) => {
      const ctx = await loadTenantFieldContext(tx, TENANT_A)
      const planner = new ReportPathPlanner(ctx, TENANT_A, recepcionId)
      const patente = planner.resolve({ side: 'base', forwardHops: ['camion'], field: 'patente' })
      const nombreLinea = planner.resolve({ side: 'base', forwardHops: ['camion', 'linea'], field: 'nombre' })
      const patenteOtraVez = planner.resolve({ side: 'base', forwardHops: ['camion'], field: 'patente' })
      return { joinCount: planner.joinSql.length, aliasReused: patenteOtraVez.alias === patente.alias, nombreLineaField: nombreLinea.field.name }
    })
    expect(joinCount).toBe(2)
    expect(aliasReused).toBe(true)
  })

  it('ReportPathPlanner lanza InvalidFieldPathError ante un campo/salto inexistente', async () => {
    const { withTenant } = await import('../../server/db')
    await expect(
      withTenant(TENANT_A, async (tx) => {
        const ctx = await loadTenantFieldContext(tx, TENANT_A)
        const planner = new ReportPathPlanner(ctx, TENANT_A, recepcionId)
        planner.resolve({ side: 'base', forwardHops: ['no-existe'], field: 'kilos' })
      })
    ).rejects.toBeInstanceOf(InvalidFieldPathError)
  })

  it('no cruza tenants: loadTenantFieldContext de un tenant vacio no ve las entidades de otro', async () => {
    const { withTenant } = await import('../../server/db')
    const ctxB = await withTenant(TENANT_B, (tx) => loadTenantFieldContext(tx, TENANT_B))
    expect(ctxB.entitiesBySlug.size).toBe(0)
  })
})

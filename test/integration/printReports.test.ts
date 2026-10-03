import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import type {
  listPrintReports as ListPrintReports,
  getPrintReport as GetPrintReport,
  createPrintReport as CreatePrintReport,
  updatePrintReport as UpdatePrintReport,
  deletePrintReport as DeletePrintReport,
  previewPrintReport as PreviewPrintReport,
  PrintReportNotFoundError as PrintReportNotFoundErrorType
} from '../../server/utils/printReports'
import type { PrintReportDsl } from '../../server/utils/printReport'

// ERD-88: prueba server/utils/printReports.ts (CRUD de plantillas guardadas
// del Diseñador de reportes imprimibles) contra un Postgres real - mismo
// escenario minimo (Lotes/Bultos) que printReport.test.ts, ya que solo hace
// falta una entidad base valida para poder guardar un dsl.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let listPrintReports: typeof ListPrintReports
let getPrintReport: typeof GetPrintReport
let createPrintReport: typeof CreatePrintReport
let updatePrintReport: typeof UpdatePrintReport
let deletePrintReport: typeof DeletePrintReport
let previewPrintReport: typeof PreviewPrintReport
let PrintReportNotFoundError: typeof PrintReportNotFoundErrorType

let lotesId: string
let userId: string

function sampleDsl(): PrintReportDsl {
  return {
    title: 'Lotes',
    baseEntity: 'lotes',
    includeDeletedBase: false,
    groupBy: [],
    columns: [{ kind: 'detalle', key: 'nombre', label: 'Nombre', source: { side: 'base', forwardHops: [], field: 'nombre' } }]
  }
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`

  const [lotes] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Lotes', 'lotes') returning id`
  lotesId = lotes.id as string
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${lotesId}, 'nombre', 'Nombre', 'text')`

  const personId = randomUUID()
  await admin`insert into people (id, email, password_hash, full_name) values (${personId}, 'reportero@test.com', 'x', 'Reportero')`
  const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Administrador', true) returning id`
  const [user] = await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${TENANT_A}, ${personId}, ${role.id}, true) returning id`
  userId = user.id as string
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete) values (${role.id}, ${lotesId}, true, true, true, true)`

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ listPrintReports, getPrintReport, createPrintReport, updatePrintReport, deletePrintReport, previewPrintReport, PrintReportNotFoundError } = await import(
    '../../server/utils/printReports'
  ))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('printReports (Postgres real)', () => {
  it('crea, lista, obtiene, actualiza y borra una plantilla', async () => {
    const created = await createPrintReport(TENANT_A, userId, { title: 'Reporte de Lotes', dsl: sampleDsl() })
    expect(created.baseEntitySlug).toBe('lotes')
    expect(created.title).toBe('Reporte de Lotes')

    const list = await listPrintReports(TENANT_A, 'lotes')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)

    const fetched = await getPrintReport(TENANT_A, created.id)
    expect(fetched.dsl.columns).toHaveLength(1)

    const updated = await updatePrintReport(TENANT_A, created.id, { title: 'Reporte de Lotes (v2)', dsl: sampleDsl() })
    expect(updated.title).toBe('Reporte de Lotes (v2)')
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime())

    await deletePrintReport(TENANT_A, created.id)
    await expect(getPrintReport(TENANT_A, created.id)).rejects.toBeInstanceOf(PrintReportNotFoundError)
  })

  it('listPrintReports no cruza tenants', async () => {
    await createPrintReport(TENANT_A, userId, { title: 'Solo de A', dsl: sampleDsl() })
    const listB = await listPrintReports(TENANT_B, 'lotes')
    expect(listB).toHaveLength(0)
  })

  it('previewPrintReport ejecuta el dsl contra los datos vigentes sin persistir nada', async () => {
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${lotesId}, ${admin.json({ nombre: 'L1' })})`
    const before = await listPrintReports(TENANT_A, 'lotes')

    const [membership] = await admin`select role_id from users where id = ${userId}`
    const result = await withRecordActor({ userId, roleId: membership!.role_id }, () => previewPrintReport(TENANT_A, sampleDsl()))
    expect(result.ungroupedRows.map((r) => r.values.nombre)).toContain('L1')

    const after = await listPrintReports(TENANT_A, 'lotes')
    expect(after).toHaveLength(before.length) // no crea ninguna plantilla nueva
  })

  it('getPrintReport/updatePrintReport/deletePrintReport lanzan PrintReportNotFoundError sobre un id inexistente o de otro tenant', async () => {
    const created = await createPrintReport(TENANT_A, userId, { title: 'Efímero', dsl: sampleDsl() })
    await expect(getPrintReport(TENANT_B, created.id)).rejects.toBeInstanceOf(PrintReportNotFoundError)
    await expect(updatePrintReport(TENANT_B, created.id, { title: 'x', dsl: sampleDsl() })).rejects.toBeInstanceOf(PrintReportNotFoundError)
    await expect(deletePrintReport(TENANT_B, created.id)).rejects.toBeInstanceOf(PrintReportNotFoundError)
  })
})

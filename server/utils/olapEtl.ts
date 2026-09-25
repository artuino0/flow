import { sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { dimDate, dimCliente, dimSucursal, factEventos } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

// ERD-87: ETL OLAP incremental por cursor persistente y lotes globales.
export function toDimDateId(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

interface ChangedRecord {
  id: string
  tenant_id: string
  entity_id: string
  entity_slug: string
  custom_data: Record<string, unknown> | null
  created_at: Date | string
  updated_at: Date | string
  updated_at_cursor: string
  is_deleted: boolean
}

interface Cursor { updatedAt: string; recordId: string }
export interface OlapEtlResult {
  batches: number
  recordsProcessed: number
  recordsSkippedDeleted: number
  tenants: number
  factUpserts: number
  dimClienteUpserts: number
  dimSucursalUpserts: number
  cursor: { updatedAt: string; recordId: string }
  reachedEnd: boolean
  durationMs: number
}

const JOB = 'olap-etl'
const INITIAL_CURSOR: Cursor = { updatedAt: '1970-01-01T00:00:00.000Z', recordId: '00000000-0000-0000-0000-000000000000' }

function dateDimValue(d: Date) {
  const month = d.getUTCMonth() + 1
  const dayOfWeek = d.getUTCDay()
  return { id: toDimDateId(d), date: d.toISOString().slice(0, 10), year: d.getUTCFullYear(), quarter: Math.floor((month - 1) / 3) + 1, month, day: d.getUTCDate(), dayOfWeek, isWeekend: dayOfWeek === 0 || dayOfWeek === 6 }
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export async function runOlapEtl(now = new Date(), options: { batchSize?: number; budgetMs?: number; lagMs?: number } = {}): Promise<OlapEtlResult> {
  const startedAt = Date.now()
  const batchSize = options.batchSize ?? 1000
  const budgetMs = options.budgetMs ?? 45_000
  const until = new Date(now.getTime() - (options.lagMs ?? 120_000))
  const cursorRows = await db.execute(sql`select last_updated_at::text as updated_at, last_record_id from olap_etl_state where job = ${JOB} limit 1`)
  const [stored] = cursorRows as unknown as Array<{ updated_at: string; last_record_id: string }>
  let cursor: Cursor = stored ? { updatedAt: stored.updated_at, recordId: stored.last_record_id } : INITIAL_CURSOR
  const result: OlapEtlResult = { batches: 0, recordsProcessed: 0, recordsSkippedDeleted: 0, tenants: 0, factUpserts: 0, dimClienteUpserts: 0, dimSucursalUpserts: 0, cursor: { updatedAt: new Date(cursor.updatedAt).toISOString(), recordId: cursor.recordId }, reachedEnd: false, durationMs: 0 }

  while (true) {
    const queryResult = await db.execute(sql`select * from olap_changed_records(${cursor.updatedAt}::timestamptz, ${cursor.recordId}::uuid, ${until.toISOString()}::timestamptz, ${batchSize})`)
    const batch = queryResult as unknown as ChangedRecord[]
    if (!batch.length) { result.reachedEnd = true; break }
    result.batches += 1
    const groups = new Map<string, ChangedRecord[]>()
    let activeCount = 0
    for (const record of batch) {
      if (record.is_deleted) { result.recordsSkippedDeleted += 1; continue }
      activeCount += 1
      const group = groups.get(record.tenant_id) ?? []
      group.push(record)
      groups.set(record.tenant_id, group)
    }

    let failed = false
    for (const [tenantId, records] of groups) {
      let tenantDimClienteUpserts = 0
      let tenantDimSucursalUpserts = 0
      let tenantFactUpserts = 0
      try {
        await withTenant(tenantId, async (tx) => {
          const dates = new Map<number, ReturnType<typeof dateDimValue>>()
          for (const record of records) {
            const createdAt = asDate(record.created_at)
            dates.set(toDimDateId(createdAt), dateDimValue(createdAt))
          }
          if (dates.size) await tx.insert(dimDate).values([...dates.values()]).onConflictDoNothing({ target: dimDate.id })

          const clientes = records.filter((record) => record.entity_slug === 'clientes')
          const clienteIds = new Map<string, string>()
          if (clientes.length) {
            const values = clientes.map((record) => {
              const data = record.custom_data ?? {}
              return { tenantId, recordId: record.id, nombre: typeof data.nombre === 'string' ? data.nombre : '(sin nombre)', email: typeof data.email === 'string' ? data.email : null, updatedAt: new Date() }
            })
            const returned = await tx.insert(dimCliente).values(values).onConflictDoUpdate({ target: [dimCliente.tenantId, dimCliente.recordId], targetWhere: sql`${dimCliente.recordId} is not null`, set: { nombre: sql`excluded.nombre`, email: sql`excluded.email`, updatedAt: sql`excluded.updated_at` } }).returning({ id: dimCliente.id, recordId: dimCliente.recordId })
            for (const row of returned) if (row.recordId) clienteIds.set(row.recordId, row.id)
            tenantDimClienteUpserts = returned.length
          }

          const sucursales = records.filter((record) => record.entity_slug === 'sucursales')
          if (sucursales.length) {
            const values = sucursales.map((record) => {
              const data = record.custom_data ?? {}
              return { tenantId, recordId: record.id, nombre: typeof data.nombre === 'string' ? data.nombre : '(sin nombre)', ciudad: typeof data.ciudad === 'string' ? data.ciudad : null, updatedAt: new Date() }
            })
            const returned = await tx.insert(dimSucursal).values(values).onConflictDoUpdate({ target: [dimSucursal.tenantId, dimSucursal.recordId], targetWhere: sql`${dimSucursal.recordId} is not null`, set: { nombre: sql`excluded.nombre`, ciudad: sql`excluded.ciudad`, updatedAt: sql`excluded.updated_at` } }).returning({ id: dimSucursal.id })
            tenantDimSucursalUpserts = returned.length
          }

          const facts = records.map((record) => ({ tenantId, dateId: toDimDateId(asDate(record.created_at)), clienteId: clienteIds.get(record.id) ?? null, recordId: record.id, tipoEvento: record.entity_slug, monto: '0', cantidad: 1, updatedAt: new Date() }))
          if (facts.length) {
            const returned = await tx.insert(factEventos).values(facts).onConflictDoUpdate({ target: [factEventos.tenantId, factEventos.recordId], targetWhere: sql`${factEventos.recordId} is not null`, set: { dateId: sql`excluded.date_id`, clienteId: sql`excluded.cliente_id`, tipoEvento: sql`excluded.tipo_evento`, updatedAt: sql`excluded.updated_at` } }).returning({ id: factEventos.id })
            tenantFactUpserts = returned.length
          }
        })
        result.tenants += 1
        result.dimClienteUpserts += tenantDimClienteUpserts
        result.dimSucursalUpserts += tenantDimSucursalUpserts
        result.factUpserts += tenantFactUpserts
      } catch (err) {
        failed = true
        logger.error('olap_etl_tenant_failed', { tenantId, errorMessage: err instanceof Error ? err.message : String(err) })
        break
      }
    }
    if (failed) break

    result.recordsProcessed += activeCount
    const last = batch[batch.length - 1]!
    cursor = { updatedAt: last.updated_at_cursor, recordId: last.id }
    await db.execute(sql`insert into olap_etl_state (job, last_updated_at, last_record_id, updated_at) values (${JOB}, ${cursor.updatedAt}::timestamptz, ${cursor.recordId}::uuid, now()) on conflict (job) do update set last_updated_at = excluded.last_updated_at, last_record_id = excluded.last_record_id, updated_at = now()`)
    result.cursor = { updatedAt: new Date(cursor.updatedAt).toISOString(), recordId: cursor.recordId }
    if (Date.now() - startedAt >= budgetMs) break
  }
  result.durationMs = Date.now() - startedAt
  return result
}

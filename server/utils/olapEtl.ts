import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenants, entities, records, dimDate, dimCliente, dimSucursal, factEventos } from '~/server/db/schema'
import { logger } from '~/server/utils/logger'

// ETL transaccional -> OLAP (HU-ERD-28). Corre cada 15 min (server/plugins/olap-etl.ts)
// sobre una ventana de tiempo con solapamiento (mas ancha que el intervalo del cron),
// para que un fallo a mitad de la corrida anterior se resuelva solo en la siguiente:
// los records que quedaron sin procesar siguen entrando en la ventana de la proxima
// corrida. Todo el upsert es idempotente (ON CONFLICT sobre los unicos parciales de
// HU-ERD-27/28 por (tenant_id, record_id)) - reprocesar la misma ventana no duplica nada.
//
// Alcance de esta HU (documentado, ver DOCS/Esquema_OLAP.md): fact_eventos es generica,
// no hay todavia una entidad de negocio "Ventas"/"Eventos" en el diccionario de datos.
// Mientras tanto, el ETL trata la CREACION/EDICION de cualquier record como un "evento"
// (tipo_evento = slug de su entidad), con monto/cantidad en sus valores por defecto
// (0 / 1) salvo para la entidad 'clientes', que ademas alimenta dim_cliente. Esto se
// reemplaza en cuanto exista una entidad real de ventas/eventos que lo justifique.

const LOOKBACK_MINUTES = 30 // > 2x el intervalo del cron (15 min), da margen ante una corrida lenta o fallida

function toDimDateId(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

async function ensureDimDate(tx: typeof db, d: Date): Promise<number> {
  const id = toDimDateId(d)
  const month = d.getUTCMonth() + 1
  const dayOfWeek = d.getUTCDay()

  await tx
    .insert(dimDate)
    .values({
      id,
      date: d.toISOString().slice(0, 10),
      year: d.getUTCFullYear(),
      quarter: Math.floor((month - 1) / 3) + 1,
      month,
      day: d.getUTCDate(),
      dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6
    })
    .onConflictDoNothing({ target: dimDate.id })

  return id
}

export interface OlapEtlResult {
  tenantId: string
  entitiesProcessed: number
  recordsProcessed: number
  dimClienteUpserts: number
  dimSucursalUpserts: number
  factUpserts: number
}

/**
 * Corre el ETL para un solo tenant, sobre records con updated_at en
 * [windowStart, windowEnd]. Separado de runOlapEtl() para poder testearlo
 * (pglite) y para que un tenant que falla no interrumpa a los demas.
 */
export async function runOlapEtlForTenant(tenantId: string, windowStart: Date, windowEnd: Date): Promise<OlapEtlResult> {
  return withTenant(tenantId, async (tx) => {
    const tenantEntities = await tx.select().from(entities).where(eq(entities.tenantId, tenantId))

    const result: OlapEtlResult = {
      tenantId,
      entitiesProcessed: tenantEntities.length,
      recordsProcessed: 0,
      dimClienteUpserts: 0,
      dimSucursalUpserts: 0,
      factUpserts: 0
    }

    for (const entity of tenantEntities) {
      const changedRecords = await tx
        .select()
        .from(records)
        .where(
          and(
            eq(records.tenantId, tenantId),
            eq(records.entityId, entity.id),
            gte(records.updatedAt, windowStart),
            lte(records.updatedAt, windowEnd)
          )
        )

      for (const record of changedRecords) {
        result.recordsProcessed += 1
        const customData = (record.customData ?? {}) as Record<string, unknown>

        let clienteDimId: string | null = null

        // dim_cliente: solo para records de la entidad "clientes" (convencion
        // del seed de ERD-25 - nombre/email son los campos que sembro ese seed).
        if (entity.slug === 'clientes') {
          const [dim] = await tx
            .insert(dimCliente)
            .values({
              tenantId,
              recordId: record.id,
              nombre: typeof customData.nombre === 'string' ? customData.nombre : '(sin nombre)',
              email: typeof customData.email === 'string' ? customData.email : null,
              updatedAt: new Date()
            })
            .onConflictDoUpdate({
              target: [dimCliente.tenantId, dimCliente.recordId],
              targetWhere: sql`${dimCliente.recordId} is not null`,
              set: {
                nombre: typeof customData.nombre === 'string' ? customData.nombre : '(sin nombre)',
                email: typeof customData.email === 'string' ? customData.email : null,
                updatedAt: new Date()
              }
            })
            .returning({ id: dimCliente.id })
          clienteDimId = dim?.id ?? null
          result.dimClienteUpserts += 1
        }

        // dim_sucursal: misma logica si en algun momento existe una entidad
        // "sucursales" (todavia no forma parte del seed de ERD-25).
        if (entity.slug === 'sucursales') {
          await tx
            .insert(dimSucursal)
            .values({
              tenantId,
              recordId: record.id,
              nombre: typeof customData.nombre === 'string' ? customData.nombre : '(sin nombre)',
              ciudad: typeof customData.ciudad === 'string' ? customData.ciudad : null,
              updatedAt: new Date()
            })
            .onConflictDoUpdate({
              target: [dimSucursal.tenantId, dimSucursal.recordId],
              targetWhere: sql`${dimSucursal.recordId} is not null`,
              set: {
                nombre: typeof customData.nombre === 'string' ? customData.nombre : '(sin nombre)',
                ciudad: typeof customData.ciudad === 'string' ? customData.ciudad : null,
                updatedAt: new Date()
              }
            })
          result.dimSucursalUpserts += 1
        }

        // fact_eventos: un hecho generico por record de cualquier entidad
        // (ver nota de alcance arriba). record.createdAt fija la fecha del
        // hecho (cuando "paso" el evento, no cuando se sincronizo al OLAP).
        const dateId = await ensureDimDate(tx, record.createdAt)
        await tx
          .insert(factEventos)
          .values({
            tenantId,
            dateId,
            clienteId: clienteDimId,
            recordId: record.id,
            tipoEvento: entity.slug,
            monto: '0',
            cantidad: 1,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: [factEventos.tenantId, factEventos.recordId],
            targetWhere: sql`${factEventos.recordId} is not null`,
            set: {
              dateId,
              clienteId: clienteDimId,
              tipoEvento: entity.slug,
              updatedAt: new Date()
            }
          })
        result.factUpserts += 1
      }
    }

    return result
  })
}

/**
 * Corre el ETL para todos los tenants. Un tenant que falla queda logueado y
 * no interrumpe a los demas (ni requiere reintento manual: la ventana con
 * solapamiento de la proxima corrida lo vuelve a intentar solo).
 */
export async function runOlapEtl(now: Date = new Date()): Promise<OlapEtlResult[]> {
  const windowEnd = now
  const windowStart = new Date(now.getTime() - LOOKBACK_MINUTES * 60 * 1000)

  const allTenants = await db.select({ id: tenants.id }).from(tenants)
  const results: OlapEtlResult[] = []

  for (const tenant of allTenants) {
    try {
      const result = await runOlapEtlForTenant(tenant.id, windowStart, windowEnd)
      results.push(result)
      logger.info('olap_etl_tenant_ok', result as unknown as Record<string, unknown>)
    } catch (err) {
      logger.error('olap_etl_tenant_failed', {
        tenantId: tenant.id,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
      // Sin alertas externas en el MVP (criterio de aceptacion) - el error
      // queda en el log estructurado / Sentry (via el hook de errores de
      // server/plugins/observability.ts si se relanza mas arriba). Se sigue
      // con el resto de los tenants.
    }
  }

  return results
}

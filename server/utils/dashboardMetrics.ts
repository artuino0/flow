import { and, eq, gte, lte, sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { dimCliente, dimSucursal, factEventos, users } from '~/server/db/schema'
import { toDimDateId } from '~/server/utils/olapEtl'

// HU-ERD-31: logica de agregacion del dashboard interno OLAP, separada del
// endpoint (server/api/dashboard/metrics.get.ts) para poder testearla sin
// pasar por HTTP - mismo patron que buildFieldType (HU-ERD-17/29) y
// runOlapEtlForTenant (HU-ERD-28).
//
// Decision de alcance (documentada tambien en DOCS/Esquema_OLAP.md): "filtrable
// por tenant" del criterio de aceptacion se interpreta como "el endpoint filtra
// correctamente por tenant" (aisla, no mezcla datos entre tenants), NO como un
// query param que permita elegir un tenant arbitrario. El sistema no tiene
// ningun concepto de "admin global/staff" (ninguna HU anterior lo definio); el
// unico admin que existe es el admin de UN tenant (roles.isSystem, HU-ERD-61).
// Dejar que el tenant se eligiera por query param habria roto el modelo de
// aislamiento de HU-ERD-12/15 sin que ninguna HU lo haya pedido explicitamente.
// El tenant sale siempre del JWT autenticado (auth.tenantId), igual que en
// cualquier otro endpoint del sistema.

export interface DashboardMetricsFilters {
  /** Default: 30 dias antes de `to`. */
  from?: Date
  /** Default: ahora. */
  to?: Date
  /** Filtra fact_eventos por tipo_evento (ej. slug de una entidad). */
  tipoEvento?: string
}

export interface DashboardMetrics {
  tenantId: string
  /** Rango efectivo usado, como ids de dim_date (yyyymmdd). */
  rango: { from: number; to: number }
  eventos: {
    total: number
    montoTotal: string
    cantidadTotal: number
    porTipo: Array<{ tipoEvento: string; total: number; monto: string }>
  }
  clientes: { total: number }
  sucursales: { total: number }
  // HU-ERD-31 pide "usuarios activos" como metrica de uso, pero no existe una
  // dimension de usuarios en el esquema en estrella (HU-ERD-27 no la definio -
  // fact_eventos no tiene un campo de usuario/actor). Se toma directo de la
  // tabla transaccional `users` (tenant-scoped, con RLS igual que el resto) en
  // vez de inventar una dimension OLAP solo para esto; documentado como
  // limitacion conocida, candidato a HU aparte (dim_usuario / actor_id en
  // fact_eventos) si en el futuro se necesita cruzar actividad por usuario.
  usuarios: { total: number; activos: number }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_DAYS = 30

export async function getDashboardMetrics(
  tenantId: string,
  filters: DashboardMetricsFilters = {}
): Promise<DashboardMetrics> {
  const to = filters.to ?? new Date()
  const from = filters.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * ONE_DAY_MS)
  const fromId = toDimDateId(from)
  const toId = toDimDateId(to)

  return withTenant(tenantId, async (tx) => {
    const eventoConds = [eq(factEventos.tenantId, tenantId), gte(factEventos.dateId, fromId), lte(factEventos.dateId, toId)]
    if (filters.tipoEvento) {
      eventoConds.push(eq(factEventos.tipoEvento, filters.tipoEvento))
    }
    const eventoWhere = and(...eventoConds)

    const [totales] = await tx
      .select({
        total: dsql<number>`count(*)::int`,
        montoTotal: dsql<string>`coalesce(sum(${factEventos.monto}), 0)::text`,
        cantidadTotal: dsql<number>`coalesce(sum(${factEventos.cantidad}), 0)::int`
      })
      .from(factEventos)
      .where(eventoWhere)

    const porTipo = await tx
      .select({
        tipoEvento: factEventos.tipoEvento,
        total: dsql<number>`count(*)::int`,
        monto: dsql<string>`coalesce(sum(${factEventos.monto}), 0)::text`
      })
      .from(factEventos)
      .where(eventoWhere)
      .groupBy(factEventos.tipoEvento)
      .orderBy(dsql`count(*) desc`)

    const [clientesRow] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(dimCliente)
      .where(eq(dimCliente.tenantId, tenantId))

    const [sucursalesRow] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(dimSucursal)
      .where(eq(dimSucursal.tenantId, tenantId))

    const [usuariosTotalRow] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.tenantId, tenantId))

    const [usuariosActivosRow] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))

    return {
      tenantId,
      rango: { from: fromId, to: toId },
      eventos: {
        total: totales?.total ?? 0,
        montoTotal: totales?.montoTotal ?? '0',
        cantidadTotal: totales?.cantidadTotal ?? 0,
        porTipo
      },
      clientes: { total: clientesRow?.count ?? 0 },
      sucursales: { total: sucursalesRow?.count ?? 0 },
      usuarios: { total: usuariosTotalRow?.count ?? 0, activos: usuariosActivosRow?.count ?? 0 }
    }
  })
}

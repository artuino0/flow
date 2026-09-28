import { sql, type SQL } from 'drizzle-orm'
import { dimCliente, dimSucursal, factEventos } from '~/server/db/schema'
import { currentRecordActor } from '~/server/utils/recordActorContext'

/** El origen OLAP es histórico; para roles own se exige que el registro transaccional siga visible por RLS. */
export function visibleFactEvent(): SQL {
  const roleId = currentRecordActor()?.roleId
  if (!roleId) return sql`true`
  return sql`(
    not exists (
      select 1 from role_entity_permissions permission
      join entities module on module.id = permission.entity_id
      where permission.role_id = ${roleId}::uuid and permission.visibility = 'own'
        and module.tenant_id = ${factEventos.tenantId} and module.slug = ${factEventos.tipoEvento}
    )
    or exists (select 1 from records visible where visible.id = ${factEventos.recordId} and visible.tenant_id = ${factEventos.tenantId})
  )`
}

export function visibleDimensionRecord(kind: 'clientes' | 'sucursales'): SQL {
  const roleId = currentRecordActor()?.roleId
  if (!roleId) return sql`true`
  const dimension = kind === 'clientes' ? dimCliente : dimSucursal
  return sql`(
    not exists (
      select 1 from role_entity_permissions permission
      join entities module on module.id = permission.entity_id
      where permission.role_id = ${roleId}::uuid and permission.visibility = 'own'
        and module.tenant_id = ${dimension.tenantId} and module.slug = ${kind}
    )
    or exists (select 1 from records visible where visible.id = ${dimension.recordId} and visible.tenant_id = ${dimension.tenantId})
  )`
}

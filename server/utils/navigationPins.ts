import { sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { AuthTokenPayload } from './auth'
import { withTenant } from '~/server/db'
import { listAvailableFlowApps } from './flowCapabilities'
import { listVisibleEntities } from './moduleEntities'
import { isAdminUser } from './rbac'
import { unifiedAreas } from '~/utils/unifiedNavigation'

async function available(auth: AuthTokenPayload) {
  const [apps, entities, admin] = await Promise.all([listAvailableFlowApps(auth.tenantId, auth.sub), listVisibleEntities(auth.tenantId, auth.roleId!), isAdminUser(auth)])
  // El servidor aplica las mismas condiciones de apps y roles; billing ya filtra país.
  return unifiedAreas(apps.apps, entities.filter(entity => entity.showInMenu && entity.moduleKind === 'hecho'), admin, 'MX', apps.capabilities.effective['communications.access'])
    .filter(area => area.enabled && area.accessible).flatMap(area => area.items)
}
export async function readNavigationPins(auth: AuthTokenPayload) {
  const links = await available(auth), allowed = new Set(links.map(link => link.key))
  const keys = await withTenant(auth.tenantId, async tx => {
    await tx.execute(sql`select set_config('app.nav_user_id',${auth.sub},true)`)
    return tx.execute(sql`select item_key from navigation_pins order by created_at,item_key`)
  })
  return { keys: keys.map(row => String(row.item_key)).filter(key => allowed.has(key)) }
}
export async function changeNavigationPin(auth: AuthTokenPayload, key: string, pinned: boolean) {
  const allowed = pinned ? new Set((await available(auth)).map(link => link.key)) : null
  if (allowed && !allowed.has(key)) throw createError({ statusCode: 403, statusMessage: 'Este destino ya no está disponible.' })
  await withTenant(auth.tenantId, async tx => {
    await tx.execute(sql`select set_config('app.nav_user_id',${auth.sub},true),pg_advisory_xact_lock(hashtextextended(${auth.tenantId + ':' + auth.sub},199))`)
    if (!pinned) { await tx.execute(sql`delete from navigation_pins where item_key=${key}`); return }
    const saved = await tx.execute(sql`select item_key from navigation_pins`)
    // Los destinos ocultos no deben consumir cupos que el usuario no puede liberar.
    for (const row of saved) if (!allowed!.has(String(row.item_key))) await tx.execute(sql`delete from navigation_pins where item_key=${String(row.item_key)}`)
    const rows = saved.filter(row => allowed!.has(String(row.item_key)))
    if (rows.some(row => row.item_key === key)) return
    if (rows.length >= 12) throw createError({ statusCode: 409, statusMessage: 'Puedes anclar hasta 12 elementos. Desancla uno para continuar.' })
    await tx.execute(sql`insert into navigation_pins(tenant_id,user_id,item_key) values (${auth.tenantId}::uuid,${auth.sub}::uuid,${key})`)
  })
  return readNavigationPins(auth)
}

import { inArray, sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, entityFields, roleEntityPermissions } from '~/server/db/schema'
import { visibleEntityAccess, SLUG_PATTERN } from '~/server/utils/moduleEntities'
import { withRecordActor } from '~/server/utils/recordActorContext'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { sanitizeCatalogText, type AgentTenantModule } from '~/utils/agentTenantCatalog'

const cache = new Map<string, { expires: number; modules: AgentTenantModule[] }>()
export function tenantCatalogTtlMs() {
 const value = Number(process.env.AGENT_CATALOG_TTL_MS)
 return Number.isFinite(value) && value > 0 ? Math.min(60_000, Math.floor(value)) : 60_000
}
export async function readTenantCatalog(auth: AuthTokenPayload): Promise<AgentTenantModule[]> {
 if (!auth.roleId) return []
 const key = `${auth.tenantId}:${auth.roleId}`
 const now = Date.now()
 const hit = cache.get(key)
 if (hit && hit.expires > now) return structuredClone(hit.modules)
 const access = visibleEntityAccess(auth.tenantId, auth.roleId)
 const modules = await withRecordActor({ userId: auth.sub, roleId: auth.roleId }, () => withTenant(auth.tenantId, async tx => {
  const rows = await tx.select({ id: entities.id, slug: entities.slug, name: entities.name, singularName: entities.singularName, description: entities.description, moduleKind: entities.moduleKind, canCreate: roleEntityPermissions.canCreate })
   .from(entities).innerJoin(roleEntityPermissions, access.join).where(access.where).orderBy(entities.name, entities.id).limit(80)
  if (!rows.length) return []
  // Límite por entidad en SQL; no se cargan valores ni cantidades de registros.
  const rankedFields = tx.select({ entityId: entityFields.entityId, label: entityFields.label, position: sql<number>`row_number() over (partition by ${entityFields.entityId} order by ${entityFields.sortOrder}, ${entityFields.id})`.as('position') })
   .from(entityFields).where(inArray(entityFields.entityId, rows.map(row => row.id))).as('ranked_fields')
  const fields = await tx.select({ entityId: rankedFields.entityId, label: rankedFields.label }).from(rankedFields).where(sql`${rankedFields.position} <= 12`).orderBy(rankedFields.entityId, rankedFields.position)
  return rows.filter(row => row.slug.length <= 100 && SLUG_PATTERN.test(row.slug)).map(row => ({ ...row,
   name: sanitizeCatalogText(row.name, 100), singularName: sanitizeCatalogText(row.singularName, 100), description: sanitizeCatalogText(row.description, 240),
   fieldLabels: fields.filter(field => field.entityId === row.id).map(field => sanitizeCatalogText(field.label, 60))
  }))
 }))
 // TTL desde el inicio de la lectura y memoria acotada; sin guardar fallos.
 for (const [id, value] of cache) if (value.expires <= now) cache.delete(id)
 if (cache.size >= 1000) cache.delete(cache.keys().next().value!)
 cache.set(key, { expires: now + tenantCatalogTtlMs(), modules })
 return structuredClone(modules)
}

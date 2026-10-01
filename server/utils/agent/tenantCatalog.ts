import { and, inArray, sql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, entityFields, roleEntityPermissions } from '~/server/db/schema'
import { visibleEntityAccess } from '~/server/utils/moduleEntities'
import { withRecordActor } from '~/server/utils/recordActorContext'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { sanitizeCatalogText, type AgentTenantCatalog } from '~/utils/agentTenantCatalog'
import { AGENT_ROUTE_SLUG_PATTERN } from '~/utils/agentRouteSlug'

const cache = new Map<string, { expires: number; modules: AgentTenantCatalog }>()
export function tenantCatalogTtlMs() {
 const value = Number(process.env.AGENT_CATALOG_TTL_MS)
 return Number.isFinite(value) && value > 0 ? Math.min(60_000, Math.floor(value)) : 60_000
}
export async function readTenantCatalog(auth: AuthTokenPayload): Promise<AgentTenantCatalog> {
 if (!auth.roleId) return []
 const key = `${auth.tenantId}:${auth.roleId}`
 const now = Date.now()
 const hit = cache.get(key)
 if (hit && hit.expires > now) return structuredClone(hit.modules)
 const access = visibleEntityAccess(auth.tenantId, auth.roleId)
 const modules = await withRecordActor({ userId: auth.sub, roleId: auth.roleId }, () => withTenant(auth.tenantId, async tx => {
  const validSlug = sql`length(${entities.slug}) <= 100 and ${entities.slug} ~ ${AGENT_ROUTE_SLUG_PATTERN.source}`
  // Conteos exclusivamente de metadatos legibles; no se consultan registros.
  const counts = await tx.select({ kind: entities.moduleKind, total: sql<number>`count(*)::int`, invalid: sql<number>`count(*) filter (where not (${validSlug}))::int` })
   .from(entities).innerJoin(roleEntityPermissions, access.join).where(access.where).groupBy(entities.moduleKind)
  const rows = await tx.select({ id: entities.id, slug: entities.slug, name: entities.name, singularName: entities.singularName, description: entities.description, moduleKind: entities.moduleKind, canCreate: roleEntityPermissions.canCreate })
   .from(entities).innerJoin(roleEntityPermissions, access.join).where(and(access.where, validSlug)).orderBy(entities.name, entities.id).limit(80)
  const slug = counts.reduce((sum, row) => sum + row.invalid, 0)
  const limit = Math.max(0, counts.reduce((sum, row) => sum + row.total - row.invalid, 0) - rows.length)
  console.info(JSON.stringify({ event: 'agent_catalog', catalogSkipped: slug + limit, catalogSkippedReasons: { slug, limit } }))
  const result: AgentTenantCatalog = []
  if (slug + limit > 0) result.totalsByKind = Object.fromEntries(counts.map(row => [row.kind, row.total]))
  if (!rows.length) return result
  // Límite por entidad en SQL; no se cargan valores ni cantidades de registros.
  const rankedFields = tx.select({ entityId: entityFields.entityId, label: entityFields.label, position: sql<number>`row_number() over (partition by ${entityFields.entityId} order by ${entityFields.sortOrder}, ${entityFields.id})`.as('position') })
   .from(entityFields).where(inArray(entityFields.entityId, rows.map(row => row.id))).as('ranked_fields')
  const fields = await tx.select({ entityId: rankedFields.entityId, label: rankedFields.label }).from(rankedFields).where(sql`${rankedFields.position} <= 12`).orderBy(rankedFields.entityId, rankedFields.position)
  result.push(...rows.map(row => ({ ...row,
   name: sanitizeCatalogText(row.name, 100), singularName: sanitizeCatalogText(row.singularName, 100), description: sanitizeCatalogText(row.description, 240),
   fieldLabels: fields.filter(field => field.entityId === row.id).map(field => sanitizeCatalogText(field.label, 60))
  })))
  return result
 }))
 // TTL desde el inicio de la lectura y memoria acotada; sin guardar fallos.
 for (const [id, value] of cache) if (value.expires <= now) cache.delete(id)
 if (cache.size >= 1000) cache.delete(cache.keys().next().value!)
 cache.set(key, { expires: now + tenantCatalogTtlMs(), modules })
 return structuredClone(modules)
}

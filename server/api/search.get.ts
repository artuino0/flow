import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { entities, entityFields, roleEntityPermissions, roles } from '~/server/db/schema'
import { isFeatureEnabled } from '~/server/utils/appConfig'
import { requireAuth } from '~/server/utils/rbac'
import { labelForRecord } from '~/utils/recordLabel'
import { normalizeSearch, searchPattern, type SearchResponse, type SearchResult } from '~/utils/globalSearch'

const querySchema = z.object({ q: z.string().trim().max(100).default(''), recent: z.string().max(300).optional(), entity: z.string().max(100).optional() })
export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = await getValidatedQuery(event, querySchema.parse)
  const recent = query.recent ? z.array(z.string().uuid()).max(8).parse(query.recent.split(',')) : []
  return withTenant(auth.tenantId, async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '3000ms'`)
    const available = await tx.select({ id: entities.id, slug: entities.slug, name: entities.name, icon: entities.icon, labelField: entities.labelField, canCreate: roleEntityPermissions.canCreate })
      .from(entities).innerJoin(roleEntityPermissions, and(eq(roleEntityPermissions.entityId, entities.id), eq(roleEntityPermissions.roleId, auth.roleId!)))
      .where(and(eq(entities.tenantId, auth.tenantId), eq(entities.isActive, true), eq(roleEntityPermissions.canRead, true)))
    const scopes = event.context.apiKeyScopes as Record<string, { read?: boolean; create?: boolean }> | undefined
    const allowed = available.filter(e => !scopes || scopes[e.slug]?.read)
    const commands: SearchResult[] = allowed.flatMap(e => {
      const base = { entity: e.slug, entityName: e.name, icon: e.icon, subtitle: 'Acción rápida', kind: 'command' as const }
      return [ { ...base, id: `open-${e.id}`, title: `Abrir ${e.name}`, url: `/registros/${e.slug}` },
        ...(e.canCreate && (!scopes || scopes[e.slug]?.create) ? [{ ...base, id: `create-${e.id}`, title: `Crear en ${e.name}`, url: `/registros/${e.slug}/nuevo` }] : []) ]
    }).filter(c => !query.q || normalizeSearch(c.title).includes(normalizeSearch(query.q))).slice(0, 6)
    if (!scopes && isFeatureEnabled('REPORTS') && normalizeSearch('Abrir reportes').includes(normalizeSearch(query.q))) {
      const [role] = await tx.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, auth.roleId!))
      if (role?.isSystem) commands.push({ id: 'open-reports', entity: 'reports', entityName: 'Reportes', title: 'Abrir reportes', subtitle: 'Acción rápida', url: '/reportes/nuevo', kind: 'command' })
    }
    const empty: SearchResponse = { results: [], commands, hasMore: false }
    if (!allowed.length || (query.q.length < 2 && !recent.length)) return empty
    const ids = allowed.map(e => e.id)
    const fields = (await tx.select().from(entityFields).where(inArray(entityFields.entityId, ids)).orderBy(entityFields.sortOrder)).map(f => ({ ...f, validationRules: (f.validationRules || {}) as Record<string, unknown> }))
    const pattern = searchPattern(query.q)
    // Rank per module before limiting so a large module cannot hide all others.
    const rows = await tx.execute(sql`
      WITH matched AS (
        ${query.q.length >= 2 ? sql`
          SELECT direct.id FROM records direct WHERE direct.tenant_id = ${auth.tenantId} AND direct.deleted_at IS NULL
            AND public.flow_search_text(direct.custom_data) LIKE ${pattern}
          UNION
          SELECT exact.id FROM records exact WHERE exact.tenant_id = ${auth.tenantId} AND exact.deleted_at IS NULL AND exact.id::text = ${query.q}
          UNION
          SELECT source.id FROM records related
            JOIN entities target ON target.id = related.entity_id AND target.tenant_id = ${auth.tenantId}
            JOIN entity_fields f ON f.data_type = 'relation' AND f.validation_rules->>'relationEntity' = target.slug
            JOIN records source ON source.entity_id = f.entity_id AND source.custom_data->>f.name = related.id::text AND source.tenant_id = ${auth.tenantId}
          WHERE related.tenant_id = ${auth.tenantId} AND related.deleted_at IS NULL
            AND target.id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)})
            AND public.flow_search_text(related.custom_data) LIKE ${pattern}
        ` : sql`SELECT unnest(ARRAY[${sql.join(recent.map(id => sql`${id}::uuid`), sql`,`)}]) AS id`}
      ), candidates AS (
        SELECT r.*, count(*) OVER () AS total_matches, row_number() OVER (PARTITION BY r.entity_id ORDER BY (public.flow_search_text(r.custom_data) LIKE ${pattern}) DESC, r.updated_at DESC, r.id) AS position
        FROM records r JOIN matched ON matched.id = r.id
        WHERE r.tenant_id = ${auth.tenantId} AND r.entity_id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)})
          AND r.deleted_at IS NULL
          AND ${query.entity ? sql`r.entity_id = ${allowed.find(e => e.slug === query.entity)?.id || '00000000-0000-0000-0000-000000000000'}::uuid` : sql`true`}
      ) SELECT id, entity_id, custom_data, total_matches FROM candidates WHERE position <= ${query.q ? 5 : 8} ORDER BY position, entity_id LIMIT 31
    `)
    const results = rows.slice(0, 30).map(row => {
      const e = allowed.find(e => e.id === row.entity_id)!
      const ownFields = fields.filter(f => f.entityId === e.id)
      const data = row.custom_data as Record<string, unknown>
      const title = labelForRecord(ownFields, data, String(row.id), e.labelField)
      const field = query.q ? ownFields.find(f => f.dataType !== 'relation' && f.dataType !== 'file' && typeof data[f.name] !== 'object' && normalizeSearch(String(data[f.name] ?? '')).includes(normalizeSearch(query.q)) && String(data[f.name] ?? '') !== title) : undefined
      return { id: String(row.id), entity: e.slug, entityName: e.name, icon: e.icon, title: title.slice(0, 160), subtitle: field ? `${field.label}: ${String(data[field.name]).slice(0, 140)}` : e.name, url: `/registros/${e.slug}/${row.id}`, kind: 'record' as const }
    })
    if (!query.q) results.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id))
    else results.sort((a, b) => a.entityName.localeCompare(b.entityName) || Number(normalizeSearch(b.title) === normalizeSearch(query.q)) - Number(normalizeSearch(a.title) === normalizeSearch(query.q)))
    return { results, commands, hasMore: Number(rows[0]?.total_matches || 0) > results.length } satisfies SearchResponse
  })
})

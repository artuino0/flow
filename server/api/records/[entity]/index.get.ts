import { z } from 'zod'
import { and, eq, desc, sql as dsql } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// GET /api/records/:entity?page=1&pageSize=20 (HU-ERD-16)
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const query = await getValidatedQuery(event, querySchema.parse)
  const offset = (query.page - 1) * query.pageSize

  return withTenant(auth.tenantId, async (tx) => {
    const data = await tx
      .select()
      .from(records)
      .where(and(eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id)))
      .orderBy(desc(records.createdAt))
      .limit(query.pageSize)
      .offset(offset)

    const [{ count }] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(records)
      .where(and(eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id)))

    return { data, page: query.page, pageSize: query.pageSize, total: count }
  })
})

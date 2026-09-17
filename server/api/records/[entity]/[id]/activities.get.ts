import { and, eq, desc } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { recordActivities, users, people } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth } = await requirePermission(event, entitySlug, 'canRead')

  const activities = await withTenant(auth.tenantId, async (tx) => {
    return tx
      .select({
        id: recordActivities.id,
        actionType: recordActivities.actionType,
        details: recordActivities.details,
        createdAt: recordActivities.createdAt,
        user: {
          id: users.id,
          name: people.fullName,
          email: people.email
        }
      })
      .from(recordActivities)
      .leftJoin(users, eq(recordActivities.userId, users.id))
      .leftJoin(people, eq(users.personId, people.id))
      .where(and(
        eq(recordActivities.tenantId, auth.tenantId),
        eq(recordActivities.recordId, id)
      ))
      .orderBy(desc(recordActivities.createdAt))
  })

  return activities
})

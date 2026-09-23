import { and, eq, desc } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { recordActivities, users, people, roles } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth } = await requirePermission(event, entitySlug, 'canRead')

  const activities = await withTenant(auth.tenantId, async (tx) => {
    const rows = await tx
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

    // Las menciones guardan ids de membresía del tenant. Resolvemos sus
    // datos de presentación aquí para que la actividad pueda mostrar el
    // nombre limpio y el contexto del trabajador sin exponer información
    // adicional en el texto almacenado.
    const mentionedUsers = await tx
      .select({ id: users.id, name: people.fullName, email: people.email, jobTitle: users.jobTitle, roleName: roles.name })
      .from(users)
      .leftJoin(people, eq(users.personId, people.id))
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.tenantId, auth.tenantId))
    const byId = new Map(mentionedUsers.map(user => [user.id, user]))
    return rows.map(row => {
      const rawMentions = row.details && typeof row.details === 'object' && Array.isArray((row.details as Record<string, unknown>).mentions)
        ? (row.details as Record<string, unknown>).mentions as unknown[]
        : []
      return {
        ...row,
        mentions: rawMentions
          .map(id => byId.get(String(id)))
          .filter((user): user is NonNullable<typeof user> => Boolean(user))
      }
    })
  })

  return activities
})

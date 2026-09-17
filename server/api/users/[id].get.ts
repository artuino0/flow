import { and, eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { people, roles, users } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const user = await withTenant(auth.tenantId, async tx => {
    const [row] = await tx.select({
      id: users.id, fullName: people.fullName, email: people.email, phone: people.phone,
      jobTitle: users.jobTitle, timezone: users.timezone, roleId: users.roleId,
      roleName: roles.name, isActive: users.isActive, createdAt: users.createdAt, updatedAt: users.updatedAt
    }).from(users).innerJoin(people, eq(people.id, users.personId)).leftJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId))).limit(1)
    return row ?? null
  })
  if (!user) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  return user
})

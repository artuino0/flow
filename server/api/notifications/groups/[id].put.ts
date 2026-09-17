import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notificationGroupMembers, notificationGroups, users } from '~/server/db/schema'

const bodySchema = z.object({ name: z.string().trim().min(1).max(100), userIds: z.array(z.string().uuid()).max(500).default([]) })

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const groupId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)
  const group = await withTenant(auth.tenantId, async tx => {
    const [existing] = await tx.select({ id: notificationGroups.id }).from(notificationGroups).where(and(eq(notificationGroups.id, groupId), eq(notificationGroups.tenantId, auth.tenantId))).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Grupo no encontrado' })
    const validUsers = body.userIds.length ? await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, auth.tenantId), eq(users.isActive, true), inArray(users.id, body.userIds))) : []
    if (validUsers.length !== new Set(body.userIds).size) throw createError({ statusCode: 400, statusMessage: 'Uno o más usuarios no pertenecen a esta organización o están inactivos.' })
    const [updated] = await tx.update(notificationGroups).set({ name: body.name, updatedAt: new Date() }).where(eq(notificationGroups.id, groupId)).returning()
    await tx.delete(notificationGroupMembers).where(eq(notificationGroupMembers.groupId, groupId))
    if (validUsers.length) await tx.insert(notificationGroupMembers).values(validUsers.map(user => ({ groupId, userId: user.id })))
    return updated
  })
  return group
})

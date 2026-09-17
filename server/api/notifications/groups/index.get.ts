import { asc, eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { notificationGroupMembers, notificationGroups, people, users } from '~/server/db/schema'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return withTenant(auth.tenantId, async tx => {
    const groups = await tx.select({ id: notificationGroups.id, name: notificationGroups.name, createdAt: notificationGroups.createdAt }).from(notificationGroups).where(eq(notificationGroups.tenantId, auth.tenantId)).orderBy(asc(notificationGroups.name))
    const result = await Promise.all(groups.map(async group => {
      const members = await tx.select({ id: users.id, label: people.fullName, email: people.email }).from(notificationGroupMembers).innerJoin(users, eq(users.id, notificationGroupMembers.userId)).innerJoin(people, eq(people.id, users.personId)).where(eq(notificationGroupMembers.groupId, group.id))
      return { ...group, members: members.map(member => ({ id: member.id, label: member.label || member.email, email: member.email })) }
    }))
    return { groups: result }
  })
})

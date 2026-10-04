import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { agendaSchedules, people, roles, users } from '~/server/db/schema'
import { isAgendaStaff } from '~/utils/agendaStaff'

export async function agendaStaffCandidates(tx: typeof db, tenantId: string) {
  const rows = await tx.select({ id: users.id, tenantId: users.tenantId, isActive: users.isActive,
    name: people.fullName, email: people.email, roleName: roles.name, isSystem: roles.isSystem,
    scheduled: sql<boolean>`exists(select 1 from ${agendaSchedules} where ${agendaSchedules.tenantId} = ${users.tenantId} and ${agendaSchedules.userId} = ${users.id})`
  }).from(users).innerJoin(people, eq(people.id, users.personId))
    .leftJoin(roles, and(eq(roles.id, users.roleId), eq(roles.tenantId, users.tenantId)))
    .where(eq(users.tenantId, tenantId)).orderBy(people.fullName, users.id)
  return rows.map(row => ({ ...row, agendaStaff: isAgendaStaff(row, tenantId) }))
}

export async function agendaStaff(tx: typeof db, tenantId: string) {
  return (await agendaStaffCandidates(tx, tenantId)).filter(person => person.agendaStaff)
}

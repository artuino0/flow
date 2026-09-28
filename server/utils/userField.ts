import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/db'
import { people, roles, users } from '~/server/db/schema'

type Field = { name: string; dataType: string; validationRules: unknown }

/** Solo valida asignaciones nuevas: los valores históricos permanecen si una membresía se desactiva. */
export async function assertWritableUsers(
  tx: typeof db,
  tenantId: string,
  fields: Field[],
  nextData: Record<string, unknown>,
  previousData: Record<string, unknown> = {}
): Promise<void> {
  for (const field of fields) {
    if (field.dataType !== 'user') continue
    const rules = (field.validationRules ?? {}) as { roles?: string[]; multiple?: boolean }
    const next = nextData[field.name]
    const before = previousData[field.name]
    const beforeIds = new Set(Array.isArray(before) ? before : typeof before === 'string' ? [before] : [])
    const ids = (Array.isArray(next) ? next : typeof next === 'string' ? [next] : []).filter((id): id is string => typeof id === 'string' && !beforeIds.has(id))
    if (!ids.length) continue
    const rows = await tx.select({ id: users.id, isActive: users.isActive, roleId: users.roleId, roleName: roles.name })
      .from(users).leftJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)))
    const valid = new Set(rows.filter(row => row.isActive && (!rules.roles?.length || rules.roles.includes(row.roleId ?? '') || rules.roles.includes(row.roleName ?? ''))).map(row => row.id))
    if (ids.some(id => !valid.has(id))) throw createError({ statusCode: 422, statusMessage: `El campo "${field.name}" requiere usuarios activos del tenant con un rol permitido` })
  }
}

export async function lookupUsers(tx: typeof db, tenantId: string) {
  return tx.select({ id: users.id, fullName: people.fullName, email: people.email, isActive: users.isActive, roleId: users.roleId, roleName: roles.name })
    .from(users).innerJoin(people, eq(people.id, users.personId)).leftJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.tenantId, tenantId))
}

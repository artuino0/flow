import { eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { hashPassword, verifyPassword } from '~/server/utils/auth'

// HU-ERD-83 (parte 1): logica de cambio de contraseña autoservicio, separada
// del endpoint (mismo patron que moduleEntities.ts/relationDefinitions.ts,
// HU-ERD-66/77) para poder testearla contra Postgres real sin pasar por HTTP
// ni por un `nuxt build` completo.
//
// HU multi-organizacion (2026-09-04): la contraseña ya no vive en `users`
// (la membresia) sino en `people` (la persona, ver el comentario largo en
// server/db/schema.ts) - `userId` (auth.sub) sigue siendo el id de la
// membresia como siempre, se resuelve su person_id ADENTRO del mismo
// withTenant() (la membresia es tenant-scoped, RLS real) y recien con eso se
// lee/escribe `people` (global, sin RLS - mismo criterio que `tenants`).

export class UserNotFoundError extends Error {}
export class WrongCurrentPasswordError extends Error {}

/**
 * Cambia la contraseña del usuario `userId` (siempre el propio usuario
 * autenticado - no existe forma de cambiar la contraseña de otro), validando
 * `currentPassword` contra el hash guardado antes de aceptar `newPassword`
 * (ya validada contra passwordPolicySchema en el endpoint, con Zod, antes de
 * llegar aca). Como la contraseña es de la PERSONA, cambiarla afecta a TODAS
 * sus organizaciones a la vez - es la misma credencial en todas (decision
 * explicita del usuario, 2026-09-04).
 */
export async function changeUserPassword(tenantId: string, userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const membership = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ personId: users.personId }).from(users).where(eq(users.id, userId)).limit(1)
    return row ?? null
  })
  if (!membership) {
    throw new UserNotFoundError(`El usuario ${userId} no existe en este tenant`)
  }

  const [person] = await db.select().from(people).where(eq(people.id, membership.personId)).limit(1)
  if (!person) {
    throw new UserNotFoundError(`La persona ${membership.personId} no existe`)
  }

  const valid = await verifyPassword(currentPassword, person.passwordHash)
  if (!valid) {
    throw new WrongCurrentPasswordError('La contraseña actual no es correcta')
  }

  const newHash = await hashPassword(newPassword)
  await db.update(people).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(people.id, membership.personId))
}

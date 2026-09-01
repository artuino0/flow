import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { hashPassword, verifyPassword } from '~/server/utils/auth'

// HU-ERD-83 (parte 1): logica de cambio de contraseña autoservicio, separada
// del endpoint (mismo patron que moduleEntities.ts/relationDefinitions.ts,
// HU-ERD-66/77) para poder testearla contra Postgres real sin pasar por HTTP
// ni por un `nuxt build` completo.

export class UserNotFoundError extends Error {}
export class WrongCurrentPasswordError extends Error {}

/**
 * Cambia la contraseña del usuario `userId` (siempre el propio usuario
 * autenticado - no existe forma de cambiar la contraseña de otro), validando
 * `currentPassword` contra el hash guardado antes de aceptar `newPassword`
 * (ya validada contra passwordPolicySchema en el endpoint, con Zod, antes de
 * llegar aca).
 */
export async function changeUserPassword(tenantId: string, userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    return row ?? null
  })
  if (!user) {
    throw new UserNotFoundError(`El usuario ${userId} no existe en este tenant`)
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) {
    throw new WrongCurrentPasswordError('La contraseña actual no es correcta')
  }

  const newHash = await hashPassword(newPassword)
  await withTenant(tenantId, async (tx) => {
    await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId))
  })
}
